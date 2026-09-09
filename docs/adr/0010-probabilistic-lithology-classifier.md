# Present-Day Lithology Map uses a probabilistic classifier, fit against real point data, instead of the deterministic 3-line rule

> **Superseded by ADR-0011 (2026-09-09):** the `|latitude|` predictor
> below is replaced by real OTEMP (ocean temperature, same BRIDGE-Valdes
> dataset OVEL comes from), which also removed the reason this ADR kept
> Phase 2 on the deterministic rule -- Phase 2 now uses this classifier
> too, with each step's own real paleo-OTEMP. The real-data numbers below
> (43.1% deterministic vs. 66.2% probabilistic) are unaffected and still
> the ones that motivated building this at all; only the third feature and
> Phase 2's status changed.

ADR-0007's `classifyLithology()` was deliberately built with no literature
source behind its exact functional form -- a placeholder good enough to get
Phase 1 and Phase 2's skeleton running, flagged from the start as needing a
real check. `show-me/2026-09-09-present-day-validation/` ran that check for
the first time against independent, real-world ground truth (14,400 real
seafloor-lithology point observations, Dutkiewicz-style compilation,
present-day only) and found the deterministic rule performing worse than
expected, in a specific, diagnosable way -- not randomly wrong, wrong
because of an identifiable missing variable.

## What the real-data check found

Overall 3-way accuracy of `classifyLithology()` against real labels:
**43.1%** -- below the 48.8% you'd get by guessing "carbonate-ooze" for
every single point. Broken down by branch:

- **The `ovelCmS <= 0 -> clay` gate is not just imperfect, it is worse than
  a trivial baseline.** 53.3% accuracy on real "is this point clay?"
  labels, vs. 63.2% for always guessing "not clay" (the real majority
  class). A logistic fit on OVEL alone does no better than that same 63.2%
  baseline (AUC 0.552) -- OVEL sign carries almost no information on its
  own about real clay vs. real ooze.
- **The `oceanDepthKm < ccdKm -> carbonate-ooze, else siliceous-ooze`
  branch** (once OVEL says "something is being produced") scores 65.8%
  against real labels in that branch, but a logistic fit on the same single
  variable (margin = depth − CCD) does no better: 66.2%, AUC 0.630. Not a
  threshold-tuning problem -- margin doesn't separate real carbonate from
  real siliceous at all (medians -1.3 km vs -1.0 km, heavily overlapping).

In both branches, adding **|latitude|** as a second predictor produced a
large, not marginal, improvement: the carbonate/siliceous branch goes from
66.2% to 80.2% (AUC 0.630 -> 0.880); the full 3-way problem (OVEL, margin,
|latitude| together) reaches **66.2%** 5-fold cross-validated accuracy,
vs. 43.1% for the deterministic rule on the same real data. This has a
physical reading: calcifying plankton (coccolithophores, foraminifera) are
temperature-limited independent of the CCD, while diatoms are not, so cold
water above the CCD can still be silica-dominated -- something
`oceanDepthKm`/`ccdKm`/`ovelCmS` alone cannot express, and |latitude| is
a workable present-day proxy for.

## Decision

**For the Present-Day Lithology Map**, replace `classifyLithology()` with
`classifyLithologyProbabilistic()` (`src/lithology.ts`): a multinomial
logistic regression over `[ovelCmS, oceanDepthKm - ccdKm, |latDeg|]`,
fit against all 8,445 real points with a valid driver reading (excludes
the Basement Age no-data ring near Antarctica -- ADR/deferred, see below),
returning a full probability distribution
(`{clay, carbonate-ooze, siliceous-ooze}` summing to 1), not a single
label. `argmaxLithologyClass()` recovers a single label for callers that
want one (e.g. the map's pixel color), while the full distribution stays
available for callers that want to sample instead of always taking the
mode -- the "more nuance" motivation this whole investigation started
from.

Coefficients live in `src/lithology.ts` as `PROB_CLASSIFIER`, fit and
validated in `show-me/2026-09-09-present-day-validation/
fit_probabilistic_classifier.py` and `validate.py`, in raw feature units
(the fit's internal `StandardScaler` state is converted back to raw-unit
coefficients so no scaler needs to travel with the production code --
see the fit script's own comment for the conversion arithmetic).

**`classifyLithology()` is NOT removed or changed.** Phase 2's through-time
query (`syntheticCore.ts`) still calls it. See Consequences for why this
is a real gap, not an oversight.

## Consequences

- **Real, quantified improvement, not a full fix.** 66.2% cross-validated
  accuracy against real labels is a large jump from 43.1%, but is not
  claimed to be a calibrated, deployable-with-confidence model: it is one
  global logistic fit, not cross-validated by ocean basin, not compared
  against simpler alternatives (e.g. a fixed |latitude| cutoff instead of
  a fitted slope), and the OVEL<=0/clay branch's fit (63.2%→73.4%, adding
  margin+|lat|) individually still leaves real room below what a richer
  feature set might reach.
- **|latitude| is a present-day proxy, not a mechanism.** It stands in for
  SST control on calcification. A point's *absolute* present-day latitude
  is not the climate belt it sat in through geological time -- plates
  drift, and paleoclimate zones don't track present latitude 1:1. Phase 2
  already computes real paleo-latitude at every step via
  `buildAgeDepthModel()`'s trajectory; wiring the probabilistic classifier
  into Phase 2 would mean using that paleo-latitude, not reusing this
  present-day fit's coefficients unmodified against present-day latitude
  for a query about the deep past. **Not done here** -- Phase 2 still
  calls the deterministic `classifyLithology()`, deliberately, until that
  paleo-latitude wiring is designed rather than assumed.
- **The Basement Age no-data ring near Antarctica (traced to the Seton et
  al. 2020 crustal age grid's own sparse coverage there, not a masking
  bug) is unaffected by this ADR and remains deferred.** Fixing it would
  mean using the deformation model's tectonothermal age / rifting-history
  subsidence in place of Basement Age for those points -- a separate,
  larger piece of work, explicitly out of scope here.
- **The training data is the same 14,400-point compilation used to
  discover the problem.** There is no held-out, independently-sourced
  second dataset to confirm the fit generalizes beyond this one
  compilation's own sampling biases (e.g. which regions have been cored
  and logged, which have not).
