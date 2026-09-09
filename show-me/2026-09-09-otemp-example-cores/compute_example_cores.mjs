// Computes updated Synthetic Core down-core logs using the REAL production
// code (src/syntheticCore.ts, now ADR-0011's probabilistic + OTEMP
// classifier), for the same points used in
// show-me/2026-09-09-synthetic-core-skeleton's original eye-check --
// (-150, 15), the "textbook story" point (85.33 Ma, equatorial formation
// drifting into the gyre), and (-68, 32), old Western Atlantic (137.33 Ma,
// previously flat all-Clay under the deterministic rule).
//
// For a fair before/after comparison, ALSO reconstructs what the OLD
// deterministic rule (classifyLithology(), ADR-0007) would have said at
// each of the SAME real steps -- same oceanDepthKm/ovelCmS/ccdKm driver
// values buildLithologyLog() already computed, not a second independent
// fetch -- so any difference in the two logs is purely the classifier,
// not different underlying data.
//
// Run: npx tsx compute_example_cores.mjs   (with `npm run dev` on 5174)
import { writeFileSync } from 'node:fs';
import { fetchStaticPolygonData, assignPlate } from '../../src/core/staticPolygons.ts';
import { FrameByteCache } from '../../src/core/frameByteCache.ts';
import { texelIndex, texelToPhysical } from '../../src/core/volume.ts';
import {
  buildAgeDepthModel, buildLithologyLog, createUnboundedPlateFramePoint, fetchClimateSeriesForCore,
} from '../../src/syntheticCore.ts';
import { classifyLithology, classifyLithologyProbabilistic } from '../../src/lithology.ts';

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
const ovelVar = oceanDepthManifest.variables.find((v) => v.id === 'OVEL');
const otempVar = oceanDepthManifest.variables.find((v) => v.id === 'OTEMP');
const cache = new FrameByteCache(GEODE_BASE);
const res = ageManifest.resolutions[0];

async function computeCore(name, point) {
  const idx = texelIndex(res.nlon, res.nlat, point.lon, point.lat);
  const basementAgeMa = texelToPhysical(ageManifest.variables[0], ageBytes[idx]);
  const assignment = assignPlate(scotesePolyData.polygons, scotesePolyData.table, point, 0);
  const framePoint = createUnboundedPlateFramePoint(assignment, scotesePolyData.table, point, 0);

  const [ovelSeries, otempSeries] = await Promise.all([
    fetchClimateSeriesForCore(cache, oceanDepthManifest, ovelVar, framePoint, scotesePolyData.table, basementAgeMa, 0),
    fetchClimateSeriesForCore(cache, oceanDepthManifest, otempVar, framePoint, scotesePolyData.table, basementAgeMa, 0),
  ]);

  const newLog = buildLithologyLog(
    framePoint, scotesePolyData.table, basementAgeMa, ovelSeries, otempSeries, publishedCurve, co2LinkedCurve,
  );
  const trajectory = buildAgeDepthModel(framePoint, scotesePolyData.table, basementAgeMa, 1);

  // Reconstruct the OLD deterministic-rule log AND the new classifier's full
  // probability distribution at each step, from newLog's own already-computed
  // driver values -- no second fetch, no independent recomputation of depth/OVEL.
  const enriched = newLog.map((step) => {
    const oldClassPublished = step.ccdPublishedKm === undefined ? undefined
      : classifyLithology({ oceanDepthKm: step.oceanDepthKm, ccdKm: step.ccdPublishedKm, ovelCmS: step.ovelCmS });
    const probs = classifyLithologyProbabilistic({
      oceanDepthKm: step.oceanDepthKm,
      ccdKm: step.ccdPublishedKm ?? step.ccdCo2LinkedKm,
      ovelCmS: step.ovelCmS,
      otempC: step.otempC,
    });
    return { ...step, oldClassPublished, probs };
  });

  return {
    name, point, basementAgeMa,
    formation: trajectory[trajectory.length - 1]?.position ?? point,
    trajectory: trajectory.map((s) => ({ ageMa: s.ageMa, position: s.position, oceanDepthKm: s.oceanDepthKm })),
    log: enriched,
  };
}

const cores = [
  await computeCore('equatorial-pacific-textbook', { lon: -150, lat: 15 }),
  await computeCore('old-w-atlantic', { lon: -68, lat: 32 }),
];

for (const core of cores) {
  const oldClasses = core.log.map((s) => s.oldClassPublished);
  const newClasses = core.log.map((s) => s.classPublished);
  const flips = core.log.filter((s) => s.oldClassPublished !== s.classPublished).length;
  console.log(`${core.name}: basementAge=${core.basementAgeMa.toFixed(1)}Ma, ${core.log.length} steps, `
    + `${flips} steps changed class (old->new)`);
  console.log('  old classes:', [...new Set(oldClasses)]);
  console.log('  new classes:', [...new Set(newClasses)]);
}

writeFileSync('example_cores.json', JSON.stringify(cores, null, 2));
console.log('\nwrote example_cores.json');
