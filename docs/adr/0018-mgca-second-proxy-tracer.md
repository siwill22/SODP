# Second Proxy Tracer: Mg/Ca, the plan doc's other deferred calcite paleothermometer

Plan doc's deferred list named δ18O AND Mg/Ca together ("fall out of
temperature data BRIDGE-Valdes already carries") -- δ18O landed (ADR-0014),
Mg/Ca was deferred at the time specifically because species-specific
calibrations would pick a fictional foraminifer this project has no basis
to assert. Picked up directly.

## Two real decisions, asked directly rather than assumed

1. **Which calibration** -- a multi-species pooled calibration
   (Anand, Elderfield & Wilson 2003, Paleoceanography) over any single
   named species. Confirmed against the real published source before
   hardcoding, not trusted from memory: Mg/Ca (mmol/mol) = 0.38 * exp(0.090
   * T), a 6-year Sargasso Sea sediment-trap calibration pooled across
   multiple planktonic species. Sanity-checked across a realistic range
   (0degC -> 0.38 mmol/mol, 25degC -> 3.6 mmol/mol) against real published
   planktic foram ranges.
2. **No dissolution correction** -- real Mg/Ca is also depressed by
   carbonate dissolution at depth (e.g. Dekens et al. 2002), and this
   project already computes exactly the input (depth-relative-to-CCD
   margin) such a correction would need. Deliberately not added: keeps
   this a companion to δ18O (temperature-only, one equation) rather than a
   bigger, differently-scoped feature: a second literature relationship
   this project would need to source and verify with the same rigor as the
   first, not assumed correct by analogy.

## Decision

1. `src/proxies.ts::mgCaFromTemperature(otempC)` -- unlike
   `delta18OFromTemperature()`, no inversion needed; Anand et al. (2003)'s
   equation is already Mg/Ca(T) directly.
2. `LithologyLogStep.mgCa` -- same treatment ADR-0016 already established
   for δ18O: computed whenever OTEMP is valid, NOT gated on
   `classPrimary === 'carbonate-ooze'`, paired with
   `probsPrimary['carbonate-ooze']` by the caller to judge plausibility.
   No new design question re-litigated here -- the ADR-0016 reasoning
   (real cores yield calcite signal from minor/accessory carbonate; the
   classifier's probability is a confidence, not a measured composition;
   a hard gate would be false precision) applies identically.
3. New chart panel (`drawMgCaPanel()`, `src/main.ts`) -- same visual
   encoding as the δ18O panel (marker radius/opacity = P(carbonate-ooze)),
   its own y-axis (mmol/mol, a different scale from δ18O's permil), placed
   directly after it. Five stacked panels total now, not four.

## Consequences

- **Two independently-sourced calcite paleothermometers now exist,
  computed from the same OTEMP but via different real equations** (a
  quadratic-inverted Shackleton 1974 relation vs. a direct Anand 2003
  exponential). They will never disagree about the underlying temperature
  (both are deterministic functions of the same OTEMP), but they're on
  different scales and calibrated against different real-world data --
  useful as an implicit cross-check of "does this look like a real proxy
  value" via two independent literature anchors, not just one.
- Same standing caveats as δ18O (ADR-0014): a fixed multi-species
  assumption stands in for a real, more variable biology; no dissolution
  correction means Mg/Ca will read warmer than a real deeply-buried sample
  might, especially near/below the CCD where dissolution is real and
  currently unmodeled.
- No new data fetch -- OTEMP was already being fetched for δ18O and the
  classifier; this is pure downstream computation.
