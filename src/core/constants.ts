/**
 * Trimmed one-time copy of Geode's viewer/src/core/constants.ts (ADR-0001).
 * Geode's original also carries three.js render-frame helpers (lonLatToVec3,
 * eastNorthAt, LIGHT_DIR, depthToRadius/radiusToDepth) for its WebGL globe --
 * SODP's v1 UI is a flat 2D map (no three.js, no raycasting), so none of
 * that is needed here. Only LonLat survives: it's the one shared shape every
 * ported core/ function (rotation.ts, staticPolygons.ts, queryPoint.ts)
 * actually passes around.
 */
export interface LonLat {
  lon: number; // degrees, -180..180
  lat: number; // degrees, -90..90
}
