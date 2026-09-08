// Scan several candidate points for a geologically interesting down-core
// history (real class transitions, real CCD crossings, real curve
// divergence) before committing to final figures -- ADR-0009's own
// "Consequences" flagged that the two points tested so far were chosen to
// exercise the machinery, not for geological interest.
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

// Candidates: central/northern Pacific old crust (classic "born near
// equatorial productivity, drifted north into the gyre" story), plus a
// few others for contrast.
const candidates = [
  { name: 'N Pacific old crust A', lon: -170, lat: 25 },
  { name: 'N Pacific old crust B', lon: -160, lat: 20 },
  { name: 'N Pacific old crust C', lon: 170, lat: 30 },
  { name: 'Central Pacific old crust', lon: -150, lat: 15 },
  { name: 'S Pacific old crust', lon: -140, lat: -20 },
  { name: 'W Pacific old crust', lon: 150, lat: 10 },
  { name: 'NW Pacific (Emperor-ish)', lon: 170, lat: 40 },
  { name: 'Equatorial Pacific old crust', lon: -175, lat: 2 },
];

for (const c of candidates) {
  const basementAgeMa = basementAgeAt(c);
  if (basementAgeMa === null) { console.log(c.name, ': no data (land)'); continue; }

  const assignment = assignPlate(polygons, table, c, 0);
  if (!assignment) { console.log(c.name, ': no polygon'); continue; }
  const framePoint = createUnboundedPlateFramePoint(assignment, table, c, 0);

  const model = buildAgeDepthModel(framePoint, table, basementAgeMa, 1);
  const lats = model.map((s) => s.position.lat);
  const latRange = Math.max(...lats) - Math.min(...lats);

  const ovelSeries = await plateFrameAgeSeries(cache, oceanDepthManifest, ovelVar, framePoint, table, undefined, 0);
  const log = buildLithologyLog(framePoint, table, basementAgeMa, ovelSeries, publishedCurve, co2LinkedCurve);
  const classes = new Set(log.map((s) => s.classPrimary).filter(Boolean));
  const divergent = log.filter((s) => s.divergent).length;

  console.log(
    `${c.name.padEnd(28)} age=${basementAgeMa.toFixed(1).padStart(6)} Ma  `
    + `latRange=${latRange.toFixed(1).padStart(5)}deg  steps=${log.length.toString().padStart(3)}  `
    + `classes=${[...classes].join(',').padEnd(35)} divergent=${divergent}`
  );
}
