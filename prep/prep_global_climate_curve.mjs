// Precomputes a real, small, static asset: global-mean OTEMP through time,
// at two depth levels -- layerIndex 0 (~5m, a global mean SEA SURFACE
// TEMPERATURE proxy) and layerIndex 19 (~5.19km, the DEEPEST level BRIDGE-
// Valdes actually simulates, used here as a global mean "bottom water"
// temperature proxy -- not necessarily true seafloor depth everywhere,
// since real ocean depth varies, but the deepest level this model offers)
// -- across ALL 109 real BRIDGE-Valdes ocean-depth frames (0-541 Ma).
//
// Why precomputed rather than fetched live: unlike the existing point-query
// path (one small subarray decoded per frame), a GLOBAL spatial mean needs
// the FULL grid for every frame -- 109 frames x ~1.3MB/frame (all 20 depth
// layers per frame; the archive stores one file per variable per frame with
// every layer concatenated, so there's no way to fetch just 2 layers) =
// ~140MB total, the SAME regardless of which point is queried, unlike the
// present-day map's or a Synthetic Core's per-point fetches. Computing this
// once, offline, into a small JSON (a few KB) and serving it as a static
// asset matches this project's existing CCD-Curve pattern (prep_ccd.py)
// rather than repeating a ~140MB fetch on every app load for a curve that
// never changes with the query point.
//
// .mjs, not .py like this folder's other prep scripts: this needs SODP's
// own binary volume-decode logic (texelToPhysical, the manifest/frame path
// resolution), which already exists in src/core/volume.ts -- reusing it
// directly (this project's own no-reimplementation convention) means this
// has to run under the same TypeScript/Node toolchain the app itself uses,
// not a from-scratch Python reimplementation of the binary format.
//
// Run: npx tsx prep/prep_global_climate_curve.mjs
import { writeFileSync } from 'node:fs';
import { loadManifest, fetchVolumeBytes, resolvePath, texelToPhysical } from '../src/core/volume.ts';

const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';
const manifest = await loadManifest(GEODE_BASE, 'models/bridge-valdes2021-ocean-depth/manifest.json');
const otempVar = manifest.variables.find((v) => v.id === 'OTEMP');
const res = manifest.resolutions.find((r) => r.id === manifest.default_resolution);
const plane = res.nlon * res.nlat;
const sstLayerIndex = 0;
const bottomLayerIndex = res.ndepth - 1;

function spatialMean(layerBytes) {
  let sum = 0, n = 0;
  for (let i = 0; i < plane; i++) {
    if (layerBytes[i] === manifest.no_data_sentinel) continue;
    sum += texelToPhysical(otempVar, layerBytes[i]);
    n++;
  }
  return n > 0 ? sum / n : null;
}

const curve = [];
let done = 0;
for (const frame of manifest.frames) {
  const path = `${GEODE_BASE}/models/${manifest.id}/${resolvePath(manifest, otempVar.id, frame.id)}`;
  const allLayers = await fetchVolumeBytes(path);
  const sstLayer = allLayers.subarray(sstLayerIndex * plane, (sstLayerIndex + 1) * plane);
  const bottomLayer = allLayers.subarray(bottomLayerIndex * plane, (bottomLayerIndex + 1) * plane);
  curve.push({
    age_ma: frame.age_ma,
    sst_c: spatialMean(sstLayer),
    bottom_water_c: spatialMean(bottomLayer),
  });
  done++;
  if (done % 10 === 0 || done === manifest.frames.length) {
    console.log(`${done}/${manifest.frames.length} frames done (age=${frame.age_ma}Ma)`);
  }
}
curve.sort((a, b) => a.age_ma - b.age_ma);

const out = {
  source: manifest.source,
  variable: 'OTEMP',
  sst_layer_index: sstLayerIndex,
  sst_layer_depth_km: manifest.depth_labels_km[sstLayerIndex],
  bottom_layer_index: bottomLayerIndex,
  bottom_layer_depth_km: manifest.depth_labels_km[bottomLayerIndex],
  curve,
};
writeFileSync('archive/climate/bridge_valdes_global_mean_otemp.json', JSON.stringify(out, null, 2));
console.log('wrote archive/climate/bridge_valdes_global_mean_otemp.json');
