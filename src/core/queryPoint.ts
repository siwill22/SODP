import type { LonLat } from './constants';
import type { FrameByteCache } from './frameByteCache';
import { CONCURRENCY, mapPool } from './timeSeries';
import { cellCenter, texelIndex, texelToPhysical } from './volume';
import { positionAt, type PlateFramePoint } from './staticPolygons';
import type { Manifest, RotationTable, VariableInfo } from './types';

/**
 * Trimmed one-time copy of Geode's viewer/src/core/queryPoint.ts (ADR-0001).
 * Dropped monthProfile()/plateFrameMonthProfile() -- both read a single
 * already-loaded Data3DTexture Frame, a GPU-rendering concern SODP has no
 * use for (see volume.ts's own trim note). Kept ageSeries() and
 * plateFrameAgeSeries(): "how has this cell changed across geological time"
 * is exactly what the Productivity Signal (OVEL) needs, at a fixed point
 * for Phase 1 and a Plate-Frame Point for Phase 2.
 *
 * ONE REAL CHANGE, not just a trim: both functions gained a `layerIndex`
 * parameter, default `ndepth - 1` (Geode's original hardcoded behaviour,
 * preserved as the default since it's still correct for a climate-MONTHLY
 * manifest, where the last layer is the Annual mean). Geode never needed
 * anything else because it never reads a climate-ocean-depth manifest
 * through this path. SODP does -- BRIDGE-Valdes's ocean-depth Layer uses
 * the SAME "index range in disguise" trick as Month (see Manifest's own
 * depth_labels_km doc comment): depth_min_km=0, depth_max_km=ndepth-1, with
 * real depths in depth_labels_km. `ndepth - 1` there is the DEEPEST level
 * (5.19 km for BRIDGE-Valdes), not a surface annual mean. Reading OVEL with
 * the original hardcoded default silently pulled abyssal vertical velocity
 * instead of near-surface upwelling -- confirmed directly: it returned the
 * no-data sentinel at an equatorial Mid-Atlantic Ridge test point, because
 * the ridge crest there sits shallower than 5.19 km. The Productivity
 * Signal (CONTEXT.md) must pass layerIndex=0 (shallowest depth_labels_km
 * entry) explicitly.
 */

export interface CellSample {
  cell: LonLat;
  /** NaN if this cell was masked or held the no-data sentinel at this Frame. */
  value: number;
}

export interface NoDataRule {
  maskBytes?: Uint8Array | null;
  sentinel?: number;
}

function isInvalid(idx: number, byte: number, rule?: NoDataRule): boolean {
  if (!rule) return false;
  if (rule.maskBytes && rule.maskBytes[idx] < 128) return true;
  if (rule.sentinel !== undefined && byte === rule.sentinel) return true;
  return false;
}

/** Age Series (point): one value per Frame of `manifest`, at the grid cell
 *  nearest `at`, one fixed layer -- Annual for a climate-monthly manifest
 *  (layerIndex default, `ndepth - 1`), an explicit depth level's INDEX for
 *  a climate-ocean-depth manifest (see this file's module doc). */
export async function ageSeries(
  cache: FrameByteCache, manifest: Manifest, variable: VariableInfo, at: LonLat,
  resolutionId: string = manifest.default_resolution,
  layerIndex?: number,
): Promise<(CellSample & { age: number })[]> {
  const res = manifest.resolutions.find((r) => r.id === resolutionId);
  if (!res) throw new Error(`${manifest.id}: no resolution ${resolutionId}`);
  const { nlon, nlat, ndepth } = res;
  const plane = nlon * nlat;
  const layerOffset = (layerIndex ?? ndepth - 1) * plane;
  const maskVar = manifest.mask_variable;
  const sentinel = manifest.no_data_sentinel;

  const idx = texelIndex(nlon, nlat, at.lon, at.lat);
  const cell = cellCenter(nlon, nlat, idx % nlon, Math.floor(idx / nlon));

  return mapPool(manifest.frames, CONCURRENCY, async (frame) => {
    const [valueBytes, maskBytes] = await Promise.all([
      cache.get(manifest, variable.id, frame.id, resolutionId),
      maskVar ? cache.get(manifest, maskVar, frame.id, resolutionId) : Promise.resolve(null),
    ]);
    const byte = valueBytes[layerOffset + idx];
    const invalid = isInvalid(idx, byte, { maskBytes, sentinel });
    return { age: frame.age_ma, cell, value: invalid ? NaN : texelToPhysical(variable, byte) };
  });
}

/** Age Series for a Plate-Frame Point: the grid cell moves with the point's
 *  assigned Plate instead of staying fixed. Frames older than
 *  `point.beginAge` are left out entirely. */
export async function plateFrameAgeSeries(
  cache: FrameByteCache, manifest: Manifest, variable: VariableInfo,
  point: PlateFramePoint, table: RotationTable,
  resolutionId: string = manifest.default_resolution,
  layerIndex?: number,
): Promise<(CellSample & { age: number })[]> {
  const res = manifest.resolutions.find((r) => r.id === resolutionId);
  if (!res) throw new Error(`${manifest.id}: no resolution ${resolutionId}`);
  const { nlon, nlat, ndepth } = res;
  const plane = nlon * nlat;
  const layerOffset = (layerIndex ?? ndepth - 1) * plane;
  const maskVar = manifest.mask_variable;
  const sentinel = manifest.no_data_sentinel;

  const frames = manifest.frames.filter((f) => f.age_ma <= point.beginAge);

  return mapPool(frames, CONCURRENCY, async (frame) => {
    const at = positionAt(point, table, frame.age_ma)!; // frames filtered above, so never null
    const idx = texelIndex(nlon, nlat, at.lon, at.lat);
    const cell = cellCenter(nlon, nlat, idx % nlon, Math.floor(idx / nlon));

    const [valueBytes, maskBytes] = await Promise.all([
      cache.get(manifest, variable.id, frame.id, resolutionId),
      maskVar ? cache.get(manifest, maskVar, frame.id, resolutionId) : Promise.resolve(null),
    ]);
    const byte = valueBytes[layerOffset + idx];
    const invalid = isInvalid(idx, byte, { maskBytes, sentinel });
    return { age: frame.age_ma, cell, value: invalid ? NaN : texelToPhysical(variable, byte) };
  });
}
