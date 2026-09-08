// Full logs for three young Atlantic points spanning latitude, chosen
// from explore_atlantic.mjs's scan for contrast: South Atlantic
// (mixed classes), equatorial Atlantic (mixed classes, tests the
// upwelling-band story at shallow depth), North Atlantic at 50N
// (uniform Carbonate -- included as-is, not dropped for being uniform).
import { readFileSync, writeFileSync } from 'node:fs';
import { texelIndex, texelToPhysical } from '/Users/simon/GIT/SODP/src/core/volume.ts';
import { parseStaticPolygons, assignPlate } from '/Users/simon/GIT/SODP/src/core/staticPolygons.ts';
import { plateFrameAgeSeries } from '/Users/simon/GIT/SODP/src/core/queryPoint.ts';
import { FrameByteCache } from '/Users/simon/GIT/SODP/src/core/frameByteCache.ts';
import { buildAgeDepthModel, buildLithologyLog, createUnboundedPlateFramePoint } from '/Users/simon/GIT/SODP/src/syntheticCore.ts';

const REPO = '/Users/simon/GIT/SODP';
const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';

const POINTS = [
  { name: 'S Atlantic', lon: -21, lat: -40 },
  { name: 'Equatorial Atlantic', lon: -28, lat: 0 },
  { name: 'N Atlantic', lon: -32, lat: 50 },
];

const ageManifest = JSON.parse(readFileSync(`${REPO}/archive/models/basement-age/manifest.json`, 'utf8'));
const ageVar = ageManifest.variables[0];
const res = ageManifest.resolutions[0];
const ageBytes = new Uint8Array(readFileSync(`${REPO}/archive/models/basement-age/frames/age/std/000.bin`));

const geomBuf = readFileSync(`${REPO}/archive/reconstructions/scotese-paleomap/staticpolygons/geometry.bin`);
const polygons = parseStaticPolygons(geomBuf.buffer.slice(geomBuf.byteOffset, geomBuf.byteOffset + geomBuf.byteLength));
const table = JSON.parse(readFileSync(`${REPO}/archive/reconstructions/scotese-paleomap/staticpolygons/rotations.json`, 'utf8'));

const publishedCurve = JSON.parse(readFileSync(`${REPO}/archive/ccd/published_ccd_curve.json`, 'utf8'));
const co2LinkedCurve = JSON.parse(readFileSync(`${REPO}/archive/ccd/co2_linked_ccd_curve.json`, 'utf8'));

const oceanDepthManifest = await (await fetch(`${GEODE_BASE}/models/bridge-valdes2021-ocean-depth/manifest.json`)).json();
const ovelVar = oceanDepthManifest.variables.find((v) => v.id === 'OVEL');
const cache = new FrameByteCache(GEODE_BASE);

const results = [];
for (const p of POINTS) {
  const idx = texelIndex(res.nlon, res.nlat, p.lon, p.lat);
  const byte = ageBytes[idx];
  const basementAgeMa = byte === ageManifest.no_data_sentinel ? null : texelToPhysical(ageVar, byte);
  if (basementAgeMa === null) { console.log(p.name, ': no data'); continue; }

  const assignment = assignPlate(polygons, table, p, 0);
  const framePoint = createUnboundedPlateFramePoint(assignment, table, p, 0);
  const ovelSeries = await plateFrameAgeSeries(cache, oceanDepthManifest, ovelVar, framePoint, table, undefined, 0);
  const log = buildLithologyLog(framePoint, table, basementAgeMa, ovelSeries, publishedCurve, co2LinkedCurve);
  const trajectory = buildAgeDepthModel(framePoint, table, basementAgeMa, 1);

  const divergent = log.filter((s) => s.divergent).length;
  console.log(`${p.name}: age=${basementAgeMa.toFixed(1)} Ma, plate=${assignment.plateId}, `
    + `depth today=${trajectory[0].oceanDepthKm.toFixed(2)} km, `
    + `steps=${log.length}, divergent=${divergent}, `
    + `classes=${[...new Set(log.map((s) => s.classPrimary))].join(',')}`);

  results.push({ point: p, basementAgeMa, plateId: assignment.plateId, log, trajectory });
}

writeFileSync(`${import.meta.dirname}/atlantic_points_log.json`, JSON.stringify(results, null, 2));
console.log(`\nwrote atlantic_points_log.json (${results.length} points)`);
