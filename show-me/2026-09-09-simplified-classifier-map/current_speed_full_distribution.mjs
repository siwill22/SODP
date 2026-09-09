// ADR-0019: is BRIDGE-Valdes's own real bottom-current speed field ever
// anywhere near the ~10-20 cm/s literature erosion/winnowing threshold
// currentErosionRiskFromSpeed() was originally centred on? Sweeps every
// deep cell (layer>=12, ~1km+ -- the depth range a real Synthetic Core
// step can occupy, since GDH1's own minimum is 2.6km even at the ridge
// crest) across ALL 109 real Frames. Real finding: no -- p99.9=0.14 m/s,
// global max=0.26 m/s, an order of magnitude below where real point
// current-meter measurements put erosion-relevant flow, because this
// coarse GCM's grid cannot resolve the narrow features that produce real
// bottom-current erosion speeds. currentErosionRiskFromSpeed() was
// recalibrated to this model's own p95 (0.07 m/s) instead -- "fast
// relative to what this model itself resolves," not a real-world
// erosion-relevant speed.
import { loadManifest, fetchVolumeBytes, resolvePath, texelToPhysical } from '../../src/core/volume.ts';

const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';
const manifest = await loadManifest(GEODE_BASE, 'models/bridge-valdes2021-ocean-depth/manifest.json');
const ocuruVar = manifest.variables.find((v) => v.id === 'OCURU');
const ocurvVar = manifest.variables.find((v) => v.id === 'OCURV');
const res = manifest.resolutions.find((r) => r.id === manifest.default_resolution);
const { nlon, nlat, ndepth } = res;
const plane = nlon * nlat;
const maskVar = manifest.mask_variable;
const sentinel = manifest.no_data_sentinel;

console.log(`${manifest.frames.length} frames total, sweeping all of them, layers >=12 (>=~1km depth)...`);

const speeds = [];
let frameCount = 0;
const CONC = 8;
for (let start = 0; start < manifest.frames.length; start += CONC) {
  const batch = manifest.frames.slice(start, start + CONC);
  // eslint-disable-next-line no-await-in-loop
  await Promise.all(batch.map(async (frame) => {
    const [uBytes, vBytes, maskBytes] = await Promise.all([
      fetchVolumeBytes(`${GEODE_BASE}/models/${manifest.id}/${resolvePath(manifest, ocuruVar.id, frame.id)}`),
      fetchVolumeBytes(`${GEODE_BASE}/models/${manifest.id}/${resolvePath(manifest, ocurvVar.id, frame.id)}`),
      maskVar ? fetchVolumeBytes(`${GEODE_BASE}/models/${manifest.id}/${resolvePath(manifest, maskVar, frame.id)}`) : Promise.resolve(null),
    ]);
    for (let layer = 12; layer < ndepth; layer++) {
      const off = layer * plane;
      for (let i = 0; i < plane; i++) {
        const ub = uBytes[off + i], vb = vBytes[off + i];
        if (maskBytes && maskBytes[off + i] < 128) continue;
        if (sentinel !== undefined && (ub === sentinel || vb === sentinel)) continue;
        const u = texelToPhysical(ocuruVar, ub), v = texelToPhysical(ocurvVar, vb);
        speeds.push(Math.hypot(u, v));
      }
    }
    frameCount += 1;
    if (frameCount % 20 === 0) console.error(`  ...${frameCount}/${manifest.frames.length} frames`);
  }));
}

speeds.sort((a, b) => a - b);
const pct = (p) => speeds[Math.floor(p * speeds.length)];
console.log(`\nTOTAL across all ${frameCount} frames, deep cells (layer>=12): n=${speeds.length}`);
console.log(`p50=${pct(0.5).toFixed(4)} p90=${pct(0.9).toFixed(4)} p95=${pct(0.95).toFixed(4)} p99=${pct(0.99).toFixed(4)} `
  + `p99.5=${pct(0.995).toFixed(4)} p99.9=${pct(0.999).toFixed(4)} p99.99=${pct(0.9999).toFixed(4)} max=${speeds[speeds.length - 1].toFixed(4)} m/s`);
