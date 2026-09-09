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

let bad = 0;
for (const s of log) {
  const expected = 0.38 * Math.exp(0.090 * s.otempC);
  if (Math.abs(s.mgCa - expected) > 1e-9) bad++;
}
console.log(`mgCa recompute check: ${bad === 0 ? 'PASS' : `FAIL (${bad})`}`);
for (const s of log.slice(0, 6)) {
  console.log(`  age=${s.ageMa.toFixed(1)} otempC=${s.otempC.toFixed(1)} delta18O=${s.delta18O.toFixed(2)} mgCa=${s.mgCa.toFixed(2)} class=${s.classPrimary}`);
}
