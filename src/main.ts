import { texelIndex, texelToPhysical, fetchVariableBytes, loadManifest } from './core/volume';
import { fetchStaticPolygonData, assignPlate } from './core/staticPolygons';
import { FrameByteCache } from './core/frameByteCache';
import {
  loadPresentDayInputs, buildPresentDayGrid, presentDayCellInputs, NO_DATA, type PresentDayGrid,
} from './presentDayMap';
import {
  buildAgeDepthModel, buildLithologyLog, createUnboundedPlateFramePoint,
  fetchClimateSeriesForCore, fetchCurrentSpeedSeriesForCore, type LithologyLogStep,
} from './syntheticCore';
import type { CcdCurve } from './ccdCurve';
import type { LonLat } from './core/constants';
import type { VariableInfo } from './core/types';
import { PROJECTIONS, orthographicRadius, type Projection, type GlobeView } from './projection';

/** archive/climate/bridge_valdes_global_mean_otemp.json --
 *  prep/prep_global_climate_curve.mjs's output: real global-mean OTEMP at
 *  two depth levels, across all 109 BRIDGE-Valdes frames. */
interface GlobalClimateCurve {
  sst_layer_depth_km: number;
  bottom_layer_depth_km: number;
  curve: { age_ma: number; sst_c: number | null; bottom_water_c: number | null }[];
}

/**
 * SODP viewer UI: a present-day map (Phase 1, ADR-0006/0007/0008), flat
 * (Equirectangular) or an interactive globe (Orthographic, ADR-0023), click
 * anywhere in the ocean to build that point's through-time Synthetic Core
 * (Phase 2, ADR-0009) live in the browser. No three.js, no framework --
 * plain canvas, matching this project's minimal-dependency convention; the
 * globe is a math-only inverse projection (src/projection.ts) over the same
 * canvas/ImageData machinery, not a WebGL scene.
 */

const LOCAL_BASE = `${import.meta.env.BASE_URL}archive`;
const GEODE_BASE = import.meta.env.VITE_ARCHIVE_BASE;

// Fixed logical canvas resolution (ADR-0023): independent of the grid's own
// 360x181 resolution, since the orthographic globe has no natural tie to
// grid dimensions the way the old cell-block equirectangular render did.
const CANVAS_W = 1080;
const CANVAS_H = 720;
const DRAG_THRESHOLD_PX = 4; // below this, a pointerdown/up pair is a click, not a drag
const ROTATE_DEG_PER_PX = 90 / orthographicRadius(CANVAS_W, CANVAS_H); // half the globe's radius drags ~45 deg
const SHADE_ALPHA = 0.35; // hillshade overlay opacity (ADR-0023: "semi-transparent")
const SHADE_STRENGTH = 90; // grey excursion from mid-grey (128) at the clip extremes

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

const CLASS_COLOR: Record<number, string> = {
  0: '#4477aa', // clay
  1: '#ccbb44', // carbonate-ooze
  2: '#228833', // siliceous-ooze
};
const NO_DATA_COLOR = '#333333';
const BACKGROUND_COLOR = '#0a0a12'; // space/letterbox margin

const CLASS_RGB: Record<number, [number, number, number]> = Object.fromEntries(
  Object.entries(CLASS_COLOR).map(([k, hex]) => [Number(k), hexToRgb(hex)]),
);
const NO_DATA_RGB = hexToRgb(NO_DATA_COLOR);
const BACKGROUND_RGB = hexToRgb(BACKGROUND_COLOR);

const statusEl = document.getElementById('status')!;
const mapCanvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const sideContent = document.getElementById('side-content')!;
const beltToggle = document.getElementById('belt-toggle') as HTMLInputElement;
const projectionSelect = document.getElementById('projection-select') as HTMLSelectElement;

let currentProjection: Projection = PROJECTIONS.equirectangular;
const globeView: GlobeView = { lon0: 0, lat0: 0 };
let shadeBytes: Uint8Array | undefined;
let shadeVarInfo: VariableInfo | undefined;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

