import { loadManifest, fetchVariableBytes, texelIndex, texelToPhysical } from './core/volume';
import { FrameByteCache } from './core/frameByteCache';
import { ageSeries, plateFrameAgeSeries } from './core/queryPoint';
import { fetchStaticPolygonData, assignPlate } from './core/staticPolygons';
import { buildAgeDepthModel, buildLithologyLog, createUnboundedPlateFramePoint } from './syntheticCore';
import type { CcdCurve } from './ccdCurve';
import type { LonLat } from './core/constants';

/**
 * Phase 0 scaffolding smoke test -- NOT the Phase 1 lithology UI yet.
 * Proves the three data pipelines actually work end to end against real
 * files: SODP's own bundled archive (basement age, Scotese polygons) and
 * Geode's live archive (BRIDGE-Valdes), through the trimmed core/ ported
 * from Geode (ADR-0001).
 */

const statusEl = document.getElementById('status')!;
function log(line: string): void {
  statusEl.innerHTML += `<div>${line}</div>`;
}

// Equatorial mid-Atlantic Ridge crossing -- known-young basement age, a
// simple point to eyeball-check every value against.
const TEST_POINT: LonLat = { lon: -25, lat: 0 };

// Old Western Atlantic abyssal plain, off the US East coast -- old enough
// crust (should be roughly Jurassic, ~150-170 Ma, the Atlantic's oldest
// oceanic crust) to put real distance under buildAgeDepthModel(), unlike
// TEST_POINT's barely-aged ridge crossing.
const OLD_TEST_POINT: LonLat = { lon: -68, lat: 32 };

const LOCAL_BASE = `${import.meta.env.BASE_URL}archive`;
const GEODE_BASE = import.meta.env.VITE_ARCHIVE_BASE;

