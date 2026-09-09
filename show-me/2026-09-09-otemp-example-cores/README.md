# Updated example Synthetic Cores after ADR-0011 -- and a real regression found while looking

Requested as a status check after wiring OTEMP into both the present-day
map and Phase 2. Two points reused from the original Phase 2 eye-check
(`show-me/2026-09-09-synthetic-core-skeleton/`) specifically so any
difference is the classifier, not a new point: (-150, 15), the "textbook
story" point (85.33 Ma, equatorial formation drifting into the gyre), and
(-68, 32), old Western Atlantic (137.33 Ma).

## Lead finding: the classifier upgrade breaks the flagship validated example

**The (-150, 15) "textbook story" that ADR-0009/the original skeleton
eye-check specifically celebrated -- siliceous ooze forming at the
equatorial upwelling band, transitioning to clay in the gyre -- is now
gone.** 01-equatorial-pacific-before-after.png: under the OLD deterministic
rule, 3 of the first 3 steps near formation (81/75/69 Ma, strong upwelling,
warm 25-30°C water) were siliceous-ooze. Under the NEW OTEMP classifier,
all three become carbonate-ooze or clay, and the class-probability panel
below shows siliceous-ooze probability never exceeds ~8% anywhere in this
point's entire 85 Myr history -- not a near-miss, a real erasure of the
class.

Traced to a specific, checkable cause, not a mystery: real siliceous-ooze
in the training data splits into two physically distinct regimes --
cold/high-latitude (Southern Ocean opal belt, n=949, OTEMP<=15°C) and
warm/equatorial (upwelling-driven, n=271, OTEMP>15°C, median 27°C, median
|lat| 16° -- the same real Trade-Wind-divergence silica belt this
synthetic point's early history is supposed to represent).
**03-siliceous-warm-vs-cold-accuracy.png**: the OTEMP-fitted classifier
gets the cold regime right 69% of the time, and the warm regime right
**0% of the time** -- it always predicts clay or carbonate-ooze instead.
A single linear OTEMP coefficient can only learn one direction; trained on
a dataset where cold-water siliceous points outnumber warm-water ones
roughly 3.5:1, the fit learned "siliceous = cold" and lost the equatorial
regime entirely. This was not visible in the aggregate present-day
validation numbers reported so far (46.8% overall, 27% for siliceous-ooze
specifically) because those are dominated by the same cold-water majority
-- averaging hid it.

This is a real regression for a specific, real, well-documented pelagic
regime, introduced by the same change that fixed the OVEL<=0/clay gate.
Both are true at once; neither cancels the other out.

## The other example: old Western Atlantic (-68, 32) -- a real, smaller improvement

**02-old-w-atlantic-before-after.png**: 3 of 28 steps near formation (the
shallow ridge-crest steps, 127-137 Ma, above the CCD) flip from Clay to
Carbonate-Ooze. This is the OVEL<=0-gate fix working as intended --
weak/near-zero OVEL at a shallow ridge crest no longer forces Clay
regardless of everything else. No equivalent regression here: this point
never had a real siliceous-ooze regime to lose.

## Figures

1. **01-equatorial-pacific-before-after.png** / **02-old-w-atlantic-before-after.png**
   -- top panel: GDH1 depth trajectory, both CCD curves, OLD classification
   (open circles) vs NEW classification (filled circles) at each real
   OVEL/OTEMP frame age, red arrows marking steps that changed class.
   Bottom panel: the NEW classifier's full probability distribution at
   every step (clay/carbonate-ooze/siliceous-ooze stacked to 1) -- the
   actual "more nuance" a probabilistic classifier adds over an argmax
   label, and the panel that makes the equatorial point's siliceous-ooze
   erasure visible as a near-flat 5-8% band rather than a single wrong
   label.
2. **03-siliceous-warm-vs-cold-accuracy.png** -- the real-data root cause
   of figure 1's regression: model accuracy on real siliceous-ooze points,
   split by OTEMP regime.

## Tried: an OVEL x OTEMP interaction term -- does not fix it

`try_ovel_otemp_interaction.py` tested the natural next hypothesis: maybe
a plain additive OTEMP term can't express "strong upwelling matters
regardless of temperature," and an interaction term would let it. It
doesn't. Warm/equatorial siliceous-ooze accuracy stays at **exactly 0%**
with the interaction term added (cold/high-lat siliceous-ooze ticks up
68.8%->70.1%, overall CV accuracy unchanged at 67.9%).

Checked why, rather than stopping at "didn't work": among warm-water
points (OTEMP>15°C), real carbonate-ooze outnumbers real siliceous-ooze
**12:1** (3,356 vs 271), and restricting to warm points that are also
upwelling (OVEL>0) doesn't change that ratio (1,004 vs 83). Worse than the
imbalance: **OVEL's own distribution is nearly identical between the two
classes in warm water** (median -0.000022 cm/s for real siliceous vs
-0.000028 for real carbonate -- statistically indistinguishable). OVEL
does not separate real warm-water carbonate from real warm-water
siliceous ooze at all. No functional form built from
`[ovelCmS, margin, otempC]` -- interaction terms, higher-order terms,
anything -- can fix this branch, because the information needed to make
the distinction isn't in these three variables for this regime. Fixing it
for real would need a genuinely different physical predictor (e.g. a real
nutrient/dissolved-silica supply proxy), not a better fit of the existing
one. Not attempted here -- BRIDGE-Valdes was not checked for a candidate
variable.

## What this does and does not show

Does show: the OTEMP upgrade is a real net improvement in aggregate
(previous show-me folder) AND a real, specific regression for one
identifiable regime (equatorial upwelling siliceous ooze) -- both true,
found by looking at an actual example rather than trusting the aggregate
number.

Does not show: a fix. Candidates not tried here: an OVEL×OTEMP interaction
term (the physically distinct signature of the two siliceous regimes is
plausibly "high OVEL regardless of OTEMP", which a model with only
additive terms cannot express); stratifying or reweighting the fit so the
minority warm-water regime isn't swamped; or reverting to plain OVEL sign
for this specific branch. Also does not show whether this regression
affects any other real Synthetic Core query point beyond the two shown --
only these two were checked.
