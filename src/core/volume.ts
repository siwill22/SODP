import type { ArchiveIndex, Manifest, VariableInfo } from './types';

/**
 * Trimmed one-time copy of Geode's viewer/src/core/volume.ts (ADR-0001).
 * Dropped: loadVolume(), FrameCache, makeColormapTexture(), loadMask2D() --
 * everything that builds a three.js Data3DTexture/DataTexture for GPU
 * rendering. SODP's v1 UI never renders a volume, it only reads one cell's
 * value at a time (core/queryPoint.ts's ageSeries), so the CPU-only half of
 * this file is all that's needed, and dropping the rest means SODP carries
 * no three.js dependency at all.
 */

export async function loadArchive(base: string): Promise<ArchiveIndex> {
  const r = await fetch(`${base}/archive.json`);
  if (!r.ok) throw new Error(`archive.json: ${r.status}`);
  return r.json();
}

export async function loadManifest(base: string, path: string): Promise<Manifest> {
  const r = await fetch(`${base}/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export function resolvePath(
  m: Manifest, variable: string, frame: string, resolutionId: string = m.default_resolution,
): string {
  return m.path_template
    .replace('{variable}', variable)
    .replace('{resolution}', resolutionId)
    .replace('{frame}', frame);
}

/**
 * Fetch a URL's bytes, transparently un-gzipping a `.gz` file. See Geode's
 * original for why the check is a magic-number sniff, not the `.gz`
 * extension alone (a server may already have decoded Content-Encoding by
 * the time the browser sees the bytes).
 */
export async function fetchVolumeBytes(path: string): Promise<Uint8Array> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  const raw = new Uint8Array(await r.arrayBuffer());

  const gzipped = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  if (!path.endsWith('.gz') || !gzipped) return raw;

  const stream = new Blob([raw as BlobPart]).stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Fetch one variable's raw undecoded bytes for one frame -- the only
 *  fetch path SODP needs, since it never uploads a GPU texture. */
export async function fetchVariableBytes(
  base: string, modelId: string, manifest: Manifest, variableId: string, frameId: string,
  resolutionId: string = manifest.default_resolution,
): Promise<Uint8Array> {
  const path = `${base}/models/${modelId}/${resolvePath(manifest, variableId, frameId, resolutionId)}`;
  return fetchVolumeBytes(path);
}

/** The frame whose age is closest to `age`. Frames need not be evenly spaced. */
export function nearestFrame(m: Manifest, age: number) {
  let best = m.frames[0];
  let bestGap = Math.abs(best.age_ma - age);
  for (const f of m.frames) {
    const gap = Math.abs(f.age_ma - age);
    if (gap < bestGap) { best = f; bestGap = gap; }
  }
  return best;
}

/** A raw uint8 texel (0..255) -> the physical value it encodes. */
export function texelToPhysical(v: VariableInfo, byte: number): number {
  return v.encode_min + (byte / 255) * (v.encode_max - v.encode_min);
}

/** A categorical Variable's already-decoded texelToPhysical() value -> its
 *  class index. FLOOR, never round -- see Geode's original for the exact
 *  encode-at-band-centre reasoning this depends on. */
export function classIndexFromValue(value: number): number {
  return Math.floor(value);
}

export function classNameFor(v: VariableInfo, value: number): string {
  const i = classIndexFromValue(value);
  return v.class_names?.[i] ?? `class ${i}`;
}

/** (lon, lat) -> the flat index into one month's (nlat, nlon) plane. */
export function texelIndex(nlon: number, nlat: number, lon: number, lat: number): number {
  const pLon = (lon + 180) / 360;
  let iLon = Math.floor(pLon * nlon) % nlon;
  if (iLon < 0) iLon += nlon;
  const pLat = (lat + 90) / 180;
  const jLat = Math.min(nlat - 1, Math.max(0, Math.round(pLat * (nlat - 1))));
  return jLat * nlon + iLon;
}

/** (iLon, jLat) -> that cell's own centre. */
export function cellCenter(nlon: number, nlat: number, iLon: number, jLat: number) {
  return {
    lon: ((iLon + 0.5) / nlon) * 360 - 180,
    lat: (jLat / (nlat - 1)) * 180 - 90,
  };
}