async function main(): Promise<void> {
  statusEl.innerHTML = '';
  log(`<strong>Phase 0 smoke test</strong> -- point (${TEST_POINT.lon}, ${TEST_POINT.lat})`);

  // 1. Basement Age -- SODP's own bundled archive, present-day lookup only,
  //    never rotated (ADR-0002).
  const ageManifest = await loadManifest(LOCAL_BASE, 'models/basement-age/manifest.json');
  const ageVar = ageManifest.variables[0];
  const ageBytes = await fetchVariableBytes(LOCAL_BASE, 'basement-age', ageManifest, ageVar.id, '000');
  const res = ageManifest.resolutions[0];
  const idx = texelIndex(res.nlon, res.nlat, TEST_POINT.lon, TEST_POINT.lat);
  const byte = ageBytes[idx];
  const isNoData = ageManifest.no_data_sentinel !== undefined && byte === ageManifest.no_data_sentinel;
  const age = isNoData ? NaN : texelToPhysical(ageVar, byte);
  log(`Basement Age: ${isNoData ? 'no data (land)' : `${age.toFixed(2)} Ma`}`);

  // 2. Productivity Signal (OVEL) -- fetched live from Geode's archive (ADR-0003).
  const oceanDepthManifest = await loadManifest(GEODE_BASE, 'models/bridge-valdes2021-ocean-depth/manifest.json');
  const ovelVar = oceanDepthManifest.variables.find((v) => v.id === 'OVEL');
  if (!ovelVar) throw new Error('OVEL not found in bridge-valdes2021-ocean-depth manifest');
  // layerIndex=0: shallowest depth_labels_km entry (5 m) -- ndepth-1 would
  // be the DEEPEST level (5.19 km) for this manifest's depth axis, not a
  // surface annual mean. See core/queryPoint.ts's module doc.
  const cache = new FrameByteCache(GEODE_BASE);
  const series = await ageSeries(cache, oceanDepthManifest, ovelVar, TEST_POINT, undefined, 0);
  const presentDay = series.find((s) => s.age === 0) ?? series[0];
  log(`Productivity Signal (OVEL) at ${presentDay.age} Ma, ${oceanDepthManifest.depth_labels_km?.[0]} km depth: `
    + `${presentDay.value.toFixed(4)} ${ovelVar.units} &nbsp;(${series.length} frames fetched live from Geode)`);

  // 3. Scotese plate assignment -- PALEOMAP static polygons + rotations,
  //    bundled locally (ADR-0002's Scotese-vs-Seton pairing).
  const scotesePolyData = await fetchStaticPolygonData(
    `${LOCAL_BASE}/reconstructions/scotese-paleomap`,
    'staticpolygons/geometry.bin',
    'staticpolygons/rotations.json',
  );
  const assignment = assignPlate(scotesePolyData.polygons, scotesePolyData.table, TEST_POINT, 0);
  log(`Scotese plate assignment at present day: ${
    assignment ? `plate ${assignment.plateId} (begins ${assignment.beginAge} Ma)` : 'no polygon covers this point'
  }`);

  log('<strong>done</strong> -- all three data sources reachable and decoding.');

  // -------------------------------------------------------------------
  // Phase 2 skeleton smoke test -- trajectory + age-depth model only, no
  // lithology yet (see syntheticCore.ts's module doc for why). Uses
  // OLD_TEST_POINT rather than TEST_POINT: a ridge crossing barely ages at
  // all, so it's a poor check of whether the reconstruction actually moves
  // the point.
  // -------------------------------------------------------------------
  log('<hr><strong>Phase 2 skeleton</strong> -- trajectory + age-depth model, no lithology yet');

  const oldIdx = texelIndex(res.nlon, res.nlat, OLD_TEST_POINT.lon, OLD_TEST_POINT.lat);
  const oldByte = ageBytes[oldIdx];
  const oldIsNoData = ageManifest.no_data_sentinel !== undefined && oldByte === ageManifest.no_data_sentinel;
  if (oldIsNoData) {
    log(`Basement Age at (${OLD_TEST_POINT.lon}, ${OLD_TEST_POINT.lat}): no data (land) -- pick a different OLD_TEST_POINT`);
    return;
  }
  const basementAgeMa = texelToPhysical(ageVar, oldByte);
  log(`Basement Age at (${OLD_TEST_POINT.lon}, ${OLD_TEST_POINT.lat}): ${basementAgeMa.toFixed(2)} Ma`);

  const oldAssignment = assignPlate(scotesePolyData.polygons, scotesePolyData.table, OLD_TEST_POINT, 0);
  if (!oldAssignment) {
    log('No Scotese polygon covers this point at present day -- cannot build a Plate-Frame Point.');
    return;
  }
  log(`Scotese plate assignment: plate ${oldAssignment.plateId} (begins ${oldAssignment.beginAge} Ma)`);

  const framePoint = createUnboundedPlateFramePoint(oldAssignment, scotesePolyData.table, OLD_TEST_POINT, 0);
  const model = buildAgeDepthModel(framePoint, scotesePolyData.table, basementAgeMa, 1);
  log(`buildAgeDepthModel: ${model.length} steps from age 0 to ${model[model.length - 1]?.ageMa ?? 'n/a'} Ma`);

  const today = model[0];
  const formation = model[model.length - 1];
  log(`Today (age 0): position (${today.position.lon.toFixed(2)}, ${today.position.lat.toFixed(2)}), `
    + `crustal age ${today.crustalAgeMa.toFixed(2)} Ma, depth ${today.oceanDepthKm.toFixed(3)} km`);
  log(`Formation (age ${formation.ageMa.toFixed(2)} Ma): position (${formation.position.lon.toFixed(2)}, `
    + `${formation.position.lat.toFixed(2)}), crustal age ${formation.crustalAgeMa.toFixed(2)} Ma, `
    + `depth ${formation.oceanDepthKm.toFixed(3)} km (should read close to GDH1's ridge-crest depth, 2.6 km)`);

  // Great-circle angular distance actually travelled, today vs formation --
  // a real, checkable "did this point move" number, not just two dots on a
  // map. Independent of buildAgeDepthModel()'s own math: recomputed here
  // from lon/lat directly rather than reusing any internal vector.
  const toXYZ = (p: LonLat): [number, number, number] => {
    const lonR = p.lon * (Math.PI / 180), latR = p.lat * (Math.PI / 180);
    const cl = Math.cos(latR);
    return [cl * Math.cos(lonR), cl * Math.sin(lonR), Math.sin(latR)];
  };
  const [ax, ay, az] = toXYZ(today.position);
  const [bx, by, bz] = toXYZ(formation.position);
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  const angularDistanceDeg = Math.acos(dot) * (180 / Math.PI);
  log(`Angular distance travelled since formation: ${angularDistanceDeg.toFixed(2)}° `
    + `(~${(angularDistanceDeg * 111.2).toFixed(0)} km great-circle)`);

  log('<strong>Phase 2 skeleton done</strong> -- trajectory and age-depth model both real and checkable.');

  // -------------------------------------------------------------------
  // Phase 2 lithology log -- down-core Lithology Class, at OVEL's own real
  // Frame ages (irregular, ~4-8 Myr apart), carrying BOTH CCD curves
  // through every step per syntheticCore.ts's module doc (ADR-0005's
  // cross-check, extended to where it's actually load-bearing).
  // -------------------------------------------------------------------
  log('<hr><strong>Phase 2 lithology log</strong> -- down-core Lithology Class, both CCD curves carried through');

  const publishedCurve: CcdCurve = await (await fetch(`${LOCAL_BASE}/ccd/published_ccd_curve.json`)).json();
  const co2LinkedCurve: CcdCurve = await (await fetch(`${LOCAL_BASE}/ccd/co2_linked_ccd_curve.json`)).json();
  log(`CCD curves loaded: Published (0-${publishedCurve.curve[publishedCurve.curve.length - 1].age_ma} Ma), `
    + `CO2-Linked (0-${co2LinkedCurve.curve[co2LinkedCurve.curve.length - 1].age_ma.toFixed(1)} Ma)`);

  const ovelSeries = await plateFrameAgeSeries(
    cache, oceanDepthManifest, ovelVar, framePoint, scotesePolyData.table, undefined, 0,
  );
  log(`OVEL series: ${ovelSeries.length} real BRIDGE-Valdes frames within this point's rotation coverage`);

  const lithologyLog = buildLithologyLog(
    framePoint, scotesePolyData.table, basementAgeMa, ovelSeries, publishedCurve, co2LinkedCurve,
  );
  const divergentSteps = lithologyLog.filter((s) => s.divergent);
  log(`buildLithologyLog: ${lithologyLog.length} steps (bounded by Basement Age ${basementAgeMa.toFixed(1)} Ma), `
    + `${divergentSteps.length} where Published/CO2-Linked disagree`);

  for (const s of lithologyLog) {
    const pub = s.classPublished ?? '(no Published CCD past 140 Ma)';
    const co2 = s.classCo2Linked ?? '(n/a)';
    const flag = s.divergent ? ' &lt;-- DIVERGENT' : '';
    log(`&nbsp;&nbsp;age ${s.ageMa.toFixed(1)} Ma: depth ${s.oceanDepthKm.toFixed(2)} km, `
      + `OVEL ${Number.isNaN(s.ovelCmS) ? 'no data' : s.ovelCmS.toFixed(4)}, `
      + `primary=${s.classPrimary ?? 'n/a'} (published=${pub}, co2-linked=${co2})${flag}`);
  }

  log('<strong>Phase 2 lithology log done</strong> -- real down-core classification, real divergence where it exists.');
}

main().catch((e: Error) => {
  log(`<span style="color:red">ERROR: ${e.message}</span>`);
  console.error(e);
});
