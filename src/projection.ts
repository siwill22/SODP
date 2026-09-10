/**
 * Projection abstraction (ADR-0023): the seam that lets one canvas render
 * loop (renderProjectedGrid in main.ts) serve both the original flat map
 * and the new globe, and lets click handling stay in lon/lat space
 * regardless of which is on screen.
 *
 * Both directions are needed: screenToLonLat for painting (walk every
 * canvas pixel, ask "what does this pixel show") and for turning a click
 * into a query point; lonLatToScreen is not currently called by anything
 * (painting is destination-driven), but is kept symmetric on the interface
 * since a screen-space overlay (e.g. a marker at the clicked point) is the
 * obvious next consumer and would need it.
 */
import type { LonLat } from './core/constants';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Current globe rotation -- the geographic point currently centered under
 *  the view. Equirectangular ignores this; it has no rotation. */
export interface GlobeView {
  lon0: number;
  lat0: number;
}

export interface Projection {
  id: 'equirectangular' | 'orthographic';
  /** Canvas pixel -> geographic point, or undefined if the pixel falls
   *  outside the map/globe (letterbox margin, or the far hemisphere). */
  screenToLonLat(px: number, py: number, w: number, h: number, view: GlobeView): LonLat | undefined;
  /** Geographic point -> canvas pixel, or undefined if it's not visible
   *  (back-facing, for the globe). */
  lonLatToScreen(p: LonLat, w: number, h: number, view: GlobeView): { x: number; y: number } | undefined;
}

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** The letterboxed rect a 2:1 (lon:lat) equirectangular map occupies inside
 *  a canvas of arbitrary aspect ratio -- centered, as large as fits. */
function equirectRect(w: number, h: number) {
  const mapH = Math.min(h, w / 2);
  const mapW = mapH * 2;
  return { mapW, mapH, offsetX: (w - mapW) / 2, offsetY: (h - mapH) / 2 };
}

export const equirectangular: Projection = {
  id: 'equirectangular',
  screenToLonLat(px, py, w, h) {
    const { mapW, mapH, offsetX, offsetY } = equirectRect(w, h);
    const x = px - offsetX, y = py - offsetY;
    if (x < 0 || x >= mapW || y < 0 || y >= mapH) return undefined;
    return { lon: (x / mapW) * 360 - 180, lat: 90 - (y / mapH) * 180 };
  },
  lonLatToScreen(p, w, h) {
    const { mapW, mapH, offsetX, offsetY } = equirectRect(w, h);
    return { x: offsetX + ((p.lon + 180) / 360) * mapW, y: offsetY + ((90 - p.lat) / 180) * mapH };
  },
};

const GLOBE_MARGIN = 0.92;

/** Radius (px) of the globe disc inscribed in a w x h canvas -- exported so
 *  drag-to-rotate (main.ts) can convert a pixel delta to a rotation without
 *  duplicating this margin constant. */
export function orthographicRadius(w: number, h: number): number {
  return (Math.min(w, h) / 2) * GLOBE_MARGIN;
}

function orthoGeometry(w: number, h: number) {
  return { radius: orthographicRadius(w, h), cx: w / 2, cy: h / 2 };
}

/** Standard spherical orthographic projection (Snyder 1987, "Map
 *  Projections: A Working Manual", ch. 20) -- the same projection D3-geo's
 *  geoOrthographic implements. `view.lon0/lat0` is the sub-point currently
 *  centered in view (the near pole of the visible hemisphere). */
export const orthographic: Projection = {
  id: 'orthographic',
  screenToLonLat(px, py, w, h, view) {
    const { radius, cx, cy } = orthoGeometry(w, h);
    const dx = px - cx;
    const dy = -(py - cy); // screen y grows downward; geographic north is +y
    const rho = Math.sqrt(dx * dx + dy * dy);
    if (rho > radius) return undefined;

    const lat0r = view.lat0 * DEG2RAD, lon0r = view.lon0 * DEG2RAD;
    if (rho < 1e-9) return { lon: view.lon0, lat: view.lat0 };

    const c = Math.asin(rho / radius);
    const sinC = Math.sin(c), cosC = Math.cos(c);
    const latR = Math.asin(cosC * Math.sin(lat0r) + (dy * sinC * Math.cos(lat0r)) / rho);
    const lonR = lon0r + Math.atan2(dx * sinC, rho * cosC * Math.cos(lat0r) - dy * sinC * Math.sin(lat0r));
    return { lon: wrapLon(lonR * RAD2DEG), lat: latR * RAD2DEG };
  },
  lonLatToScreen(p, w, h, view) {
    const { radius, cx, cy } = orthoGeometry(w, h);
    const lat0r = view.lat0 * DEG2RAD, lon0r = view.lon0 * DEG2RAD;
    const latR = p.lat * DEG2RAD, lonR = p.lon * DEG2RAD;
    const cosC = Math.sin(lat0r) * Math.sin(latR) + Math.cos(lat0r) * Math.cos(latR) * Math.cos(lonR - lon0r);
    if (cosC < 0) return undefined; // far hemisphere
    const x = radius * Math.cos(latR) * Math.sin(lonR - lon0r);
    const y = radius * (Math.cos(lat0r) * Math.sin(latR) - Math.sin(lat0r) * Math.cos(latR) * Math.cos(lonR - lon0r));
    return { x: cx + x, y: cy - y };
  },
};

export const PROJECTIONS: Record<Projection['id'], Projection> = {
  equirectangular,
  orthographic,
};
