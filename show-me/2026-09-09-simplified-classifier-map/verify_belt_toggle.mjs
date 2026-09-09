// Sanity check: Option A (belt) vs Option B (fitted), computed from the
// real deployed code, diffed by |latitude| band -- confirms the belt only
// moves clay->siliceous-ooze, concentrated near the equator, smoothly
// fading (not a hard cutoff), and leaves the high-latitude ring untouched.
import { loadPresentDayInputs, buildPresentDayGrid } from '../../src/presentDayMap.ts';
import { cellCenter } from '../../src/core/volume.ts';

const LOCAL_BASE = 'http://localhost:5174/archive';
const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';

const inputs = await loadPresentDayInputs(LOCAL_BASE, GEODE_BASE);
const fitted = buildPresentDayGrid(inputs, false);
const belt = buildPresentDayGrid(inputs, true);

const NAMES = { 0: 'clay', 1: 'carbonate-ooze', 2: 'siliceous-ooze', 255: 'no-data' };
const bands = [[0, 5], [5, 15], [15, 25], [25, 40], [40, 90]];
const counts = bands.map(() => ({ total: 0, flipped: 0, flipTargets: {} }));

for (let i = 0; i < fitted.classes.length; i++) {
  const iLon = i % fitted.nlon, jLat = Math.floor(i / fitted.nlon);
  const { lat } = cellCenter(fitted.nlon, fitted.nlat, iLon, jLat);
  const absLat = Math.abs(lat);
  const bandIdx = bands.findIndex(([lo, hi]) => absLat >= lo && absLat < hi);
  if (bandIdx < 0) continue;
  const a = fitted.classes[i], b = belt.classes[i];
  if (a === 255) continue;
  counts[bandIdx].total++;
  if (a !== b) {
    counts[bandIdx].flipped++;
    const key = `${NAMES[a]}->${NAMES[b]}`;
    counts[bandIdx].flipTargets[key] = (counts[bandIdx].flipTargets[key] ?? 0) + 1;
  }
}

bands.forEach(([lo, hi], idx) => {
  const c = counts[idx];
  console.log(`|lat| ${lo}-${hi}: ${c.flipped}/${c.total} cells changed (${(100 * c.flipped / c.total).toFixed(1)}%)`, c.flipTargets);
});
