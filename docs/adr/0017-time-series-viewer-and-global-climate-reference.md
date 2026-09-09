# The down-core table is gone -- everything is a time-series panel, plus a real global climate reference

Two things asked directly after using the viewer:

1. The down-core table isn't useful -- everything should be a time series
   plot (multiple panels is fine).
2. Add a "global" reference time series usable as a comparison (or noted
   as a driver) -- e.g. global sea-surface temperature, bottom water
   temperature.

## Decision: four stacked panels, one shared age axis, no table

`src/main.ts`'s single `drawCoreChart()` is now four functions sharing a
common `drawAxisFrame()` helper, each its own `<canvas>`, stacked in the
side panel:

1. **Depth vs age** (unchanged logic) -- GDH1 curve, both CCD curves,
   class-colored dots, divergence rings.
2. **Lithology Class probability** (ADR-0015) -- the stacked-area chart,
   unchanged.
3. **delta18O vs age** (ADR-0014/0016) -- NEW as a chart (was a table
   column): a line through every step with a valid OTEMP, marker
   size/opacity encoding `probsPrimary['carbonate-ooze']` so the value and
   its plausibility are both visible in one panel, replacing the table's
   two separate columns.
4. **Ocean temperature: this point vs a real global reference** -- NEW,
   both the panel and the underlying data.

`drawAxisFrame()` takes an `invert` flag: the depth panel keeps its
original convention (deeper = further down the canvas, matching a real
down-core log); every other panel inverts so the larger value reads at the
top, the normal convention for a time series.

## The global reference curve is real BRIDGE-Valdes output, precomputed once

Global-mean OTEMP at two depth levels -- layerIndex 0 (~5m, a sea-surface
temperature proxy) and layerIndex 19 (~5.19km, the DEEPEST level
BRIDGE-Valdes simulates, used as a "bottom water" proxy -- not true
seafloor depth everywhere, but the deepest this model offers) -- across
all 109 real BRIDGE-Valdes frames (0-541 Ma), spatial mean over every
valid ocean cell per frame.

**Precomputed, not fetched live** -- `prep/prep_global_climate_curve.mjs`,
run once, writes `archive/climate/bridge_valdes_global_mean_otemp.json`.
Unlike the existing point-query path (one small subarray decoded per
frame), a global mean needs the FULL grid every frame: 109 frames x
~1.3MB/frame (each file holds all 20 depth layers concatenated, so there's
no way to fetch fewer) = ~140MB, the SAME regardless of which point is
queried. That's a real, deliberate architectural difference from
everything else this project fetches live -- matches the existing
CCD-Curve precedent (prep_ccd.py: precompute once into a small static
JSON) rather than repeating a ~140MB fetch on every app load for a curve
that never changes with the query point. `.mjs`, not `.py` like this
folder's other prep scripts, since it needs to reuse SODP's own binary
volume-decode logic (`src/core/volume.ts`) rather than reimplementing the
archive's binary format from scratch in Python.

`main()` fetches this once at startup (`Promise.all` alongside the CCD
curves and static polygons) and holds it in memory; the temperature panel
clips it to `[0, basementAgeMa]` per click -- no new network cost per
query.

## Consequences

- The table's information isn't lost -- delta18O and P(carb) are both
  still visible, now as a single combined chart encoding rather than two
  text columns.
- The temperature panel makes a click legible as "warmer/colder than the
  contemporaneous global mean," a comparison the table never offered at
  all -- this is new information, not a reformatting of old information.
- The global curve is real model output (a spatial average of the same
  OTEMP field the classifier already uses), not an external published
  compilation -- consistent with this point in the project, but it does
  mean it inherits every caveat BRIDGE-Valdes/HadCM3 itself carries (ADR-
  0011's "still a present-day-fit model" discussion doesn't apply here --
  this is unprocessed simulated temperature, not a fitted classifier --
  but it's still one model's output, not an independent observational
  check).
- `prep/prep_global_climate_curve.mjs` takes several minutes to run
  (~140MB, 109 sequential frame fetches) -- a one-time cost paid by
  whoever regenerates the archive, never by an app user.
