// Real, independent cross-check of mgCaFromTemperature() (ADR-0018): same
// approach as check_delta18o.mjs, this project's own present-day OTEMP
// (layer 0, age=0) through the exact production equation, compared against
// REAL PUBLISHED G. ruber (white) Mg/Ca at 8 real core-top sites.
//
// Data: Johnstone, Elderfield & Yu (2011)'s core-top compilation, PANGAEA
// https://doi.pangaea.de/10.1594/PANGAEA.807074 -- G. ruber w Mg/Ca,
// tropical/subtropical Pacific/Atlantic/Indian Ocean, real box-core
// samples. Note: G. ruber's own real Mg/Ca-SST calibrations (e.g. Anand
// 2003's OWN dataset partly overlaps this kind of compilation) aren't
// perfectly independent of the Anand et al. (2003) equation this project
// uses -- but what's being checked here isn't the equation's math (already
// verified against the published source, ADR-0018), it's whether THIS
// PROJECT'S OWN modeled present-day OTEMP, run through that equation,
// lands near real observations -- a check on the full pipeline (BRIDGE-
// Valdes OTEMP realism + the equation), not the equation in isolation.
import { readFileSync } from 'node:fs';
import { loadManifest, fetchVolumeBytes, resolvePath, texelIndex, texelToPhysical, cellCenter } from '../../src/core/volume.ts';
import { mgCaFromTemperature } from '../../src/proxies.ts';

const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';
const sites = JSON.parse(readFileSync(new URL('./coretop_mgca_sites.json', import.meta.url)));

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
const layer0 = allLayers.subarray(0, plane);

console.log('site            lat     lon    grid-cell(lon,lat)   OTEMP(degC)  real Mg/Ca  model Mg/Ca  residual');
let n = 0, sumAbsResid = 0, sumResid = 0;
for (const site of sites) {
  const idx = texelIndex(nlon, nlat, site.lon, site.lat);
  const byte = layer0[idx];
  const cell = cellCenter(nlon, nlat, idx % nlon, Math.floor(idx / nlon));
  if (byte === sentinel) {
    console.log(`${site.event.padEnd(15)} ${site.lat.toFixed(2).padStart(6)} ${site.lon.toFixed(2).padStart(7)}   NO OCEAN DATA AT NEAREST GRID CELL (${cell.lon.toFixed(1)}, ${cell.lat.toFixed(1)})`);
    continue;
  }
  const otempC = texelToPhysical(otempVar, byte);
  const modelMgCa = mgCaFromTemperature(otempC);
  const resid = modelMgCa - site.mgca;
  n += 1; sumAbsResid += Math.abs(resid); sumResid += resid;
  console.log(
    `${site.event.padEnd(15)} ${site.lat.toFixed(2).padStart(6)} ${site.lon.toFixed(2).padStart(7)}   `
    + `(${cell.lon.toFixed(1)}, ${cell.lat.toFixed(1)})           ${otempC.toFixed(1).padStart(5)}       `
    + `${site.mgca.toFixed(2).padStart(6)}      ${modelMgCa.toFixed(2).padStart(6)}     ${resid >= 0 ? '+' : ''}${resid.toFixed(2)}`,
  );
}
console.log(`\nn=${n}/${sites.length} sites with real ocean data at nearest grid cell`);
console.log(`mean residual (model - real): ${(sumResid / n).toFixed(2)} mmol/mol`);
console.log(`mean absolute residual: ${(sumAbsResid / n).toFixed(2)} mmol/mol`);
