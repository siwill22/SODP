/**
 * Hiatus Risk -- CONTEXT.md, ADR-0019. A per-step preservation-probability
 * annotation on the Synthetic Core, NOT a change to the age-depth model
 * itself: no depth discontinuity, no removed step, no threshold or "major"
 * category anywhere in this file. See ADR-0019 for the full reasoning,
 * including what got explicitly scoped out (erosion/removal, fitting
 * against real hiatus-occurrence data -- no such dataset is sourced here).
 */

/**
 * Which of a manifest's real depth layers (`depth_labels_km`) is nearest a
 * given depth -- used to sample BRIDGE-Valdes bottom-current speed at
 * whichever layer is closest to a Synthetic Core step's own modeled
 * `oceanDepthKm`, rather than a fixed layer (ADR-0019: a fixed deep layer
 * would sample current speed far from where young, shallow crust's
 * sediment actually sits).
 */
export function nearestDepthLayerIndex(depthLabelsKm: number[], depthKm: number): number {
  return depthLayerSearchOrder(depthLabelsKm, depthKm)[0];
}

/**
 * Every real depth layer, ranked by proximity to a given depth -- used by
 * plateFrameAgeSeriesNearestLayer() (core/queryPoint.ts) to fall back to
 * the next-nearest layer when the single nearest one turns out to be
 * masked/no-data at a given real grid column and Frame, instead of just
 * reporting "no data" when real, nearby current data exists (ADR-0019: a
 * Synthetic Core step already knows real seafloor exists there, from
 * Basement Age + GDH1 -- a masked layer reflects BRIDGE-Valdes's own
 * coarser paleobathymetry disagreeing with that fact, not an actual
 * absence of anything to sample).
 */
export function depthLayerSearchOrder(depthLabelsKm: number[], depthKm: number): number[] {
  return depthLabelsKm
    .map((d, i): [number, number] => [i, Math.abs(d - depthKm)])
    .sort((a, b) => a[1] - b[1])
    .map(([i]) => i);
}

/**
 * Current Erosion Risk -- a PERCENTILE RANK of real bottom-current speed
 * (m/s, `sqrt(OCURU^2 + OCURV^2)`) within BRIDGE-Valdes's own real
 * deep-ocean speed distribution, not a threshold or logistic on the
 * absolute value.
 *
 * Third calibration, not the first two. (1) An absolute literature
 * critical-erosion-velocity threshold (McCave 2006, ~10-20 cm/s) was tried
 * first -- checked against a full sweep of every deep cell (layer>=15,
 * >=~2.1 km -- the depth range a Synthetic Core step actually occupies,
 * GDH1's own minimum being 2.6 km) across all 109 real Frames, and found
 * unreachable: this coarse GCM's own speeds top out at 0.14 m/s (99.9th
 * percentile) / 0.26 m/s (global max), an order of magnitude below where
 * real point current-meter measurements put erosion-relevant flow, because
 * a ~2-3.75deg ocean grid cannot resolve the narrow bottom-current features
 * that produce those real speeds. (2) Recentring the same logistic on this
 * model's own 95th percentile (0.07 m/s) instead of the literature value
 * was tried next -- still inert in practice: of the handful of real cells
 * fast enough to move the needle, all but one exceed the real archive's own
 * maximum basement age (338.7 Ma, so no surviving crust could ever reach
 * them), and the one candidate young enough (145 Ma) was checked against
 * every real present-day point with basement age >=145 Ma (1,485
 * candidates) and never comes closer than 22 degrees (~2,400 km) to that
 * cell at that age. Both calibrations depended on the model's ABSOLUTE
 * speed values, which this coarse GCM's resolution makes untrustworthy in
 * the first place.
 *
 * (3) This version instead asks a rank question, not a magnitude question:
 * "is this cell's current fast RELATIVE TO everywhere else BRIDGE-Valdes
 * ever puts a deep current" -- explicitly chosen because the model's
 * absolute speed values may be systematically biased (coarse-grid
 * smoothing), but its RELATIVE structure (which cells are comparatively
 * fast vs slow) is a much weaker claim, and one this project has real
 * erosion physics behind: real bottom-current erosion does concentrate
 * wherever flow is locally fastest, even if this model can't get the
 * absolute speed right. `CURRENT_SPEED_PERCENTILE_TABLE` is real data --
 * percentiles of every deep-cell speed across all 109 real Frames
 * (~7.6M samples,
 * `show-me/2026-09-09-simplified-classifier-map/percentile_table.mjs`) --
 * looked up via piecewise-linear interpolation, so the result IS the
 * fraction of this model's own real deep-ocean speed distribution that
 * this cell's speed exceeds. Still deliberately NOT fit or validated
 * against any real hiatus-occurrence dataset (ADR-0019) -- a
 * physically-justified but unvalidated hypothesis; the "physical
 * justification" here is specifically about relative ranking, not absolute
 * magnitude.
 */
