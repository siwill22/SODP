// ADR-0019: generates CURRENT_SPEED_PERCENTILE_TABLE in src/hiatusRisk.ts.
// Third calibration of currentErosionRiskFromSpeed() -- the first two
// (absolute literature threshold, then this model's own logistic centre)
// both depended on the model's absolute speed values, which a ~2-3.75deg
// ocean grid cannot be trusted to get right. This instead ranks each real
// cell's speed against every OTHER real deep-ocean cell BRIDGE-Valdes ever
// produces (layer>=15, >=~2.1km -- the depth range a Synthetic Core step
// actually occupies), across all 109 real Frames -- so currentErosionRisk
// becomes "how anomalously fast is this, relative to this model's own real
// distribution," a much weaker and more defensible claim than an absolute
// erosion-relevant speed this coarse model can't actually resolve.
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
    for (let layer = 15; layer < ndepth; layer++) {
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
  }));
}
speeds.sort((a, b) => a - b);
const pcts = [
  0, 2, 4, 6, 8, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 92, 94, 96, 98, 99, 99.5, 99.9, 99.99, 100,
];
const table = pcts.map((p) => {
  const idx = Math.min(speeds.length - 1, Math.max(0, Math.round((p / 100) * (speeds.length - 1))));
  return [p, Number(speeds[idx].toFixed(5))];
});
console.log(`n=${speeds.length} from ${frameCount} frames`);
console.log(JSON.stringify(table));
