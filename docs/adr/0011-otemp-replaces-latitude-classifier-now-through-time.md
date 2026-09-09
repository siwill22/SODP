# The probabilistic classifier uses real OTEMP (not |latitude|), and now runs through time in Phase 2 too

ADR-0010 added a probabilistic classifier to fix the present-day map, using
`[ovelCmS, oceanDepthKm - ccdKm, |latitude|]`. It deliberately stayed
present-day-only: `|latitude|` is a proxy for SST control on calcification,
and a point's *absolute present-day* latitude is not the climate belt it
sat in through geological time -- hothouse periods (no polar ice, a much
flatter equator-to-pole gradient) could make that proxy actively wrong for
older, warmer worlds. Phase 2 kept calling the deterministic
`classifyLithology()` for that reason, flagged as a deliberate gap, not an
oversight.

## The fix was already sitting in the same dataset

BRIDGE-Valdes (Valdes et al. 2021), the source of OVEL, also has **OTEMP**
(ocean temperature, °C) -- same 109 frames, same grid, same layerIndex
convention (0 = shallowest, ~5 m depth). This is the actual physical
mechanism this project's own domain framing already names (calcifying
plankton are temperature-limited, diatoms are not), not a stand-in for it,
and it is available at every frame Phase 2 already visits for OVEL.

Checked directly against the real 8,445-point dataset before committing to
it: OTEMP beats `|latitude|` at present day, with no coverage cost (same
points have valid OVEL and valid OTEMP -- the fields come from the same
model run):

| features (ovel + margin +) | 5-fold CV accuracy |
|---|---:|
| \|latitude\| (ADR-0010) | 66.2% |
| **OTEMP** | **67.9%** |
| both | 67.8% (no gain -- corr(\|lat\|, OTEMP) = -0.93, same signal) |

## Decision

1. **`classifyLithologyProbabilistic()`'s third feature is `otempC`**, not
   `|latDeg|`. Refit on the same 8,445 real points
   (`fit_probabilistic_classifier.py`, updated), coefficients updated in
   `src/lithology.ts`. `ProbabilisticLithologyInputs.latDeg` is replaced by
   `otempC`.
2. **Phase 2 now uses this classifier too**, since the objection that
   blocked it in ADR-0010 (no time-aware version of the predictor) no
   longer applies: `syntheticCore.ts::buildLithologyLog()` takes a new
   `otempSeries` parameter alongside `ovelSeries`, fetched the same way
   (`fetchClimateSeriesForCore()` -- renamed from `fetchOvelSeriesForCore()`
   since it's generic over which BRIDGE-Valdes variable it fetches, and is
   now called twice per click). Each step is classified using **that
   step's own real paleo-OTEMP**, at that step's real paleoposition -- not
   present-day OTEMP or latitude reused across time.
3. `src/main.ts`'s click handler fetches OVEL and OTEMP concurrently
   (`Promise.all`), both already bounded by Basement Age via the same
   mechanism that fixed the earlier flat-latency problem.
4. `classifyLithology()` (ADR-0007) is kept, unused by either map now, for
   any future caller that wants a zero-external-data-dependency rule.

## Consequences

- **Both maps now share one classifier and one calibration dataset.**
  Previously the present-day map and Phase 2 could in principle diverge in
  behavior (different rules); now a future recalibration updates both at
  once, for better or worse -- a bug in the fit affects both maps, not one.
- **Still a present-day-fit model, applied at other times on the strength
  of OTEMP being a real simulated quantity at those times, not (yet) a
  fit that itself uses cross-time data.** The relationship between OTEMP
  and carbonate-vs-siliceous partitioning is calibrated once, at present
  day, and assumed to hold at other OTEMP values regardless of when they
  occur. This is a real, still-standing assumption -- weaker than reusing
  latitude across time (OTEMP is the mechanism, not a proxy that changes
  meaning with climate state), but not eliminated. No paleo lithology
  ground truth exists to check this against.
- **Click latency**: doubles the number of live variable fetches per click
  (OVEL and OTEMP, both bounded by Basement Age, fetched concurrently).
  Not yet re-measured after this change -- see the validation pass this
  ADR ships with.
