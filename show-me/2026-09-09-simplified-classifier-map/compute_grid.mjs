// Computes the present-day grid with the REAL, deployed production code
// (src/presentDayMap.ts), post-ADR-0012 (OVEL dropped, margin+OTEMP only).
import { writeFileSync } from 'node:fs';
import { loadPresentDayInputs, buildPresentDayGrid } from '../../src/presentDayMap.ts';

const LOCAL_BASE = 'http://localhost:5174/archive';
const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';

const inputs = await loadPresentDayInputs(LOCAL_BASE, GEODE_BASE);
const grid = buildPresentDayGrid(inputs);

const counts = {};
for (const c of grid.classes) counts[c] = (counts[c] ?? 0) + 1;
console.log('class counts:', counts);

writeFileSync('grid.json', JSON.stringify({
  nlon: grid.nlon,
  nlat: grid.nlat,
  classIndex: { clay: 0, 'carbonate-ooze': 1, 'siliceous-ooze': 2 },
  noDataSentinel: 255,
  classes: Array.from(grid.classes),
}));
console.log('wrote grid.json');
