/**
 * Present-Day Lithology Map (ADR-0006/0007/0008/0011) -- browser production
 * port of show-me/2026-09-08-lithology-map/compute_lithology.mjs, which
 * validated the real-bathymetry + per-basin-CCD inputs this still uses.
 * Classification itself is ADR-0011/ADR-0012's probabilistic classifier
 * (depth-minus-CCD margin, OTEMP -- OVEL was dropped, ADR-0012: it carried
 * no measurable weight once OTEMP was present), not the deterministic rule
 * compute_lithology.mjs used -- see those ADRs for why (a real check
 * against 14,400 point observations found the deterministic rule scoring
 * worse than guessing one class for everything).
 *
 * I/O (loadPresentDayInputs) and the pure grid computation
 * (buildPresentDayGrid) are kept separate, matching this project's own
 * convention elsewhere (ccdCurve.ts, syntheticCore.ts) -- classification
 * logic that doesn't need to know how its inputs were fetched.
 */

import {
  loadManifest, fetchVariableBytes, fetchVolumeBytes, resolvePath, texelToPhysical, cellCenter,
} from './core/volume';
import {
  classifyLithologyProbabilistic, applyEquatorialRadiolarianBelt, argmaxLithologyClass, ccdKmForBasin,
  type LithologyClass, type OceanBasin,
} from './lithology';
import type { Manifest, VariableInfo } from './core/types';

const BASIN_CODE_TO_NAME: Record<number, OceanBasin> = { 1: 'atlantic', 2: 'pacific', 3: 'indian' };
const CLASS_INDEX: Record<LithologyClass, number> = { clay: 0, 'carbonate-ooze': 1, 'siliceous-ooze': 2 };
export const NO_DATA = 255;

export interface PresentDayInputs {
  nlon: number;
  nlat: number;
  ageManifest: Manifest;
  ageBytes: Uint8Array;
  bathyManifest: Manifest;
  bathyVar: VariableInfo;
  bathyBytes: Uint8Array;
  basinManifest: Manifest;
  basinBytes: Uint8Array;
  climateManifest: Manifest;
  otempVar: VariableInfo;
  otempLayer0: Uint8Array;
  globalCcdKm: number;
}

/** Fetch everything the present-day grid needs: three local models
 *  (Basement Age for the oceanic-crust mask, real bathymetry, the basin
 *  mask) plus ONE live frame -- OTEMP, age=0, layerIndex=0 (see
 *  core/queryPoint.ts's module doc for why not ndepth-1) -- from Geode.
 *  OVEL used to be fetched here too (ADR-0011); ADR-0012 dropped it from
 *  the classifier entirely (no measurable weight once OTEMP was present),
 *  so it is no longer fetched. */
export async function loadPresentDayInputs(localBase: string, geodeBase: string): Promise<PresentDayInputs> {
  const [ageManifest, bathyManifest, basinManifest, climateManifest] = await Promise.all([
    loadManifest(localBase, 'models/basement-age/manifest.json'),
    loadManifest(localBase, 'models/bathymetry/manifest.json'),
    loadManifest(localBase, 'models/basin-mask/manifest.json'),
    loadManifest(geodeBase, 'models/bridge-valdes2021-ocean-depth/manifest.json'),
  ]);

  const ageVar = ageManifest.variables[0];
  const bathyVar = bathyManifest.variables[0];
  const basinVar = basinManifest.variables[0];
  const otempVar = climateManifest.variables.find((v) => v.id === 'OTEMP');
  if (!otempVar) throw new Error('OTEMP not found in bridge-valdes2021-ocean-depth manifest');

  const res = ageManifest.resolutions[0];
  const bathyRes = bathyManifest.resolutions[0];
  const basinRes = basinManifest.resolutions[0];
  if (bathyRes.nlon !== res.nlon || bathyRes.nlat !== res.nlat
    || basinRes.nlon !== res.nlon || basinRes.nlat !== res.nlat) {
    throw new Error('grid mismatch between basement-age/bathymetry/basin-mask');
  }

  const climateRes = climateManifest.resolutions.find((r) => r.id === climateManifest.default_resolution)!;
  if (climateRes.nlon !== res.nlon || climateRes.nlat !== res.nlat) {
    throw new Error(`grid mismatch: basement-age ${res.nlon}x${res.nlat} vs OTEMP ${climateRes.nlon}x${climateRes.nlat}`);
  }

  const [ageBytes, bathyBytes, basinBytes, publishedCurve] = await Promise.all([
    fetchVariableBytes(localBase, 'basement-age', ageManifest, ageVar.id, '000'),
    fetchVariableBytes(localBase, 'bathymetry', bathyManifest, bathyVar.id, '000'),
    fetchVariableBytes(localBase, 'basin-mask', basinManifest, basinVar.id, '000'),
    fetch(`${localBase}/ccd/published_ccd_curve.json`).then((r) => r.json()),
  ]);

  const climateFrame0 = climateManifest.frames.find((f) => f.age_ma === 0);
  if (!climateFrame0) throw new Error('no age=0 frame in bridge-valdes2021-ocean-depth manifest');
  const plane = climateRes.nlon * climateRes.nlat;

  const otempAllLayers = await fetchVolumeBytes(
    `${geodeBase}/models/${climateManifest.id}/${resolvePath(climateManifest, otempVar.id, climateFrame0.id)}`,
  );
  const otempLayer0 = otempAllLayers.subarray(0, plane); // layerIndex=0: shallowest, not ndepth-1

  const ccdAge0 = publishedCurve.curve.find((p: { age_ma: number }) => p.age_ma === 0);
  if (!ccdAge0) throw new Error('no age=0 entry in published_ccd_curve.json');

  return {
    nlon: res.nlon, nlat: res.nlat,
    ageManifest, ageBytes, bathyManifest, bathyVar, bathyBytes, basinManifest, basinBytes,
    climateManifest, otempVar, otempLayer0, globalCcdKm: ccdAge0.ccd_km,
  };
}

