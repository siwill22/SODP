import { fetchStaticPolygonData, assignPlate } from '../../src/core/staticPolygons.ts';
import { FrameByteCache } from '../../src/core/frameByteCache.ts';
import { texelIndex, texelToPhysical } from '../../src/core/volume.ts';
import { buildLithologyLog, createUnboundedPlateFramePoint, fetchClimateSeriesForCore } from '../../src/syntheticCore.ts';

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
const cache = new FrameByteCache(GEODE_BASE);
const res = ageManifest.resolutions[0];

const point = { lon: -150, lat: 15 };
const idx = texelIndex(res.nlon, res.nlat, point.lon, point.lat);
const basementAgeMa = texelToPhysical(ageManifest.variables[0], ageBytes[idx]);
const assignment = assignPlate(scotesePolyData.polygons, scotesePolyData.table, point, 0);
const framePoint = createUnboundedPlateFramePoint(assignment, scotesePolyData.table, point, 0);
const otempSeries = await fetchClimateSeriesForCore(cache, oceanDepthManifest, otempVar, framePoint, scotesePolyData.table, basementAgeMa, 0);
const log = buildLithologyLog(framePoint, scotesePolyData.table, basementAgeMa, otempSeries, publishedCurve, co2LinkedCurve);

let badSum = 0;
for (const s of log) {
  if (!s.probsPrimary) continue;
  const sum = Object.values(s.probsPrimary).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) badSum++;
}
console.log(`probsPrimary sums to 1 check: ${badSum === 0 ? 'PASS' : `FAIL (${badSum} steps)`}`);

console.log('\nsample steps (age, class, probs):');
for (const s of log.slice(0, 6)) {
  const p = s.probsPrimary;
  console.log(`  age=${s.ageMa.toFixed(1)} class=${s.classPrimary}`,
    p ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.toFixed(3)])) : 'undefined');
}