- **The Antarctic Basement Age no-data ring (point 1, deferred since
  ADR-0010) is unaffected and still deferred.**

## Known limitation, investigated and accepted: warm/equatorial siliceous-ooze (~0% recall)

Found via an eye-check of a real example core (`show-me/2026-09-09-otemp-example-cores/`),
not the aggregate validation number, which hid it: real siliceous-ooze
splits into two physically distinct regimes in the training data --
cold/high-latitude (Southern Ocean opal belt, n=949, OTEMP<=15C, this
classifier gets **68.7%** of these right) and warm/equatorial
(upwelling-driven, n=271, OTEMP>15C, **0.0%** right -- it always predicts
clay or carbonate-ooze instead). Cold points outnumber warm ones 3.5:1, so
the single linear OTEMP coefficient learned "siliceous = cold" and lost
the warm regime entirely. This erases a real, textbook example this
project's own earlier validation pass specifically celebrated: the
equatorial-upwelling-to-oligotrophic-gyre story at (-150, 15).

Investigated properly before deciding to accept it, not abandoned at the
first negative result:

1. **An OVELxOTEMP interaction term** (`show-me/2026-09-09-otemp-example-cores/try_ovel_otemp_interaction.py`)
   -- does not help at all (still exactly 0.0%). Root cause dug out: in
   warm water, real carbonate-ooze outnumbers real siliceous-ooze 12:1,
   *and* OVEL's own distribution is statistically indistinguishable
   between the two classes there (median -0.000022 vs -0.000028 cm/s) --
   a missing-variable problem, not a functional-form problem.
2. **Diesing (2020)'s independent published map** (`show-me/2026-09-09-diesing-validation/`)
   -- corroborates the real equatorial radiolarian-ooze belt from the
   paper's own text and a richer covariate set (productivity, silicate),
   but a check of Diesing's own training shapefile found his ~106
   equatorial radiolarian training points are the *same* points already in
   this project's dataset -- not independent ground truth, so this doesn't
   supply a fix, only corroborates that OVEL/OTEMP/margin are the wrong
   inputs for this split.
3. **OSAL (real salinity, already available for free from the same
   BRIDGE-Valdes dataset)** (`show-me/2026-09-09-present-day-validation/fit_with_osal.py`,
   `fit_balanced_with_osal.py`) -- real, statistically significant signal
   (warm siliceous-ooze median 33.6 PSU vs warm carbonate-ooze 34.8 PSU,
   p=1.2e-39), but weak in effect size: isolated to the warm-only binary
   problem it lifts recall 0%->15%; folded into the full 3-class fit
   (even with class-weighting, including regime-conditional weighting
   that specifically targets the warm/cold imbalance within the
   siliceous-ooze class) it stays at 0.0%, at a real cost to overall
   accuracy and cold-regime recall.
4. **Real, independently-measured surface silicate** (World Ocean Atlas
   2023, not a model proxy -- `show-me/2026-09-09-woa-silicate-check/`) --
   confirms the causal mechanism directionally (silicate is higher where
   siliceous-ooze occurs, dramatically so in cold water: 16.45 vs 4.33
   umol/kg), but is a *weaker* single-variable separator than OSAL in the
   specific warm-water split that needs fixing (AUC 0.61 vs OSAL's 0.74),
   and does not move the full-model recall off 0.0% either.

**Decision: accept this as a known, documented limitation rather than
continue searching for a fix.** The real causal variable (measured
silicate, not a proxy for it) was tested directly and still doesn't
separate the classes well enough at this point/grid resolution -- so
further BRIDGE-Valdes proxy search (wind stress, water-age tracer, etc.)
is very unlikely to succeed where the real chemistry itself did not.
Affects ~1.9% of all real validation points (271 of 14,400). The
classifier remains a real net improvement in aggregate (46.8% deployed
end-to-end accuracy vs 29.6% for the original deterministic rule) with
this one characterised, accepted blind spot: **warm/equatorial
upwelling-driven siliceous-ooze is systematically misclassified as
carbonate-ooze or clay, at every age, including in Phase 2 synthetic
cores that pass through this regime.**
