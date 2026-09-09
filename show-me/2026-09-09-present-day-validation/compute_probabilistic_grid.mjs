// Computes the present-day grid using the REAL production code
// (src/presentDayMap.ts's loadPresentDayInputs + buildPresentDayGrid,
// which now calls ADR-0010's classifyLithologyProbabilistic()), against a
// locally running `npm run dev` server (for the same-origin local archive
// fetches) and the live Geode archive (for OVEL). No reimplementation.
//
// Run: npx tsx compute_probabilistic_grid.mjs   (with `npm run dev` on 5174)
import { writeFileSync } from 'node:fs';
import { loadPresentDayInputs, buildPresentDayGrid } from '../../src/presentDayMap.ts';

const LOCAL_BASE = 'http://localhost:5174/archive';
const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';

const inputs = await loadPresentDayInputs(LOCAL_BASE, GEODE_BASE);
const grid = buildPresentDayGrid(inputs);

const counts = {};
for (const c of grid.classes) counts[c] = (counts[c] ?? 0) + 1;
console.log('class counts:', counts);

writeFileSync('probabilistic_grid.json', JSON.stringify({
  nlon: grid.nlon,
  nlat: grid.nlat,
  classIndex: { clay: 0, 'carbonate-ooze': 1, 'siliceous-ooze': 2 },
  noDataSentinel: 255,
  classes: Array.from(grid.classes),
}));
console.log('wrote probabilistic_grid.json');
