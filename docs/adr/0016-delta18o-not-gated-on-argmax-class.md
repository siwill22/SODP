# δ18O is no longer gated on the argmax Lithology Class

ADR-0014 gated `delta18O` on `classPrimary === 'carbonate-ooze'` -- a hard
label check. Asked directly, after ADR-0015 exposed the full probability
distribution: given we now have `probsPrimary['carbonate-ooze']` as a
continuous value, should δ18O be available anywhere that's nonzero, not
just where it's the argmax?

## The real answer, and the catch

Real cores support this: foraminifera/coccolith δ18O is routinely measured
from minor/accessory calcite in clay-dominated intervals, not only where
carbonate visually dominates -- mixed carbonate-bearing clay is common,
not an edge case.

But `probsPrimary['carbonate-ooze']` is NOT a measured volumetric
composition -- it's the classifier's confidence about a single dominant
label, fit on point data where every real training point carried exactly
one label, never a mixture. The two concepts often correlate but are not
proven equivalent here, and a hard `>0%` threshold would be close to
meaningless anyway: softmax output is essentially never exactly zero, so
"nonzero" is not a real gate, just unearned precision dressed up as one.

One more fact that resolves the design cleanly: `delta18OFromTemperature()`
only ever consumes OTEMP -- the carbonate probability plays no role in the
computed value, only in whether it means anything.

## Decision

`delta18O` is now computed whenever OTEMP itself is valid, full stop --
not gated on `classPrimary` or on any probability threshold. The down-core
table (`src/main.ts`) shows `probsPrimary['carbonate-ooze']` as its own
column (`P(carb)`) alongside δ18O, so the value and its plausibility are
both visible, judged together rather than the classifier silently deciding
on the caller's behalf.

## Consequences

- δ18O is now visible continuously across a Synthetic Core's whole
  history, not just at argmax-carbonate-ooze steps -- verified against
  real output (`show-me/2026-09-09-simplified-classifier-map/
  verify_delta18o.mjs`): P(carb) decays smoothly (75%->61%->51%->45%->37%
  ->32%) exactly where a step transitions out of the carbonate-ooze
  argmax label, rather than the value disappearing abruptly.
- Any future caller wanting the old conservative behavior can reconstruct
  it trivially (`delta18O` where `classPrimary === 'carbonate-ooze'`) --
  nothing is lost, this only adds visibility.
- The same open question ADR-0011/ADR-0015 already carry stands here too:
  whether this classifier's probabilities are quantitatively trustworthy
  as anything beyond classification confidence is unverified. This ADR
  doesn't resolve that; it just stops hiding a real number behind an
  unearned hard cutoff built on the same unresolved assumption.
