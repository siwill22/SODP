// Same scan as explore_candidates.mjs, but for the Atlantic and biased
// toward younger, shallower crust -- user request: "try atlantic, try
// some places where crust is younger, shallower". Young crust (GDH1) sits
// well above typical CCD values almost everywhere, so the interesting
// question here is less "does it cross the CCD" and more "does OVEL sign
// alone decide Carbonate vs Clay the same way it decided Siliceous vs
// Clay for the old Pacific points" -- plus whether Phase 2's GLOBAL CCD
// curve (no per-basin split, unlike Phase 1's ADR-0008 fix) matters at
// Atlantic depths.
import { readFileSync } from 'node:fs';
import { texelIndex, texelToPhysical } from '/Users/simon/GIT/SODP/src/core/volume.ts';
import { parseStaticPolygons, assignPlate } from '/Users/simon/GIT/SODP/src/core/staticPolygons.ts';
import { plateFrameAgeSeries } from '/Users/simon/GIT/SODP/src/core/queryPoint.ts';
import { FrameByteCache } from '/Users/simon/GIT/SODP/src/core/frameByteCache.ts';
import { buildAgeDepthModel, buildLithologyLog, createUnboundedPlateFramePoint } from '/Users/simon/GIT/SODP/src/syntheticCore.ts';

const REPO = '/Users/simon/GIT/SODP';
const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';

const ageManifest = JSON.parse(readFileSync(`${REPO}/archive/models/basement-age/manifest.json`, 'utf8'));
const ageVar = ageManifest.variables[0];
const res = ageManifest.resolutions[0];
const ageBytes = new Uint8Array(readFileSync(`${REPO}/archive/models/basement-age/frames/age/std/000.bin`));

function basementAgeAt(pt) {
  const idx = texelIndex(res.nlon, res.nlat, pt.lon, pt.lat);
  const byte = ageBytes[idx];
  if (byte === ageManifest.no_data_sentinel) return null;
  return texelToPhysical(ageVar, byte);
}

const geomBuf = readFileSync(`${REPO}/archive/reconstructions/scotese-paleomap/staticpolygons/geometry.bin`);
const polygons = parseStaticPolygons(geomBuf.buffer.slice(geomBuf.byteOffset, geomBuf.byteOffset + geomBuf.byteLength));
const table = JSON.parse(readFileSync(`${REPO}/archive/reconstructions/scotese-paleomap/staticpolygons/rotations.json`, 'utf8'));

const publishedCurve = JSON.parse(readFileSync(`${REPO}/archive/ccd/published_ccd_curve.json`, 'utf8'));
const co2LinkedCurve = JSON.parse(readFileSync(`${REPO}/archive/ccd/co2_linked_ccd_curve.json`, 'utf8'));

const oceanDepthManifest = await (await fetch(`${GEODE_BASE}/models/bridge-valdes2021-ocean-depth/manifest.json`)).json();
const ovelVar = oceanDepthManifest.variables.find((v) => v.id === 'OVEL');
const cache = new FrameByteCache(GEODE_BASE);

// Spread across latitudes, all young (~18-22 Ma) crust from the scan above.
const candidates = [
  { name: 'S Atlantic (-40)', lon: -21, lat: -40 },
  { name: 'S Atlantic (-20)', lon: -16, lat: -20 },
  { name: 'S Atlantic (-10)', lon: -17, lat: -10 },
  { name: 'Equatorial Atlantic (-2)', lon: -16, lat: -2 },
  { name: 'Equatorial Atlantic (0)', lon: -28, lat: 0 },
  { name: 'Equatorial Atlantic (2)', lon: -34, lat: 2 },
  { name: 'N Atlantic (10)', lon: -38, lat: 10 },
  { name: 'N Atlantic (20)', lon: -43, lat: 20 },
  { name: 'N Atlantic (30)', lon: -39, lat: 30 },
  { name: 'N Atlantic (40)', lon: -33, lat: 40 },
  { name: 'N Atlantic (50)', lon: -32, lat: 50 },
];

for (const c of candidates) {
  const basementAgeMa = basementAgeAt(c);
  if (basementAgeMa === null) { console.log(c.name, ': no data'); continue; }

  const assignment = assignPlate(polygons, table, c, 0);
  if (!assignment) { console.log(c.name, ': no polygon'); continue; }
  const framePoint = createUnboundedPlateFramePoint(assignment, table, c, 0);

  const model = buildAgeDepthModel(framePoint, table, basementAgeMa, 1);
  const todayDepth = model[0].oceanDepthKm;
  const formDepth = model[model.length - 1].oceanDepthKm;

  const ovelSeries = await plateFrameAgeSeries(cache, oceanDepthManifest, ovelVar, framePoint, table, undefined, 0);
  const log = buildLithologyLog(framePoint, table, basementAgeMa, ovelSeries, publishedCurve, co2LinkedCurve);
  const classes = new Set(log.map((s) => s.classPrimary).filter(Boolean));
  const divergent = log.filter((s) => s.divergent).length;

  console.log(
    `${c.name.padEnd(26)} age=${basementAgeMa.toFixed(1).padStart(5)} Ma  `
    + `depth today=${todayDepth.toFixed(2)} form=${formDepth.toFixed(2)} km  steps=${log.length.toString().padStart(2)}  `
    + `classes=${[...classes].join(',').padEnd(35)} divergent=${divergent}`
  );
}