const CURRENT_SPEED_PERCENTILE_TABLE: [percentile: number, speedMs: number][] = [
  [0, 0.00055], [2, 0.00055], [4, 0.00055], [6, 0.00055], [8, 0.00055], [10, 0.00055],
  [15, 0.00055], [20, 0.00055], [25, 0.00077], [30, 0.00078], [35, 0.00106], [40, 0.00106],
  [45, 0.00119], [50, 0.00152], [55, 0.00215], [60, 0.00225], [65, 0.00273], [70, 0.00392],
  [75, 0.00548], [80, 0.00858], [85, 0.01502], [90, 0.0327], [92, 0.04395], [94, 0.05683],
  [96, 0.07018], [98, 0.09108], [99, 0.10876], [99.5, 0.12111], [99.9, 0.13609],
  [99.99, 0.14843], [100, 0.25752],
];

export function currentErosionRiskFromSpeed(speedMs: number): number {
  const table = CURRENT_SPEED_PERCENTILE_TABLE;
  if (speedMs <= table[0][1]) return 0;
  if (speedMs >= table[table.length - 1][1]) return 1;
  for (let i = 1; i < table.length; i++) {
    const [pHi, vHi] = table[i];
    const [pLo, vLo] = table[i - 1];
    if (speedMs <= vHi) {
      const frac = vHi === vLo ? 0 : (speedMs - vLo) / (vHi - vLo);
      return (pLo + frac * (pHi - pLo)) / 100;
    }
  }
  return 1;
}

/**
 * Dissolution Risk -- a smooth logistic in margin (`oceanDepthKm - ccdKm`,
 * km; deeper below the CCD -> higher risk), scale = 0.5 km reflecting the
 * real lysocline-to-CCD transition thickness (the lysocline, where
 * significant carbonate dissolution begins, sits several hundred metres to
 * ~1 km above the CCD itself in the real ocean -- the CCD is where
 * dissolution total, not where it starts). Boosted, not replaced, when
 * `divergent` is true (ADR-0019: the two CCD Curves disagreeing is itself a
 * preservation-risk signal, the same underlying uncertainty the Lithology
 * Class log already surfaces via `divergent`, not a second independent
 * one) -- combined via the same "probability at least one mechanism
 * applies" logic as `combineHiatusRisk()` below, so the result stays
 * bounded in [0, 1] without a separate clamp.
 */
export function dissolutionRiskFromMargin(marginKm: number, divergent: boolean): number {
  const scaleKm = 0.5;
  const base = 1 / (1 + Math.exp(-marginKm / scaleKm));
  if (!divergent) return base;
  const divergentBoost = 0.3;
  return 1 - (1 - base) * (1 - divergentBoost);
}

/**
 * Derived convenience field (ADR-0019) -- probability that AT LEAST ONE of
 * the two independently-sourced mechanisms applies, treating them as
 * independent. The two named risks stay separately available (this
 * project has consistently refused to silently blend distinct diagnostic
 * signals -- ADR-0005, ADR-0015); this exists for a caller/viewer that
 * just wants one number.
 */
export function combineHiatusRisk(currentErosionRisk: number, dissolutionRisk: number): number {
  return 1 - (1 - currentErosionRisk) * (1 - dissolutionRisk);
}