/**
 * ADR-0013: Option A (equatorial Radiolarian belt, Diesing-informed) and
 * Option B (the fitted classifier as-is) are kept as two EQUAL, always-
 * both-computed alternatives -- neither is a fallback for the other. Both
 * the present-day grid and the last-built Synthetic Core log are held for
 * both options at once so the toggle is instant (no refetch/recompute of
 * anything network-bound), and just switches which precomputed result is
 * drawn.
 */
let gridFitted: PresentDayGrid | undefined;
let gridBelt: PresentDayGrid | undefined;
let lastCore: {
  point: LonLat; basementAgeMa: number; plateId: number; formation: LonLat;
  logFitted: LithologyLogStep[]; logBelt: LithologyLogStep[];
} | undefined;

function activeGrid(): PresentDayGrid | undefined {
  return beltToggle.checked ? gridBelt : gridFitted;
}

let globalCurve: GlobalClimateCurve | undefined;

function renderActive(): void {
  const grid = activeGrid();
  if (grid && shadeBytes && shadeVarInfo) {
    renderProjectedGrid(mapCanvas, grid, shadeBytes, shadeVarInfo, currentProjection, globeView);
  }
  if (lastCore) {
    const log = beltToggle.checked ? lastCore.logBelt : lastCore.logFitted;
    renderSidePanel(lastCore.point, lastCore.basementAgeMa, lastCore.plateId, log, lastCore.formation, globalCurve);
  }
}

/** Hillshade byte (ADR-0023) -> a 0..255 grey value, symmetric around
 *  mid-grey. shadeVar.encode_min/max is the symmetric raw-gradient clip
 *  range prep/prep_hillshade.py fit (±p99.5(|gradient|)), so normalizing by
 *  encode_max alone is valid -- encode_min is just its negation. */
function shadeToGrey(byte: number, shadeVar: VariableInfo): number {
  const value = texelToPhysical(shadeVar, byte);
  const norm = shadeVar.encode_max > 0 ? value / shadeVar.encode_max : 0; // -1..1
  return 128 + norm * SHADE_STRENGTH;
}

let canvasSized = false;

/** Destination-pixel render loop (ADR-0023): walks every canvas pixel,
 *  asks the active projection what geographic point it shows, and paints
 *  that cell's Lithology Class color with the real hillshade blended over
 *  it as a semi-transparent grey overlay. Replaces the old source-loop
 *  drawPresentDayGrid(), which only worked because equirectangular's
 *  forward mapping happens to be a clean per-cell block -- orthographic has
 *  no such block structure (many/few/zero screen pixels per grid cell
 *  depending on view), so painting must be destination-driven for both. */
