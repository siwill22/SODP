// Computes the Present-Day Lithology Map (docs/adr/0006, docs/adr/0007,
// docs/adr/0008) by calling the REAL app logic (src/lithology.ts,
// src/core/volume.ts) against real data -- no reimplementation. Run with:
// npx tsx compute_lithology.mjs
//
// Basement Age: read directly from disk -- used ONLY as the oceanic-crust
// mask (excludes continental shelf/land), not for depth (ADR-0008: GDH1 is
// no longer used for this map's depth).
// Bathymetry: read directly from disk (prep/prep_bathymetry.py) -- real
// SRTM15 depth, ADR-0008.
// Basin Mask: read directly from disk (prep/prep_basin_mask.py) -- NOAA
// WOA13, drives the per-basin CCD lookup, ADR-0008.
// OVEL: ONE live fetch of the age=0 frame's raw bytes (not per-cell) from
// Geode's archive, decoded locally in the grid loop.
//
// Output: lithology_grid.json -- {nlon, nlat, classes: number[] (0=clay,
// 1=carbonate-ooze, 2=siliceous-ooze, 255=no-data), plus the intermediate
// oceanDepthKm/ccdKm/ovelCmS/basin grids for the supporting figures}.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchVolumeBytes, resolvePath, texelToPhysical } from '../../src/core/volume.ts';
import { classifyLithology, ccdKmForBasin } from '../../src/lithology.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..', '..');
const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';

const CLASS_INDEX = { clay: 0, 'carbonate-ooze': 1, 'siliceous-ooze': 2 };
const NO_DATA = 255;
const BASIN_CODE_TO_NAME = { 1: 'atlantic', 2: 'pacific', 3: 'indian' }; // matches prep_basin_mask.py's KEEP_CODES

function readLocalVolume(modelId, variableId, frameId) {
  const manifest = JSON.parse(readFileSync(
    path.join(REPO_ROOT, 'archive/models', modelId, 'manifest.json'), 'utf8'));
  const variable = manifest.variables.find((v) => v.id === variableId);
  const resolution = manifest.resolutions.find((r) => r.id === manifest.default_resolution);
  const binPath = path.join(REPO_ROOT, 'archive/models', modelId,
    resolvePath(manifest, variable.id, frameId));
  const bytes = new Uint8Array(readFileSync(binPath));
  return { manifest, variable, resolution, bytes };
}

