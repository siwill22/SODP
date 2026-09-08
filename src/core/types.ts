/**
 * Trimmed one-time copy of Geode's viewer/src/core/types.ts (ADR-0001).
 *
 * Deliberately NOT a literal copy. Geode's Manifest/VariableInfo carry
 * fields SODP never reads (default_clip_min/max, default_colormap,
 * high_means, overlay_only, vector_only -- all GPU colour-ramp concerns for
 * a WebGL viewer SODP doesn't have). Two consequences of trimming rather
 * than copying:
 *
 *  - Manifest.type is `string`, not Geode's literal union -- SODP's own
 *    basement-age manifest uses type "basement-age", which isn't a member
 *    of that union and would be a real type error against the original.
 *  - A JSON manifest fetched from Geode's live archive (which DOES carry
 *    every one of Geode's extra fields) still satisfies these interfaces:
 *    TypeScript structural typing allows more fields than declared, and
 *    fetch().json() returns `any` regardless -- same unchecked-cast pattern
 *    Geode's own loadManifest() already relies on.
 */

export interface ResolutionInfo {
  id: string;
  nlon: number;
  nlat: number;
  ndepth: number;
}

export interface FrameInfo {
  id: string;
  age_ma: number;
}

export interface VariableInfo {
  id: string;
  name: string;
  units: string;
  /** Range the uint8 quantisation spans -- what texelToPhysical() decodes against. */
  encode_min: number;
  encode_max: number;
  categorical?: boolean;
  class_names?: string[];
}

export interface Manifest {
  id: string;
  name: string;
  type: string;
  source: string;
  no_data_sentinel?: number;
  /** Real depth (km) per layer index, present only when depth_min_km/
   *  depth_max_km are an INDEX range in disguise (e.g. BRIDGE-Valdes's
   *  ocean-depth Layer) rather than literal depth -- see
   *  core/queryPoint.ts's module doc on why this matters for layerIndex. */
  depth_labels_km?: number[];
  default_resolution: string;
  resolutions: ResolutionInfo[];
  frames: FrameInfo[];
  path_template: string;
  default_variable: string;
  variables: VariableInfo[];
  /** Which variable is this model's own land/ocean validity mask -- see
   *  core/queryPoint.ts's isInvalid(). Absent for a model with full coverage. */
  mask_variable?: string;
}

/** One `ArchiveIndex.reconstruction_models[]` entry. */
export interface ReconstructionEntry {
  id: string;
  name: string;
  source: string;
  path: string;
  has_boundaries: boolean;
  has_static_polygons: boolean;
}

export interface ArchiveIndex {
  reconstruction_models?: ReconstructionEntry[];
}

/** One reconstructable static-polygon set: present-day geometry plus a
 *  rotation table -- the shape core/staticPolygons.ts's
 *  fetchStaticPolygonData() expects. */
export interface StaticPolygonSet {
  geometry: string;
  rotations: string;
}

/** A Reconstruction Model's own manifest.json. */
export interface ReconstructionManifest {
  id: string;
  name: string;
  citation?: string;
  static_polygons?: StaticPolygonSet;
}

export interface RotationTable {
  ages: number[];
  anchor: number;
  plates: Record<string, [number, number, number, number][]>;
}

/** One static-polygon feature in present-day, geographic-frame coordinates. */
export interface StaticPolygon {
  plateId: number;
  continental: boolean;
  /** Larger Ma value: when this crust appeared. */
  beginAge: number;
  /** Smaller Ma value. Expected ~0/-1e9 by construction. */
  endAge: number;
  /** Unit vectors in the geographic frame, present-day, open ring. */
  points: Float32Array;
}
