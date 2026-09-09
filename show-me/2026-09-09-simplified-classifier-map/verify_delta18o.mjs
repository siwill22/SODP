// Sanity check ADR-0014's delta18O wiring against the real production
// code end-to-end: gated correctly on classPrimary === 'carbonate-ooze',
// and values in a physically sensible range (cold ~ +4, warm ~ -3 permil
// VPDB), for a real point with a real mixed history.
import { fetchStaticPolygonData, assignPlate } from '../../src/core/staticPolygons.ts';
import { FrameByteCache } from '../../src/core/frameByteCache.ts';
import { texelIndex, texelToPhysical } from '../../src/core/volume.ts';
import {
  buildLithologyLog, createUnboundedPlateFramePoint, fetchClimateSeriesForCore,
} from '../../src/syntheticCore.ts';

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

async function run(name, point) {
  const idx = texelIndex(res.nlon, res.nlat, point.lon, point.lat);
  const basementAgeMa = texelToPhysical(ageManifest.variables[0], ageBytes[idx]);
  const assignment = assignPlate(scotesePolyData.polygons, scotesePolyData.table, point, 0);
  const framePoint = createUnboundedPlateFramePoint(assignment, scotesePolyData.table, point, 0);
  const otempSeries = await fetchClimateSeriesForCore(
    cache, oceanDepthManifest, otempVar, framePoint, scotesePolyData.table, basementAgeMa, 0,
  );
  const log = buildLithologyLog(framePoint, scotesePolyData.table, basementAgeMa, otempSeries, publishedCurve, co2LinkedCurve);

  console.log(`\n=== ${name} (${point.lon}, ${point.lat}), basement age ${basementAgeMa.toFixed(1)} Ma, ${log.length} steps ===`);
  // ADR-0016: delta18O is now defined whenever OTEMP is valid, regardless of
  // classPrimary -- always computed, paired with P(carbonate-ooze) instead
  // of gated on the argmax label.
  let badGating = 0;
  for (const s of log) {
    const gatingOk = (!Number.isNaN(s.otempC)) === (s.delta18O !== undefined);
    if (!gatingOk) badGating++;
  }
  console.log(`gating check (delta18O defined iff otempC valid): ${badGating === 0 ? 'PASS' : `FAIL (${badGating} mismatches)`}`);
  for (const s of log.slice(0, 6)) {
    const pCarb = s.probsPrimary?.['carbonate-ooze'];
    console.log(`  age=${s.ageMa.toFixed(1)}Ma otempC=${s.otempC.toFixed(1)} class=${s.classPrimary} `
      + `delta18O=${s.delta18O?.toFixed(2)} P(carb)=${pCarb === undefined ? '-' : (pCarb * 100).toFixed(0) + '%'}`);
  }
}

await run('old W. Atlantic', { lon: -68, lat: 32 });
await run('equatorial Pacific', { lon: -150, lat: 15 });