export interface PresentDayGrid {
  nlon: number;
  nlat: number;
  /** 0=clay, 1=carbonate-ooze, 2=siliceous-ooze, 255=no-data. */
  classes: Uint8Array;
}

/** Pure classification loop -- ADR-0008's real-bathymetry + per-basin-CCD
 *  inputs, ADR-0011/ADR-0012's probabilistic classifier, cell by cell.
 *  Basement Age is used ONLY as the oceanic-crust mask (excludes
 *  continental shelf/land); its own value never enters the classification,
 *  matching compute_lithology.mjs. `argmaxLithologyClass()` picks the
 *  map's pixel color; the full probability distribution ADR-0011 also
 *  produces isn't kept here -- nothing downstream of this grid consumes it
 *  yet.
 *
 *  `applyBelt` (ADR-0013): Option A vs Option B, two EQUAL, parallel
 *  handlings of the warm/equatorial siliceous-ooze blind spot ADR-0011
 *  documents -- neither supersedes the other. false (default) = Option B,
 *  the fitted classifier as-is. true = Option A, additionally applying
 *  applyEquatorialRadiolarianBelt() (a smooth, latitude-graded belt
 *  informed by Diesing (2020), not a hard cutoff) before taking the
 *  argmax. Callers needing both should call this twice. */
export function buildPresentDayGrid(inputs: PresentDayInputs, applyBelt = false): PresentDayGrid {
  const { nlon, nlat, ageManifest, ageBytes, bathyManifest, bathyVar, bathyBytes, basinManifest, basinBytes,
    climateManifest, otempVar, otempLayer0, globalCcdKm } = inputs;
  const n = nlon * nlat;
  const classes = new Uint8Array(n).fill(NO_DATA);

  for (let i = 0; i < n; i++) {
    if (ageBytes[i] === ageManifest.no_data_sentinel) continue;
    if (bathyBytes[i] === bathyManifest.no_data_sentinel) continue;
    if (otempLayer0[i] === climateManifest.no_data_sentinel) continue;

    const oceanDepthKm = texelToPhysical(bathyVar, bathyBytes[i]);
    const otempC = texelToPhysical(otempVar, otempLayer0[i]);

    const basinByte = basinBytes[i];
    const basinName = basinByte === basinManifest.no_data_sentinel ? undefined : BASIN_CODE_TO_NAME[basinByte];
    const ccdKm = basinName ? ccdKmForBasin(basinName) : globalCcdKm;

    let probs = classifyLithologyProbabilistic({
      oceanDepthKm, ccdKm, otempC,
    });
    if (applyBelt) {
      const { lat } = cellCenter(nlon, nlat, i % nlon, Math.floor(i / nlon));
      probs = applyEquatorialRadiolarianBelt(probs, lat);
    }
    classes[i] = CLASS_INDEX[argmaxLithologyClass(probs)];
  }

  return { nlon, nlat, classes };
}
