import { readFileSync } from 'node:fs';
import { texelIndex, texelToPhysical } from '/Users/simon/GIT/SODP/src/core/volume.ts';
import { parseStaticPolygons, assignPlate } from '/Users/simon/GIT/SODP/src/core/staticPolygons.ts';
import { plateFrameAgeSeries } from '/Users/simon/GIT/SODP/src/core/queryPoint.ts';
import { FrameByteCache } from '/Users/simon/GIT/SODP/src/core/frameByteCache.ts';
import { buildAgeDepthModel, buildLithologyLog, createUnboundedPlateFramePoint } from '/Users/simon/GIT/SODP/src/syntheticCore.ts';

const REPO = '/Users/simon/GIT/SODP';
const GEODE_BASE = 'https://siwill22.github.io/Geode/archive';
const PT = { lon: -150, lat: 15 };

const ageManifest = JSON.parse(readFileSync(`${REPO}/archive/models/basement-age/manifest.json`, 'utf8'));
const ageVar = ageManifest.variables[0];
const res = ageManifest.resolutions[0];
const ageBytes = new Uint8Array(readFileSync(`${REPO}/archive/models/basement-age/frames/age/std/000.bin`));
const idx = texelIndex(res.nlon, res.nlat, PT.lon, PT.lat);
const basementAgeMa = texelToPhysical(ageVar, ageBytes[idx]);

const geomBuf = readFileSync(`${REPO}/archive/reconstructions/scotese-paleomap/staticpolygons/geometry.bin`);
const polygons = parseStaticPolygons(geomBuf.buffer.slice(geomBuf.byteOffset, geomBuf.byteOffset + geomBuf.byteLength));
const table = JSON.parse(readFileSync(`${REPO}/archive/reconstructions/scotese-paleomap/staticpolygons/rotations.json`, 'utf8'));
const assignment = assignPlate(polygons, table, PT, 0);
const framePoint = createUnboundedPlateFramePoint(assignment, table, PT, 0);
console.log('Basement Age:', basementAgeMa.toFixed(2), 'Ma, plate', assignment.plateId);

const publishedCurve = JSON.parse(readFileSync(`${REPO}/archive/ccd/published_ccd_curve.json`, 'utf8'));
const co2LinkedCurve = JSON.parse(readFileSync(`${REPO}/archive/ccd/co2_linked_ccd_curve.json`, 'utf8'));
const oceanDepthManifest = await (await fetch(`${GEODE_BASE}/models/bridge-valdes2021-ocean-depth/manifest.json`)).json();
const ovelVar = oceanDepthManifest.variables.find((v) => v.id === 'OVEL');
const cache = new FrameByteCache(GEODE_BASE);
const ovelSeries = await plateFrameAgeSeries(cache, oceanDepthManifest, ovelVar, framePoint, table, undefined, 0);
const log = buildLithologyLog(framePoint, table, basementAgeMa, ovelSeries, publishedCurve, co2LinkedCurve);

for (const s of log) {
  const flag = s.divergent ? '  <-- DIVERGENT' : '';
  console.log(
    `age ${s.ageMa.toFixed(1).padStart(6)} Ma  lat ${s.position.lat.toFixed(1).padStart(6)}  lon ${s.position.lon.toFixed(1).padStart(7)}  `
    + `depth ${s.oceanDepthKm.toFixed(2)} km  OVEL ${Number.isNaN(s.ovelCmS) ? 'nodata'.padStart(8) : s.ovelCmS.toFixed(5).padStart(8)}  `
    + `pubCCD=${(s.ccdPublishedKm ?? NaN).toFixed?.(2) ?? '-'} co2CCD=${(s.ccdCo2LinkedKm ?? NaN).toFixed?.(2) ?? '-'}  `
    + `primary=${(s.classPrimary ?? 'n/a').padEnd(16)}${flag}`
  );
}

const model = buildAgeDepthModel(framePoint, table, basementAgeMa, 1);
console.log('\ntrajectory steps:', model.length, 'formation at', model[model.length-1].position, 'today at', model[0].position);

import { writeFileSync } from 'node:fs';
writeFileSync('winner_log.json', JSON.stringify({ point: PT, basementAgeMa, plateId: assignment.plateId, log, trajectory: model }, null, 2));
console.log('wrote winner_log.json');