function renderProjectedGrid(
  canvas: HTMLCanvasElement, grid: PresentDayGrid, shadeBytesForGrid: Uint8Array, shadeVar: VariableInfo,
  projection: Projection, view: GlobeView,
): void {
  if (!canvasSized) {
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    canvasSized = true;
  }
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const data = img.data;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const o = (py * W + px) * 4;
      const ll = projection.screenToLonLat(px, py, W, H, view);
      if (!ll) {
        data[o] = BACKGROUND_RGB[0]; data[o + 1] = BACKGROUND_RGB[1]; data[o + 2] = BACKGROUND_RGB[2]; data[o + 3] = 255;
        continue;
      }
      const idx = texelIndex(grid.nlon, grid.nlat, ll.lon, ll.lat);
      const rgb = grid.classes[idx] === NO_DATA ? NO_DATA_RGB : CLASS_RGB[grid.classes[idx]];
      const grey = shadeToGrey(shadeBytesForGrid[idx], shadeVar);
      data[o] = rgb[0] * (1 - SHADE_ALPHA) + grey * SHADE_ALPHA;
      data[o + 1] = rgb[1] * (1 - SHADE_ALPHA) + grey * SHADE_ALPHA;
      data[o + 2] = rgb[2] * (1 - SHADE_ALPHA) + grey * SHADE_ALPHA;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Pointer position (CSS pixels, possibly scaled by max-width) -> canvas
 *  pixel coordinates. */
function pointerToCanvasPx(ev: PointerEvent): { px: number; py: number } {
  const rect = mapCanvas.getBoundingClientRect();
  return {
    px: ((ev.clientX - rect.left) / rect.width) * mapCanvas.width,
    py: ((ev.clientY - rect.top) / rect.height) * mapCanvas.height,
  };
}

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

const CLASS_INDEX = { clay: 0, 'carbonate-ooze': 1, 'siliceous-ooze': 2 } as const;
const PAD = { l: 40, r: 10, t: 10, b: 24 };

/** Shared axis frame for every time-series panel: age on x (0 at left),
 *  a value range on y. `invert=false` (the depth panel's convention: deeper
 *  = further down the canvas, matching a real down-core log) leaves y
 *  increasing with value; `invert=true` (everything else: temperature,
 *  delta18O, probability) puts the larger value at the TOP, the normal
 *  reading direction for a time series. */
function drawAxisFrame(
  ctx: CanvasRenderingContext2D, W: number, H: number, ageMax: number,
  yMin: number, yMax: number, yFmt: (v: number) => string, invert: boolean,
): { xFor: (age: number) => number; yFor: (v: number) => number } {
  const xFor = (age: number) => PAD.l + (age / ageMax) * (W - PAD.l - PAD.r);
  const frac = (v: number) => (v - yMin) / (yMax - yMin || 1);
  const yFor = (v: number) => PAD.t + (invert ? 1 - frac(v) : frac(v)) * (H - PAD.t - PAD.b);

  ctx.strokeStyle = '#444';
  ctx.fillStyle = '#999';
  ctx.font = '10px system-ui';
  ctx.beginPath();
  ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, H - PAD.b); ctx.lineTo(W - PAD.r, H - PAD.b);
  ctx.stroke();
  ctx.fillText(yFmt(yMax), 2, yFor(yMax) + 3);
  ctx.fillText(yFmt(yMin), 2, yFor(yMin) + 3);
  ctx.fillText('0 Ma', PAD.l - 8, H - PAD.b + 12);
  ctx.fillText(`${ageMax.toFixed(0)} Ma`, W - PAD.r - 24, H - PAD.b + 12);
  return { xFor, yFor };
}

/** Depth-vs-age with both CCD curves and class-colored dots (unchanged
 *  logic, ADR-0009/0011) -- panel 1 of 4, all sharing the same age axis. */
