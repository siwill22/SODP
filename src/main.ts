import { texelIndex, texelToPhysical, fetchVariableBytes, loadManifest } from './core/volume';
import { fetchStaticPolygonData, assignPlate } from './core/staticPolygons';
import { FrameByteCache } from './core/frameByteCache';
import { loadPresentDayInputs, buildPresentDayGrid, NO_DATA, type PresentDayGrid } from './presentDayMap';
import {
  buildAgeDepthModel, buildLithologyLog, createUnboundedPlateFramePoint,
  fetchClimateSeriesForCore, type LithologyLogStep,
} from './syntheticCore';
import type { CcdCurve } from './ccdCurve';
import type { LonLat } from './core/constants';

/** archive/climate/bridge_valdes_global_mean_otemp.json --
 *  prep/prep_global_climate_curve.mjs's output: real global-mean OTEMP at
 *  two depth levels, across all 109 BRIDGE-Valdes frames. */
interface GlobalClimateCurve {
  sst_layer_depth_km: number;
  bottom_layer_depth_km: number;
  curve: { age_ma: number; sst_c: number | null; bottom_water_c: number | null }[];
}

/**
 * SODP v1 UI: a flat 2D present-day map (Phase 1, ADR-0006/0007/0008),
 * click anywhere in the ocean to build that point's through-time Synthetic
 * Core (Phase 2, ADR-0009) live in the browser. No three.js, no framework
 * -- plain canvas, matching this project's minimal-dependency convention.
 */

const LOCAL_BASE = `${import.meta.env.BASE_URL}archive`;
const GEODE_BASE = import.meta.env.VITE_ARCHIVE_BASE;
const SCALE = 3; // canvas pixels per grid cell

const CLASS_COLOR: Record<number, string> = {
  0: '#4477aa', // clay
  1: '#ccbb44', // carbonate-ooze
  2: '#228833', // siliceous-ooze
};
const NO_DATA_COLOR = '#333333';

const statusEl = document.getElementById('status')!;
const mapCanvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const sideContent = document.getElementById('side-content')!;
const beltToggle = document.getElementById('belt-toggle') as HTMLInputElement;

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
  if (grid) drawPresentDayGrid(grid);
  if (lastCore) {
    const log = beltToggle.checked ? lastCore.logBelt : lastCore.logFitted;
    renderSidePanel(lastCore.point, lastCore.basementAgeMa, lastCore.plateId, log, lastCore.formation, globalCurve);
  }
}

function drawPresentDayGrid(grid: PresentDayGrid): void {
  mapCanvas.width = grid.nlon * SCALE;
  mapCanvas.height = grid.nlat * SCALE;
  const ctx = mapCanvas.getContext('2d')!;
  const img = ctx.createImageData(mapCanvas.width, mapCanvas.height);

  for (let jLat = 0; jLat < grid.nlat; jLat++) {
    // Grid row 0 is the SOUTH pole (core/volume.ts's cellCenter convention);
    // canvas row 0 is the TOP of the image, so flip: canvas row r shows
    // grid row (nlat-1-r), putting north at the top like a normal map.
    const canvasRowTop = (grid.nlat - 1 - jLat) * SCALE;
    for (let iLon = 0; iLon < grid.nlon; iLon++) {
      const cls = grid.classes[jLat * grid.nlon + iLon];
      const hex = cls === NO_DATA ? NO_DATA_COLOR : CLASS_COLOR[cls];
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const px = iLon * SCALE + dx;
          const py = canvasRowTop + dy;
          const o = (py * mapCanvas.width + px) * 4;
          img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Canvas click (CSS pixels, possibly scaled by max-width) -> (lon, lat). */
function canvasClickToLonLat(ev: MouseEvent, nlon: number, nlat: number): LonLat {
  const rect = mapCanvas.getBoundingClientRect();
  const px = ((ev.clientX - rect.left) / rect.width) * mapCanvas.width;
  const py = ((ev.clientY - rect.top) / rect.height) * mapCanvas.height;
  const iLon = Math.min(nlon - 1, Math.max(0, Math.floor(px / SCALE)));
  const canvasRow = Math.min(nlat - 1, Math.max(0, Math.floor(py / SCALE)));
  const jLat = nlat - 1 - canvasRow; // undo the flip drawPresentDayGrid() applied
  return { lon: ((iLon + 0.5) / nlon) * 360 - 180, lat: (jLat / (nlat - 1)) * 180 - 90 };
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
 *  class. Panel 2 of 4. */
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
 *  of 5. */
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
 *  4 of 5. */
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
 *  number. Panel 5 of 5. */
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
  `;
  drawDepthPanel(document.getElementById('chart-depth') as HTMLCanvasElement, log, basementAgeMa);
  drawProbPanel(document.getElementById('chart-probs') as HTMLCanvasElement, log, basementAgeMa);
  drawDelta18OPanel(document.getElementById('chart-d18o') as HTMLCanvasElement, log, basementAgeMa);
  drawMgCaPanel(document.getElementById('chart-mgca') as HTMLCanvasElement, log, basementAgeMa);
  drawTemperaturePanel(document.getElementById('chart-temp') as HTMLCanvasElement, log, basementAgeMa, globalCurve);
}

async function main(): Promise<void> {
  setStatus('loading present-day map (real bathymetry + basin CCD, ADR-0008)...');
  const inputs = await loadPresentDayInputs(LOCAL_BASE, GEODE_BASE);
  gridFitted = buildPresentDayGrid(inputs, false);
  gridBelt = buildPresentDayGrid(inputs, true);
  const grid = gridFitted;
  renderActive();
  beltToggle.addEventListener('change', renderActive);
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
  const cache = new FrameByteCache(GEODE_BASE);

  setStatus(`ready -- click anywhere in the ocean (${grid.nlon}x${grid.nlat} present-day map)`);

  mapCanvas.addEventListener('click', async (ev) => {
    const point = canvasClickToLonLat(ev, grid.nlon, grid.nlat);
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
    const otempSeries = await fetchClimateSeriesForCore(
      cache, oceanDepthManifest, otempVar, framePoint, scotesePolyData.table, basementAgeMa, 0,
    );
    // ADR-0013: both options computed from the one fetched series -- classification-only work,
    // cheap, no extra network round-trip -- so the toggle can switch between them instantly.
    const logFitted = buildLithologyLog(
      framePoint, scotesePolyData.table, basementAgeMa, otempSeries, publishedCurve, co2LinkedCurve, false,
    );
    const logBelt = buildLithologyLog(
      framePoint, scotesePolyData.table, basementAgeMa, otempSeries, publishedCurve, co2LinkedCurve, true,
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
