// Fetches OSAL's age=0, layerIndex=0 (5m depth -- same shallowest-layer
// convention as OVEL/OTEMP) frame from the live Geode archive, using the
// real production code (src/core/volume.ts), to test whether real
// paleo/present ocean salinity separates real warm-water carbonate-ooze
// from real warm-water siliceous-ooze points where OVEL and OTEMP cannot
// (see 2026-09-09-otemp-example-cores/README.md -- the OVELxOTEMP
// interaction term failed at exactly 0% on that split).
import { writeFileSync } from 'node:fs';
import { loadManifest, fetchVolumeBytes, resolvePath, texelToPhysical } from '../../src/core/volume.ts';

const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';
const manifest = await loadManifest(GEODE_BASE, 'models/bridge-valdes2021-ocean-depth/manifest.json');
const osalVar = manifest.variables.find((v) => v.id === 'OSAL');
const frame0 = manifest.frames.find((f) => f.age_ma === 0);
const res = manifest.resolutions.find((r) => r.id === manifest.default_resolution);

const path = `${GEODE_BASE}/models/${manifest.id}/${resolvePath(manifest, osalVar.id, frame0.id)}`;
const allLayers = await fetchVolumeBytes(path);
const plane = res.nlon * res.nlat;
const layer0 = allLayers.subarray(0, plane);

const values = Array.from(layer0, (b) => (b === manifest.no_data_sentinel ? null : texelToPhysical(osalVar, b)));
writeFileSync('osal_layer0.json', JSON.stringify({ nlon: res.nlon, nlat: res.nlat, values }));
console.log(`wrote osal_layer0.json, ${res.nlon}x${res.nlat}, frame age=${frame0.age_ma}`);
