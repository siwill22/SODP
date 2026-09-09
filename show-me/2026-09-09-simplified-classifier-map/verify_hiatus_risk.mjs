import { fetchStaticPolygonData, assignPlate } from '../../src/core/staticPolygons.ts';
import { FrameByteCache } from '../../src/core/frameByteCache.ts';
import { texelIndex, texelToPhysical } from '../../src/core/volume.ts';
import {
  buildLithologyLog, createUnboundedPlateFramePoint, fetchClimateSeriesForCore, fetchCurrentSpeedSeriesForCore,
} from '../../src/syntheticCore.ts';
import { currentErosionRiskFromSpeed, dissolutionRiskFromMargin, combineHiatusRisk } from '../../src/hiatusRisk.ts';

const LOCAL_BASE = 'http://localhost:5174/archive';
const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';

const ageManifest = await (await fetch(`${LOCAL_BASE}/models/basement-age/manifest.json`)).json();
const ageBytes = new Uint8Array(await (await fetch(`${LOCAL_BASE}/models/basement-age/frames/age/std/000.bin`)).arrayBuffer());
const publishedCurve = await (await fetch(`${LOCAL_BASE}/ccd/published_ccd_curve.json`)).json();
const co2LinkedCurve = await (await fetch(`${LOCAL_BASE}/ccd/co2_linked_ccd_curve.json`)).json();
const scotesePolyData = await fetchStaticPolygonData(
  `${LOCAL_BASE}/reconstructions/scotese-paleomap`, 'staticpolygons/geometry.bin', 'staticpolygons/rotations.json',
);
const oceanDepthManifest = await (await fetch(`${GEODE_BASE}/models/bridge-valdes2021-ocean-depth/manifest.json`)).json();
const otempVar = oceanDepthManifest.variables.find((v) => v.id === 'OTEMP');
const ocuruVar = oceanDepthManifest.variables.find((v) => v.id === 'OCURU');
const ocurvVar = oceanDepthManifest.variables.find((v) => v.id === 'OCURV');
const cache = new FrameByteCache(GEODE_BASE);
const res = ageManifest.resolutions[0];

// Equatorial Pacific test point (ADR-0009's own choice) -- old crust, big depth
// range over its lifetime, so nearest-depth-layer selection actually varies.
const point = { lon: -150, lat: 15 };
const idx = texelIndex(res.nlon, res.nlat, point.lon, point.lat);
const basementAgeMa = texelToPhysical(ageManifest.variables[0], ageBytes[idx]);
const assignment = assignPlate(scotesePolyData.polygons, scotesePolyData.table, point, 0);
const framePoint = createUnboundedPlateFramePoint(assignment, scotesePolyData.table, point, 0);

const [otempSeries, currentSpeedSeries] = await Promise.all([
  fetchClimateSeriesForCore(cache, oceanDepthManifest, otempVar, framePoint, scotesePolyData.table, basementAgeMa, 0),
  fetchCurrentSpeedSeriesForCore(cache, oceanDepthManifest, ocuruVar, ocurvVar, framePoint, scotesePolyData.table, basementAgeMa),
]);
const log = buildLithologyLog(
  framePoint, scotesePolyData.table, basementAgeMa, otempSeries, publishedCurve, co2LinkedCurve, false, currentSpeedSeries,
);

console.log(`basementAgeMa=${basementAgeMa.toFixed(1)}, ${log.length} steps`);

// 1. Recompute check: hiatusRisk == combine(currentErosionRisk, dissolutionRisk) exactly.
let combineBad = 0;
for (const s of log) {
  if (s.currentErosionRisk === undefined || s.dissolutionRisk === undefined) continue;
  const expected = combineHiatusRisk(s.currentErosionRisk, s.dissolutionRisk);
  if (Math.abs(s.hiatusRisk - expected) > 1e-12) combineBad++;
}
console.log(`hiatusRisk = combine(current, dissolution) recompute check: ${combineBad === 0 ? 'PASS' : `FAIL (${combineBad})`}`);

// 2. dissolutionRisk recompute check (margin off primary curve + divergent boost).
let dissBad = 0;
for (const s of log) {
  const ccdKm = s.ccdPublishedKm ?? s.ccdCo2LinkedKm;
  if (ccdKm === undefined) continue;
  const expected = dissolutionRiskFromMargin(s.oceanDepthKm - ccdKm, s.divergent);
  if (Math.abs(s.dissolutionRisk - expected) > 1e-12) dissBad++;
}
console.log(`dissolutionRisk recompute check: ${dissBad === 0 ? 'PASS' : `FAIL (${dissBad})`}`);

// 3. currentErosionRisk sanity: bounded [0,1], and monotonic in speed pointwise
//    (spot-check: recompute from the raw speed series by age).
const speedByAge = new Map(currentSpeedSeries.map((s) => [s.age, s.value]));
let riskBad = 0, outOfRange = 0;
for (const s of log) {
  if (s.currentErosionRisk === undefined) continue;
  if (s.currentErosionRisk < 0 || s.currentErosionRisk > 1) outOfRange++;
  const speed = speedByAge.get(s.ageMa);
  const expected = currentErosionRiskFromSpeed(speed);
  if (Math.abs(s.currentErosionRisk - expected) > 1e-12) riskBad++;
}
console.log(`currentErosionRisk recompute check: ${riskBad === 0 ? 'PASS' : `FAIL (${riskBad})`}, out-of-[0,1]: ${outOfRange}`);

// 4. Does nearest-layer selection actually vary across the core's lifetime?
//    (proves Q4's dynamic-layer decision is doing something, not silently
//    falling back to one fixed layer the whole way down.)
const depthLabelsKm = oceanDepthManifest.depth_labels_km;
const layersUsed = new Set(log.map((s) => {
  let best = 0, bestGap = Math.abs(depthLabelsKm[0] - s.oceanDepthKm);
  for (let i = 1; i < depthLabelsKm.length; i++) {
    const gap = Math.abs(depthLabelsKm[i] - s.oceanDepthKm);
    if (gap < bestGap) { best = i; bestGap = gap; }
  }
  return best;
}));
console.log(`distinct nearest depth layers used across this core's lifetime: ${[...layersUsed].sort((a, b) => a - b).join(', ')}`);

console.log('\nsample steps:');
for (const s of log.filter((_, i) => i % Math.max(1, Math.floor(log.length / 8)) === 0)) {
  console.log(`  age=${s.ageMa.toFixed(1)} depth=${s.oceanDepthKm.toFixed(2)}km margin=${(s.oceanDepthKm - (s.ccdPublishedKm ?? s.ccdCo2LinkedKm)).toFixed(2)} `
    + `divergent=${s.divergent} speed=${speedByAge.get(s.ageMa)?.toFixed(3)}m/s `
    + `currentRisk=${s.currentErosionRisk?.toFixed(3)} dissolutionRisk=${s.dissolutionRisk?.toFixed(3)} hiatusRisk=${s.hiatusRisk?.toFixed(3)}`);
}
