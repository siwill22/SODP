import { writeFileSync } from 'node:fs';
import { loadPresentDayInputs, buildPresentDayGrid } from '../../src/presentDayMap.ts';

const LOCAL_BASE = 'http://localhost:5174/archive';
const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';
const inputs = await loadPresentDayInputs(LOCAL_BASE, GEODE_BASE);
const grid = buildPresentDayGrid(inputs, true);

writeFileSync('grid_belt.json', JSON.stringify({
  nlon: grid.nlon, nlat: grid.nlat, noDataSentinel: 255, classes: Array.from(grid.classes),
}));
console.log('wrote grid_belt.json');
