// Real, independent cross-check of delta18OFromTemperature() (ADR-0014):
// query this project's OWN present-day OTEMP (BRIDGE-Valdes, layer 0,
// age=0) at 10 real core-top sites, run it through the exact production
// equation, and compare to REAL PUBLISHED planktic foraminiferal delta18O
// at those same sites -- G. ruber (white), a shallow mixed-layer species,
// the closest real analog to "calcite in equilibrium with surface OTEMP"
// this project's generic (non-species-specific) equation assumes.
//
// Data: Anderson & Mulitza (2001), PANGAEA
// https://doi.pangaea.de/10.1594/PANGAEA.60896 -- a real compilation of
// planktic d18O from core-top (surface sediment) samples, not something
// generated for this check. 10 sites picked (coretop_sites.json) spanning
// -40 to 45 degrees latitude, Atlantic/Pacific/Indian basins, all deep
// water (>2000m, avoiding shelf/marginal-sea effects) -- one representative
// site per 10-degree latitude band, preferring basin diversity.
import { readFileSync } from 'node:fs';
import { loadManifest, fetchVolumeBytes, resolvePath, texelIndex, texelToPhysical, cellCenter } from '../../src/core/volume.ts';
import { delta18OFromTemperature } from '../../src/proxies.ts';

const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';
const sites = JSON.parse(readFileSync(new URL('./coretop_sites.json', import.meta.url)));

const manifest = await loadManifest(GEODE_BASE, 'models/bridge-valdes2021-ocean-depth/manifest.json');
const otempVar = manifest.variables.find((v) => v.id === 'OTEMP');
const res = manifest.resolutions.find((r) => r.id === manifest.default_resolution);
const { nlon, nlat } = res;
const plane = nlon * nlat;
const frame0 = manifest.frames.find((f) => f.age_ma === 0);
const sentinel = manifest.no_data_sentinel;

const allLayers = await fetchVolumeBytes(
  `${GEODE_BASE}/models/${manifest.id}/${resolvePath(manifest, otempVar.id, frame0.id)}`,
);
const layer0 = allLayers.subarray(0, plane); // layer 0 = shallowest, ~5m -- see queryPoint.ts's module doc

const results = [];
for (const site of sites) {
  const idx = texelIndex(nlon, nlat, site.lon, site.lat);
  const byte = layer0[idx];
  const cell = cellCenter(nlon, nlat, idx % nlon, Math.floor(idx / nlon));
  if (byte === sentinel) {
    results.push({ ...site, cell, otempC: null, modelD18O: null });
    continue;
  }
  const otempC = texelToPhysical(otempVar, byte);
  const modelD18O = delta18OFromTemperature(otempC);
  results.push({ ...site, cell, otempC, modelD18O });
}

console.log('site                 lat     lon    grid-cell(lon,lat)   OTEMP(degC)  real d18O  model d18O  residual');
let n = 0, sumAbsResid = 0, sumResid = 0;
for (const r of results) {
  if (r.otempC === null) {
    console.log(`${r.event.padEnd(20)} ${r.lat.toFixed(2).padStart(6)} ${r.lon.toFixed(2).padStart(7)}   NO OCEAN DATA AT NEAREST GRID CELL (${r.cell.lon.toFixed(1)}, ${r.cell.lat.toFixed(1)})`);
    continue;
  }
  const resid = r.modelD18O - r.d18o;
  n += 1; sumAbsResid += Math.abs(resid); sumResid += resid;
  console.log(
    `${r.event.padEnd(20)} ${r.lat.toFixed(2).padStart(6)} ${r.lon.toFixed(2).padStart(7)}   `
    + `(${r.cell.lon.toFixed(1)}, ${r.cell.lat.toFixed(1)})           ${r.otempC.toFixed(1).padStart(5)}       `
    + `${r.d18o.toFixed(2).padStart(6)}     ${r.modelD18O.toFixed(2).padStart(6)}     ${resid >= 0 ? '+' : ''}${resid.toFixed(2)}`,
  );
}
console.log(`\nn=${n}/${sites.length} sites with real ocean data at nearest grid cell`);
console.log(`mean residual (model - real): ${(sumResid / n).toFixed(2)} permil`);
console.log(`mean absolute residual: ${(sumAbsResid / n).toFixed(2)} permil`);