function drawDepthPanel(canvas: HTMLCanvasElement, log: LithologyLogStep[], basementAgeMa: number): void {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  if (log.length === 0) return;
  const ageMax = basementAgeMa || 1;

  const depths = log.map((s) => s.oceanDepthKm);
  const { xFor, yFor } = drawAxisFrame(
    ctx, W, H, ageMax, Math.min(...depths) - 0.2, Math.max(...depths) + 0.2, (v) => `${v.toFixed(1)} km`, false,
  );

  // GDH1 depth curve, finer resolution -- pure geometry, no climate dependency.
  ctx.strokeStyle = '#ccc';
  ctx.beginPath();
  for (let ageMa = 0; ageMa <= basementAgeMa; ageMa += Math.max(1, basementAgeMa / 200)) {
    const crustalAge = basementAgeMa - ageMa;
    const depthM = crustalAge <= 20 ? 2600 + 365 * Math.sqrt(crustalAge) : 5651 - 2473 * Math.exp(-0.0278 * crustalAge);
    const x = xFor(ageMa), y = yFor(depthM / 1000);
    if (ageMa === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const drawCcd = (key: 'ccdPublishedKm' | 'ccdCo2LinkedKm', dash: number[]) => {
    ctx.strokeStyle = '#cc6699';
    ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    for (const s of log) {
      const v = s[key];
      if (v === undefined) { started = false; continue; }
      const x = xFor(s.ageMa), y = yFor(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  drawCcd('ccdPublishedKm', [5, 3]);
  drawCcd('ccdCo2LinkedKm', [1, 3]);

  for (const s of log) {
    const x = xFor(s.ageMa), y = yFor(s.oceanDepthKm);
    const color = s.classPrimary ? CLASS_COLOR[CLASS_INDEX[s.classPrimary]] : '#666';
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fill();
    if (s.divergent) {
      ctx.strokeStyle = '#cc4444'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
}

/** ADR-0015: stacked-area chart of `probsPrimary` -- the full probability
 *  distribution behind each step's argmax label, not just the winning
 *  class. Panel 2 of 6. */
function drawProbPanel(canvas: HTMLCanvasElement, log: LithologyLogStep[], basementAgeMa: number): void {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  if (log.length === 0) return;
  const ageMax = basementAgeMa || 1;
  const { xFor, yFor } = drawAxisFrame(ctx, W, H, ageMax, 0, 1, (v) => v.toFixed(1), true);

  const CLASS_ORDER: (keyof typeof CLASS_INDEX)[] = ['clay', 'carbonate-ooze', 'siliceous-ooze'];
  const runs: LithologyLogStep[][] = [];
  let current: LithologyLogStep[] = [];
  for (const s of log) {
    if (s.probsPrimary === undefined) { if (current.length) runs.push(current); current = []; continue; }
    current.push(s);
  }
  if (current.length) runs.push(current);

  for (const run of runs) {
    let cumBelow = run.map(() => 0);
    for (const cls of CLASS_ORDER) {
      ctx.fillStyle = CLASS_COLOR[CLASS_INDEX[cls]];
      ctx.beginPath();
      run.forEach((s, i) => {
        const x = xFor(s.ageMa), y = yFor(cumBelow[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      const cumAbove = run.map((s, i) => cumBelow[i] + s.probsPrimary![cls]);
      for (let i = run.length - 1; i >= 0; i--) ctx.lineTo(xFor(run[i].ageMa), yFor(cumAbove[i]));
      ctx.closePath();
      ctx.fill();
      cumBelow = cumAbove;
    }
  }
}

/** ADR-0016: delta18O vs age, at every step with a valid OTEMP (not gated
 *  on the argmax class) -- marker radius encodes `probsPrimary['carbonate-
 *  ooze']`, the confidence a carbonate signal is actually plausible there,
 *  since the table this replaced showed that as its own column. Panel 3
 *  of 6. */
function drawDelta18OPanel(canvas: HTMLCanvasElement, log: LithologyLogStep[], basementAgeMa: number): void {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const withValue = log.filter((s) => s.delta18O !== undefined);
  if (withValue.length === 0) return;
  const ageMax = basementAgeMa || 1;
  const values = withValue.map((s) => s.delta18O!);
  const { xFor, yFor } = drawAxisFrame(
    ctx, W, H, ageMax, Math.min(...values) - 0.3, Math.max(...values) + 0.3, (v) => `${v.toFixed(1)}‰`, true,
  );

  ctx.strokeStyle = '#dd88bb';
  ctx.beginPath();
  withValue.forEach((s, i) => {
    const x = xFor(s.ageMa), y = yFor(s.delta18O!);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  for (const s of withValue) {
    const x = xFor(s.ageMa), y = yFor(s.delta18O!);
    const pCarb = s.probsPrimary?.['carbonate-ooze'] ?? 0;
    ctx.fillStyle = `rgba(221, 136, 187, ${0.25 + 0.75 * pCarb})`;
    ctx.beginPath(); ctx.arc(x, y, 2 + 3 * pCarb, 0, 2 * Math.PI); ctx.fill();
  }
}

/** ADR-0018: Mg/Ca vs age, same treatment as the delta18O panel (not gated
 *  on argmax class, marker radius encodes P(carbonate-ooze)) -- a second,
 *  independently-sourced calcite paleothermometer alongside delta18O, both
 *  derived from the same OTEMP but via different real equations, so a
 *  divergence between the two panels at a given age is a real signal
 *  (analogous to the CCD curves' own Published-vs-CO2-Linked divergence
 *  flag) rather than something this project resolves to one number. Panel
 *  4 of 6. */
function drawMgCaPanel(canvas: HTMLCanvasElement, log: LithologyLogStep[], basementAgeMa: number): void {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const withValue = log.filter((s) => s.mgCa !== undefined);
  if (withValue.length === 0) return;
  const ageMax = basementAgeMa || 1;
  const values = withValue.map((s) => s.mgCa!);
  const { xFor, yFor } = drawAxisFrame(
    ctx, W, H, ageMax, Math.max(0, Math.min(...values) - 0.3), Math.max(...values) + 0.3,
    (v) => `${v.toFixed(1)}`, true,
  );

  ctx.strokeStyle = '#55bb99';
  ctx.beginPath();
  withValue.forEach((s, i) => {
    const x = xFor(s.ageMa), y = yFor(s.mgCa!);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  for (const s of withValue) {
    const x = xFor(s.ageMa), y = yFor(s.mgCa!);
    const pCarb = s.probsPrimary?.['carbonate-ooze'] ?? 0;
    ctx.fillStyle = `rgba(85, 187, 153, ${0.25 + 0.75 * pCarb})`;
    ctx.beginPath(); ctx.arc(x, y, 2 + 3 * pCarb, 0, 2 * Math.PI); ctx.fill();
  }
}

/** Requested directly: this point's own OTEMP against a real GLOBAL
 *  reference -- global-mean sea-surface and "bottom water" temperature,
 *  precomputed across all 109 real BRIDGE-Valdes frames
 *  (prep/prep_global_climate_curve.mjs, archive/climate/
 *  bridge_valdes_global_mean_otemp.json). Lets a click be read as "warmer/
 *  colder than the contemporaneous global mean," not just an absolute
 *  number. Panel 5 of 6. */
function drawTemperaturePanel(
  canvas: HTMLCanvasElement, log: LithologyLogStep[], basementAgeMa: number, globalCurve: GlobalClimateCurve | undefined,
): void {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  if (log.length === 0) return;
  const ageMax = basementAgeMa || 1;
  const globalInRange = (globalCurve?.curve ?? []).filter((p) => p.age_ma <= ageMax);
  const allValues = [
    ...log.map((s) => s.otempC),
    ...globalInRange.map((p) => p.sst_c).filter((v): v is number => v !== null),
    ...globalInRange.map((p) => p.bottom_water_c).filter((v): v is number => v !== null),
  ];
  const { xFor, yFor } = drawAxisFrame(
    ctx, W, H, ageMax, Math.min(...allValues) - 1, Math.max(...allValues) + 1, (v) => `${v.toFixed(0)}°C`, true,
  );

  const drawLine = (points: { age: number; v: number | null }[], color: string, dash: number[]) => {
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    for (const p of points) {
      if (p.v === null) { started = false; continue; }
      const x = xFor(p.age), y = yFor(p.v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  drawLine(globalInRange.map((p) => ({ age: p.age_ma, v: p.sst_c })), '#dd8844', [4, 2]);
  drawLine(globalInRange.map((p) => ({ age: p.age_ma, v: p.bottom_water_c })), '#4488cc', [1, 2]);
  drawLine(log.map((s) => ({ age: s.ageMa, v: s.otempC })), '#eeeeee', []);
}

/** ADR-0019: Hiatus Risk -- currentErosionRisk (solid) and dissolutionRisk
 *  (dashed), 0-1, deliberately kept as two separate lines rather than just
 *  plotting the derived hiatusRisk: seeing which mechanism drives a spike
 *  is the reason the two were kept separate in the first place, not merged
 *  into one blended number. An annotation only -- does not affect any other
 *  panel, curve, or class field. Panel 6 of 6. */
function drawHiatusRiskPanel(canvas: HTMLCanvasElement, log: LithologyLogStep[], basementAgeMa: number): void {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  if (log.length === 0) return;
  const ageMax = basementAgeMa || 1;
  const { xFor, yFor } = drawAxisFrame(ctx, W, H, ageMax, 0, 1, (v) => v.toFixed(1), true);

  const drawLine = (key: 'currentErosionRisk' | 'dissolutionRisk', color: string, dash: number[]) => {
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    for (const s of log) {
      const v = s[key];
      if (v === undefined) { started = false; continue; }
      const x = xFor(s.ageMa), y = yFor(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  drawLine('currentErosionRisk', '#dd6666', []);
  drawLine('dissolutionRisk', '#dd6666', [4, 2]);
}

function angularDistanceDeg(a: LonLat, b: LonLat): number {
  const toXYZ = (p: LonLat): [number, number, number] => {
    const lonR = p.lon * (Math.PI / 180), latR = p.lat * (Math.PI / 180);
    const cl = Math.cos(latR);
    return [cl * Math.cos(lonR), cl * Math.sin(lonR), Math.sin(latR)];
  };
  const [ax, ay, az] = toXYZ(a), [bx, by, bz] = toXYZ(b);
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  return Math.acos(dot) * (180 / Math.PI);
}

function renderSidePanel(
  point: LonLat, basementAgeMa: number, plateId: number, log: LithologyLogStep[], formation: LonLat,
  globalCurve: GlobalClimateCurve | undefined,
): void {
  const driftDeg = angularDistanceDeg(point, formation);
  const divergentCount = log.filter((s) => s.divergent).length;

  sideContent.innerHTML = `
    <h2>(${point.lon.toFixed(2)}, ${point.lat.toFixed(2)})</h2>
    <p>Basement Age: <strong>${basementAgeMa.toFixed(1)} Ma</strong> &nbsp; Plate: <strong>${plateId}</strong></p>
    <p>Formed at (${formation.lon.toFixed(1)}, ${formation.lat.toFixed(1)}) -- drifted
       <strong>${driftDeg.toFixed(1)}&deg;</strong> (~${(driftDeg * 111.2).toFixed(0)} km) since.</p>
    <p>${log.length} log steps (real BRIDGE-Valdes frame ages) -- ${divergentCount} where Published/CO2-Linked
       CCD curves disagree (see ADR-0009).</p>
    <div class="chart-title">Depth vs age -- both CCD curves, class-colored dots (red ring = curves disagree)</div>
    <canvas id="chart-depth" width="380" height="150"></canvas>
    <div class="chart-title">Lithology Class probability (ADR-0015) -- clay / carbonate-ooze / siliceous-ooze</div>
    <canvas id="chart-probs" width="380" height="90"></canvas>
    <div class="chart-title">d18O, permil VPDB (ADR-0014/0016) -- marker size/opacity = P(carbonate-ooze)</div>
    <canvas id="chart-d18o" width="380" height="90"></canvas>
    <div class="chart-title">Mg/Ca, mmol/mol (ADR-0018) -- marker size/opacity = P(carbonate-ooze)</div>
    <canvas id="chart-mgca" width="380" height="90"></canvas>
    <div class="chart-title">Ocean temperature -- this point (white) vs global mean SST (orange dash) / global mean
      bottom water at ${globalCurve?.bottom_layer_depth_km.toFixed(2) ?? '?'} km (blue dot)</div>
    <canvas id="chart-temp" width="380" height="110"></canvas>
    <div class="chart-title">Hiatus Risk (ADR-0019) -- current erosion risk (solid) / dissolution risk (dashed),
      an unvalidated, physically-justified annotation only</div>
    <canvas id="chart-hiatus" width="380" height="90"></canvas>
  `;
  drawDepthPanel(document.getElementById('chart-depth') as HTMLCanvasElement, log, basementAgeMa);
  drawProbPanel(document.getElementById('chart-probs') as HTMLCanvasElement, log, basementAgeMa);
  drawDelta18OPanel(document.getElementById('chart-d18o') as HTMLCanvasElement, log, basementAgeMa);
  drawMgCaPanel(document.getElementById('chart-mgca') as HTMLCanvasElement, log, basementAgeMa);
  drawTemperaturePanel(document.getElementById('chart-temp') as HTMLCanvasElement, log, basementAgeMa, globalCurve);
  drawHiatusRiskPanel(document.getElementById('chart-hiatus') as HTMLCanvasElement, log, basementAgeMa);
}

async function main(): Promise<void> {
  setStatus('loading present-day map (real bathymetry + basin CCD, ADR-0008)...');
  const inputs = await loadPresentDayInputs(LOCAL_BASE, GEODE_BASE);
  shadeBytes = inputs.shadeBytes;
  shadeVarInfo = inputs.shadeVar;
  gridFitted = buildPresentDayGrid(inputs, false);
  gridBelt = buildPresentDayGrid(inputs, true);
  const grid = gridFitted;
  renderActive();
  beltToggle.addEventListener('change', renderActive);
  projectionSelect.addEventListener('change', () => {
    currentProjection = PROJECTIONS[projectionSelect.value as Projection['id']];
    mapCanvas.style.cursor = currentProjection.id === 'orthographic' ? 'grab' : 'crosshair';
    renderActive();
  });
  setStatus('loading plate reconstruction + CCD curves for click handling...');

  const [scotesePolyData, publishedCurve, co2LinkedCurve, fetchedGlobalCurve] = await Promise.all([
    fetchStaticPolygonData(
      `${LOCAL_BASE}/reconstructions/scotese-paleomap`, 'staticpolygons/geometry.bin', 'staticpolygons/rotations.json',
    ),
    fetch(`${LOCAL_BASE}/ccd/published_ccd_curve.json`).then((r) => r.json()) as Promise<CcdCurve>,
    fetch(`${LOCAL_BASE}/ccd/co2_linked_ccd_curve.json`).then((r) => r.json()) as Promise<CcdCurve>,
    fetch(`${LOCAL_BASE}/climate/bridge_valdes_global_mean_otemp.json`).then((r) => r.json()) as Promise<GlobalClimateCurve>,
  ]);
  globalCurve = fetchedGlobalCurve;
  const oceanDepthManifest = await loadManifest(GEODE_BASE, 'models/bridge-valdes2021-ocean-depth/manifest.json');
  const otempVar = oceanDepthManifest.variables.find((v) => v.id === 'OTEMP')!;
  const ocuruVar = oceanDepthManifest.variables.find((v) => v.id === 'OCURU')!;
  const ocurvVar = oceanDepthManifest.variables.find((v) => v.id === 'OCURV')!;
  const cache = new FrameByteCache(GEODE_BASE);

  setStatus(`ready -- click anywhere in the ocean (${grid.nlon}x${grid.nlat} present-day map)`);

  /** Click vs. drag-to-rotate share one pointer stream (ADR-0023): a
   *  pointerdown/up pair under DRAG_THRESHOLD_PX of total movement is a
   *  click (build a Synthetic Core, either projection); past that
   *  threshold it's a drag, which only the orthographic globe responds to
   *  by rotating (flat mode has no rotation state to drag). Pointer
   *  capture keeps move/up events targeting the canvas even if the cursor
   *  leaves it mid-drag. */
  let dragOrigin: { x: number; y: number } | undefined;
  let dragged = false;
  let renderQueued = false;
  const scheduleRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderActive(); });
  };

  mapCanvas.addEventListener('pointerdown', (ev) => {
    mapCanvas.setPointerCapture(ev.pointerId);
    dragOrigin = { x: ev.clientX, y: ev.clientY };
    dragged = false;
  });

  mapCanvas.addEventListener('pointermove', (ev) => {
    if (!dragOrigin) return;
    const dx = ev.clientX - dragOrigin.x, dy = ev.clientY - dragOrigin.y;
    if (!dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) dragged = true;
    if (dragged && currentProjection.id === 'orthographic') {
      globeView.lon0 = wrapLon(globeView.lon0 - dx * ROTATE_DEG_PER_PX);
      globeView.lat0 = Math.max(-90, Math.min(90, globeView.lat0 + dy * ROTATE_DEG_PER_PX));
      dragOrigin = { x: ev.clientX, y: ev.clientY }; // incremental delta each move
      mapCanvas.style.cursor = 'grabbing';
      scheduleRender();
    }
  });

  mapCanvas.addEventListener('pointerup', async (ev) => {
    const wasDrag = dragged;
    dragOrigin = undefined;
    dragged = false;
    if (currentProjection.id === 'orthographic') mapCanvas.style.cursor = 'grab';
    if (wasDrag) return;

    const { px, py } = pointerToCanvasPx(ev);
    const point = currentProjection.screenToLonLat(px, py, mapCanvas.width, mapCanvas.height, globeView);
    if (!point) return; // clicked the letterbox margin / off the visible hemisphere

    const idx = texelIndex(grid.nlon, grid.nlat, point.lon, point.lat);
    const ageByte = inputs.ageBytes[idx];
    if (ageByte === inputs.ageManifest.no_data_sentinel) {
      sideContent.innerHTML = `<p>(${point.lon.toFixed(2)}, ${point.lat.toFixed(2)}) -- no Basement Age here
        (land or non-oceanic crust). Click in the ocean.</p>`;
      return;
    }
    const basementAgeMa = texelToPhysical(inputs.ageManifest.variables[0], ageByte);

    const assignment = assignPlate(scotesePolyData.polygons, scotesePolyData.table, point, 0);
    if (!assignment) {
      sideContent.innerHTML = `<p>(${point.lon.toFixed(2)}, ${point.lat.toFixed(2)}) -- no Scotese polygon
        covers this point at present day.</p>`;
      return;
    }

    sideContent.innerHTML = '<p>building Synthetic Core...</p>';
    const t0 = performance.now();
    const framePoint = createUnboundedPlateFramePoint(assignment, scotesePolyData.table, point, 0);
    const [otempSeries, currentSpeedSeries] = await Promise.all([
      fetchClimateSeriesForCore(
        cache, oceanDepthManifest, otempVar, framePoint, scotesePolyData.table, basementAgeMa, 0,
      ),
      fetchCurrentSpeedSeriesForCore(
        cache, oceanDepthManifest, ocuruVar, ocurvVar, framePoint, scotesePolyData.table, basementAgeMa,
      ),
    ]);
    // Anchor the ageMa=0 step to the same real bathymetry + basin CCD the
    // map itself classified this pixel with, not GDH1 + the global CCD
    // curve -- otherwise the core's own "today" can disagree with the map
    // it was clicked from (see PresentDayAnchor's doc in syntheticCore.ts).
    const anchor = presentDayCellInputs(inputs, idx);

    // ADR-0013: both options computed from the one fetched series -- classification-only work,
    // cheap, no extra network round-trip -- so the toggle can switch between them instantly.
    const logFitted = buildLithologyLog(
      framePoint, scotesePolyData.table, basementAgeMa, otempSeries, publishedCurve, co2LinkedCurve, false,
      currentSpeedSeries, anchor,
    );
    const logBelt = buildLithologyLog(
      framePoint, scotesePolyData.table, basementAgeMa, otempSeries, publishedCurve, co2LinkedCurve, true,
      currentSpeedSeries, anchor,
    );
    const trajectory = buildAgeDepthModel(framePoint, scotesePolyData.table, basementAgeMa, 1);
    const formation = trajectory[trajectory.length - 1]?.position ?? point;
    console.log(`Synthetic Core built in ${(performance.now() - t0).toFixed(0)}ms `
      + `(${otempSeries.length} OTEMP frames fetched)`);

    lastCore = { point, basementAgeMa, plateId: assignment.plateId, formation, logFitted, logBelt };
    renderActive();
  });
}

main().catch((e: Error) => {
  setStatus(`ERROR: ${e.message}`);
  console.error(e);
});
