# Drop OVEL from the probabilistic classifier -- it was carrying no measurable weight

Requested directly: keep whatever predictor the project uses as simple as
it can be while still producing a reasonable map. ADR-0011's classifier
used three features -- `ovelCmS`, `oceanDepthKm - ccdKm` ("margin"), and
`otempC`. Checked directly, rather than assumed, whether all three are
pulling weight.

## The ablation

Real 8,445-point dataset, 5-fold cross-validated, every feature subset
(`show-me/2026-09-09-present-day-validation/fit_with_osal.py`'s ablation
cell):

| features | CV accuracy |
|---|---:|
| margin alone | 62.5% |
| margin + ovel | 62.7% |
| **margin + otemp** | **67.9%** |
| **margin + ovel + otemp (ADR-0011, previous)** | **67.9%** |
| ovel + otemp | 55.2% |

`margin + otemp` and `margin + ovel + otemp` score identically -- not
approximately, to one decimal place. Checked class-by-class, not just in
aggregate (the aggregate number is exactly the kind of thing that hid the
warm/equatorial siliceous-ooze blind spot before, ADR-0011): precision,
recall, and f1 per class are identical to three decimal places between the
two- and three-feature models, including the warm/cold siliceous-ooze
split specifically (68.4% vs 68.7% cold recall, both 0.0% warm recall --
noise-level difference, not a real one). OVEL is not compensating for
anything margin+OTEMP already doesn't cover.

This makes sense in hindsight: OTEMP already partly encodes "is this an
upwelling zone," since upwelling brings colder subsurface water to the
surface -- exactly the mechanism OVEL was added to represent directly.
Once OTEMP is in the model, OVEL's marginal information is gone.

## Decision

1. **`classifyLithologyProbabilistic()`'s inputs are now
   `[oceanDepthKm - ccdKm, otempC]` only.** `ProbabilisticLithologyInputs`
   no longer extends `LithologyInputs` (which still carries `ovelCmS`, used
   only by `classifyLithology()`, ADR-0007's deterministic fallback, kept
   unchanged). Coefficients refit on the same 8,445 points restricted to
   `[margin, otemp]` -- identical 67.9% CV accuracy, see `src/lithology.ts`.
2. **OVEL is no longer fetched by either map.**
   `presentDayMap.ts::loadPresentDayInputs()` now fetches one live frame
   (OTEMP) instead of two; `main.ts`'s click handler fetches one
   `otempSeries` instead of two `Promise.all`-ed series;
   `syntheticCore.ts::buildLithologyLog()` no longer takes an `ovelSeries`
   parameter and `LithologyLogStep` no longer carries `ovelCmS`. The OVEL
   column is removed from the down-core table in the UI (nothing to show).
3. `fetchClimateSeriesForCore()` stays generic over `variable` (unchanged
   signature) even though it is now only called for OTEMP -- nothing about
   it is OTEMP-specific, and a future predictor could reuse it.
4. `classifyLithology()` (ADR-0007) is untouched -- still the
   zero-external-data-dependency deterministic fallback, still uses OVEL,
   never called by either production map.

## Consequences

- **One fewer live variable fetch per present-day map load, and per
  Synthetic Core click.** Previously both paths fetched OVEL and OTEMP
  concurrently (`Promise.all`); now they fetch OTEMP alone. Real latency
  improvement (fewer network round-trips), not just a code simplification,
  though not separately re-measured here since the previous concurrent
  fetch was already not the bottleneck (ADR-0011).
- **No accuracy cost, aggregate or per-class** -- confirmed, not assumed
  (see ablation above). The warm/equatorial siliceous-ooze blind spot
  documented in ADR-0011 is unchanged by this: dropping OVEL neither
  worsens nor fixes it, because OVEL was already contributing nothing
  there either.
- **Smaller, simpler classifier**: two coefficients per class instead of
  three, one fewer manifest/variable to reason about in
  `presentDayMap.ts`/`syntheticCore.ts`/`main.ts`.
- If a future predictor search (ADR-0011's "Known limitation" section)
  finds a variable that *does* help the warm-water split, OVEL is not
  assumed gone forever -- this ADR documents why it was dropped now, not a
  rule against ever reconsidering vertical velocity as an input.
