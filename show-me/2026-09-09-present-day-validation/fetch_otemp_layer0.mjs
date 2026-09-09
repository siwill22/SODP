// Fetches OTEMP's age=0, layerIndex=0 (5m depth -- same shallowest-layer
// convention as OVEL) frame from the live Geode archive, using the real
// production code (src/core/volume.ts), for a present-day check of whether
// real paleo/present ocean temperature is a better carbonate-vs-siliceous
// predictor than the |latitude| proxy used in ADR-0010's first fit.
import { writeFileSync } from 'node:fs';
import { loadManifest, fetchVolumeBytes, resolvePath, texelToPhysical } from '../../src/core/volume.ts';

const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';
const manifest = await loadManifest(GEODE_BASE, 'models/bridge-valdes2021-ocean-depth/manifest.json');
const otempVar = manifest.variables.find((v) => v.id === 'OTEMP');
const frame0 = manifest.frames.find((f) => f.age_ma === 0);
const res = manifest.resolutions.find((r) => r.id === manifest.default_resolution);

const path = `${GEODE_BASE}/models/${manifest.id}/${resolvePath(manifest, otempVar.id, frame0.id)}`;
const allLayers = await fetchVolumeBytes(path);
const plane = res.nlon * res.nlat;
const layer0 = allLayers.subarray(0, plane);

const values = Array.from(layer0, (b) => (b === manifest.no_data_sentinel ? null : texelToPhysical(otempVar, b)));
writeFileSync('otemp_layer0.json', JSON.stringify({ nlon: res.nlon, nlat: res.nlat, values }));
console.log(`wrote otemp_layer0.json, ${res.nlon}x${res.nlat}, frame age=${frame0.age_ma}`);
