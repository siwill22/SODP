# Visualize the full probability distribution, not just the argmax label

Pointed out directly: the classifier has been probabilistic since
ADR-0010, but `buildLithologyLog()` discarded the distribution immediately
after computing it (`argmaxLithologyClass(probs)` and nothing else kept),
so the viewer only ever showed a single winning label per step. Real
seafloor lithology at most points is a mixture, not a pure end-member — a
show-me figure earlier this session (`2026-09-09-otemp-example-cores/
make_figures.py`) already demonstrated the value of plotting this
(a near-flat 5-8% siliceous-ooze band was the actual evidence for that
session's regression finding, invisible from the label alone) but it
never made it into the live app.

## Decision

1. `LithologyLogStep` (`src/syntheticCore.ts`) gains `probsPublished`,
   `probsCo2Linked`, `probsPrimary` (same Published-then-CO2-Linked tiering
   `classPrimary` already uses) — the actual `LithologyProbabilities`
   objects, not discarded.
2. `drawCoreChart()` (`src/main.ts`) is now two stacked panels sharing one
   age axis: the existing depth/CCD/class-dot chart on top, and a new
   stacked-area chart of `probsPrimary` below it (clay/carbonate-ooze/
   siliceous-ooze, linearly interpolated between real frame steps, same as
   every other series in this chart).

## Consequences

- No new data fetch, no new classification work — this exposes
  computation the classifier was already doing per step.
- The down-core table still shows only the argmax label (`classPrimary`)
  per row; the stacked panel is where the "subordinate components" live.
  Not merged into one visualization — different questions (what's the
  single best label vs. how confident/mixed is it).
- Verified against the real production code before shipping (not just
  typechecked): `probsPrimary` sums to 1 at every step
  (`show-me/2026-09-09-simplified-classifier-map/verify_probs.mjs`), and a
  real query point shows genuinely mixed values (e.g. 60%/37%/3%
  clay/carbonate/siliceous at one step) — not degenerate 0/1 outputs
  dressed up as a distribution.