async function main() {
  // --- Basement Age: local disk, used ONLY as the oceanic-crust mask ---
  const age = readLocalVolume('basement-age', 'age', '000');
  console.log(`Basement Age: ${age.resolution.nlon}x${age.resolution.nlat}, sentinel=${age.manifest.no_data_sentinel}`);

  // --- Bathymetry: local disk, real depth (ADR-0008) ---
  const bathy = readLocalVolume('bathymetry', 'depth', '000');
  console.log(`Bathymetry: ${bathy.resolution.nlon}x${bathy.resolution.nlat}, sentinel=${bathy.manifest.no_data_sentinel}`);
  if (bathy.resolution.nlon !== age.resolution.nlon || bathy.resolution.nlat !== age.resolution.nlat) {
    throw new Error(`grid mismatch: basement-age vs bathymetry`);
  }

  // --- Basin Mask: local disk, drives per-basin CCD (ADR-0008) ---
  const basin = readLocalVolume('basin-mask', 'basin', '000');
  console.log(`Basin Mask: ${basin.resolution.nlon}x${basin.resolution.nlat}, sentinel=${basin.manifest.no_data_sentinel}`);
  if (basin.resolution.nlon !== age.resolution.nlon || basin.resolution.nlat !== age.resolution.nlat) {
    throw new Error(`grid mismatch: basement-age vs basin-mask`);
  }

  // --- Published CCD Curve, age=0 -- fallback for basins with no per-basin value (ADR-0008) ---
  const publishedCcd = JSON.parse(readFileSync(
    path.join(REPO_ROOT, 'archive/ccd/published_ccd_curve.json'), 'utf8'));
  const ccdAge0 = publishedCcd.curve.find((p) => p.age_ma === 0);
  if (!ccdAge0) throw new Error('no age=0 entry in published_ccd_curve.json');
  const globalCcdKm = ccdAge0.ccd_km;
  console.log(`Global fallback CCD at age=0: ${globalCcdKm} km (tier=${ccdAge0.tier})`);
  console.log(`Per-basin CCD (ADR-0008): atlantic=${ccdKmForBasin('atlantic')}, `
    + `pacific=${ccdKmForBasin('pacific')}, indian=${ccdKmForBasin('indian')} km`);

  // --- OVEL: one live fetch of the age=0 frame, decoded locally ---
  const ovelManifest = await (await fetch(`${GEODE_BASE}/models/bridge-valdes2021-ocean-depth/manifest.json`)).json();
  const ovelVar = ovelManifest.variables.find((v) => v.id === 'OVEL');
  const ovelRes = ovelManifest.resolutions.find((r) => r.id === ovelManifest.default_resolution);
  if (ovelRes.nlon !== age.resolution.nlon || ovelRes.nlat !== age.resolution.nlat) {
    throw new Error(`grid mismatch: basement-age ${age.resolution.nlon}x${age.resolution.nlat} vs OVEL ${ovelRes.nlon}x${ovelRes.nlat}`);
  }
  console.log(`OVEL grid matches basement-age grid: ${ovelRes.nlon}x${ovelRes.nlat} (confirmed, not assumed)`);
  const ovelFrame0 = ovelManifest.frames.find((f) => f.age_ma === 0);
  const ovelPath = `${GEODE_BASE}/models/${ovelManifest.id}/${resolvePath(ovelManifest, ovelVar.id, ovelFrame0.id)}`;
  const ovelAllLayers = await fetchVolumeBytes(ovelPath);
  const plane = ovelRes.nlon * ovelRes.nlat;
  const layerIndex = 0; // shallowest depth_labels_km entry -- see queryPoint.ts's module doc
  const ovelDepthKm = ovelManifest.depth_labels_km[layerIndex];
  const ovelLayer = ovelAllLayers.subarray(layerIndex * plane, (layerIndex + 1) * plane);
  console.log(`OVEL: read layerIndex=${layerIndex} (depth ${ovelDepthKm} km), ${ovelLayer.length} bytes, `
    + `no_data_sentinel=${ovelManifest.no_data_sentinel}`);

  // --- Grid loop: same (nlon, nlat) for all sources, so index i maps directly ---
  const n = age.resolution.nlon * age.resolution.nlat;
  const classes = new Uint8Array(n).fill(NO_DATA);
  const oceanDepthKm = new Float32Array(n).fill(NaN);
  const ovelCmS = new Float32Array(n).fill(NaN);
  const ccdKmUsed = new Float32Array(n).fill(NaN);
  const basinCode = new Uint8Array(n).fill(NO_DATA);
  let counts = { clay: 0, 'carbonate-ooze': 0, 'siliceous-ooze': 0, noData: 0 };
  let basinCcdCells = 0;

  for (let i = 0; i < n; i++) {
    const ageNoData = age.bytes[i] === age.manifest.no_data_sentinel;
    const bathyNoData = bathy.bytes[i] === bathy.manifest.no_data_sentinel;
    const ovelNoData = ovelLayer[i] === ovelManifest.no_data_sentinel;
    if (ageNoData || bathyNoData || ovelNoData) { counts.noData++; continue; }

    const depthKm = texelToPhysical(bathy.variable, bathy.bytes[i]);
    const ovel = texelToPhysical(ovelVar, ovelLayer[i]);

    const basinByte = basin.bytes[i];
    const basinName = basinByte === basin.manifest.no_data_sentinel ? undefined : BASIN_CODE_TO_NAME[basinByte];
    const ccdKm = basinName ? ccdKmForBasin(basinName) : globalCcdKm;
    if (basinName) basinCcdCells++;

    const cls = classifyLithology({ oceanDepthKm: depthKm, ccdKm, ovelCmS: ovel });

    classes[i] = CLASS_INDEX[cls];
    oceanDepthKm[i] = depthKm;
    ovelCmS[i] = ovel;
    ccdKmUsed[i] = ccdKm;
    basinCode[i] = basinByte;
    counts[cls]++;
  }

  const validCells = n - counts.noData;
  console.log(`\n${basinCcdCells}/${validCells} valid cells used a per-basin CCD; `
    + `${validCells - basinCcdCells} fell back to the global value`);
  console.log('\nclass counts:', counts,
    `(${(100 * counts['carbonate-ooze'] / validCells).toFixed(1)}% carbonate ooze, `
    + `${(100 * counts['siliceous-ooze'] / validCells).toFixed(1)}% siliceous ooze, `
    + `${(100 * counts.clay / validCells).toFixed(1)}% clay, of valid cells)`);

  writeFileSync(path.join(HERE, 'lithology_grid.json'), JSON.stringify({
    nlon: age.resolution.nlon,
    nlat: age.resolution.nlat,
    globalCcdKm,
    noDataSentinel: NO_DATA,
    classIndex: CLASS_INDEX,
    classes: Array.from(classes),
    oceanDepthKm: Array.from(oceanDepthKm),
    ovelCmS: Array.from(ovelCmS),
    ccdKmUsed: Array.from(ccdKmUsed),
    basinCode: Array.from(basinCode),
  }));
  console.log(`\nwrote ${path.join(HERE, 'lithology_grid.json')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
