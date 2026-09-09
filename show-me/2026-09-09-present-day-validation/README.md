# Present-day Lithology Class map vs. real point observations

First comparison this project has run against independent, real-world ground
truth. Everything before this (mask agreement, OVEL-threshold sweeps) was
internal self-consistency checking with no external data. The ground truth
is `/Users/simon/GIT/gpdata/seafloor_fabric/seafloor_lithology_point_data.csv`
-- 14,400 real seafloor-lithology point observations, 13 named classes,
present-day only (Dutkiewicz-style compilation).

**Lead finding, because it contradicts the working assumption going into
this check: the deterministic 3-class model matches real point data much
less than the earlier show-me maps suggested "plausible" implied.** Overall
agreement is 48% for clay, 25% for carbonate-ooze, and 10% for
siliceous-ooze -- carbonate and siliceous are at or below what you'd get by
chance if the three classes were equally likely (33%). This does not
overturn Phase 1 (real bathymetry + per-basin CCD, ADR-0008) as a
directional improvement over GDH1-synthetic depth -- that comparison was
never against real point data either -- but it means "looks visually
plausible on a global map" and "matches real samples" are different claims,
and only the first one had been checked before now.

## Method

13 real classes were bucketed onto SODP's 3-class scheme plus two buckets
that are deliberately **not** discarded (see `validate.py`'s own module
doc for why dropping them would hide information):
- `mixed` -- "Mixed Calcareous/Siliceous Ooze" (282 pts), real-world
  evidence of an in-between case, kept separate rather than folded into
  either side.
- `other-nonpelagic` -- Sand, Silt, Gravel and Coarser, Shells and Coral
  Fragments, Ash and Volcanic Sand/Gravel (1,853 pts total) -- terrigenous/
  near-shore/glacial-rafted material the 3-class scheme was never meant to
  describe. Cross-tabulating these against the model's own prediction
  tests whether the model's oceanic-crust mask already excludes them.

Each real point's (lon, lat) was mapped to the same 360x181 grid cell the
present-day model itself uses (`texelIndex()`, ported exactly from
`src/core/volume.ts`), reading `../2026-09-08-lithology-map/lithology_grid.json`
-- the actual validated Phase 1 output, not a re-run.

## Figures

**01-agreement-by-class.png** -- tests the headline claim directly: for
each of the 3 mappable classes, what fraction of real points does the model
get right? Clay (48%) is the best case; siliceous-ooze (10%) the worst,
well below chance.

**02-siliceous-vs-latitude.png** -- tests whether the siliceous-ooze
failure is a coverage gap or a classification error, by binning real
siliceous-ooze points (median latitude -55°, the Southern Ocean opal belt)
by |latitude|. Past 70°, the model calls 89% of real siliceous-ooze points
"no-data" and gets 0% right.

**03-confusion-matrix.png** -- the full picture, row-normalized. Two things
worth reading off it beyond the headline: real carbonate-ooze points are
most often called clay (44%), not carbonate-ooze (25%) -- a bigger single
error mode than siliceous-ooze's no-data problem in absolute count (2,525
points). And `other-nonpelagic` points are correctly masked (no-data) 70%
of the time -- the oceanic-crust mask is doing real, correct work there,
just not perfectly (30% still get painted as pelagic ooze/clay).

**04-siliceous-points-south-polar.png** -- maps every real siliceous-ooze
point, colored by what the model predicts there, south-polar projection.
Shows two distinct, spatially separated failure modes rather than one:
a ring of no-data (gray) hugging the Antarctic coast itself, and beyond
that, a wide band where the real opal belt is present but the model calls
it carbonate-ooze (orange) instead -- a real misclassification, not a
masking gap.

## Root cause of the no-data ring (checked directly, not assumed)

Traced against the raw local grids for the 1,295 real siliceous-ooze
points at |lat| >= 60°: the Basement Age grid (Seton et al. 2020) itself
has no value at 918 of them (71%); the bathymetry grid (SRTM15) is missing
only 109. So the no-data ring is a genuine data-coverage gap in the
oceanic-crust age grid near Antarctica -- plausibly sparse magnetic-anomaly
picks under sea ice / poor survey coverage close to the continental margin
-- not a bug in this project's masking logic, and not fixable by changing
the classification rule.

The carbonate-ooze misclassification band further from the coast is a
different, second problem: real opal-belt seafloor where Basement Age
*is* available, and the model still calls it carbonate. That one **is** a
classification-logic question -- consistent with, and now with real-world
teeth added to, the OVEL-sign-dominance issue already documented in
`../2026-09-08-lithology-map/README.md` and `docs/adr/0007-three-class-lithology-rule.md`.

## Follow-up: fitting margin + |latitude| against real labels (fit_carbonate_siliceous.py)

Quantifying the point-2 fix proposed above. Restricted to the branch of
`classifyLithology()` that actually decides carbonate-vs-siliceous (OVEL>0,
real label one of those two classes; n=2,520): the current deterministic
rule (margin<0 -> carbonate) gets **65.8%** right on real labels. A logistic
fit using the same single variable (margin alone) does no better --
**66.2%**, AUC 0.630, barely above a coin flip. Adding |latitude| as a
second predictor lifts 5-fold cross-validated accuracy to **80.2%**, AUC
**0.880**. This is not a marginal gain from tuning an existing knob; it's
what happens when the missing variable gets added.

**05-margin-lat-decision-boundary.png** plots every real point in
(margin, |latitude|) space. The current rule's boundary is the vertical
dashed line at margin=0 -- and visibly cuts through a mixed cloud of both
colors, which is exactly what a 66% accuracy / 0.63 AUC looks like. The
fitted boundary (red) is a diagonal: at low latitude, carbonate wins even
well above the CCD (bottom-right is solid orange); at high latitude,
siliceous wins even well below the CCD, i.e. even where margin says
"shallow enough to preserve carbonate" (top-left/top-right is solid
green). The CCD-margin variable isn't wrong, it's incomplete -- it governs
preservation, but says nothing about whether cold water is producing
carbonate in the first place.

Fitted boundary: `0.835*margin + 0.087*|lat| - 3.529 = 0` -- present-day
only, one global fit (not per-basin), offered as evidence the direction is
right, not as a calibrated production rule yet.

## Deployed: ADR-0010's probabilistic classifier (compute_probabilistic_grid.mjs)

`src/lithology.ts` now has `classifyLithologyProbabilistic()` (multinomial
logistic on `[ovelCmS, oceanDepthKm-ccdKm, |latDeg|]`, fit against all
8,445 real points with valid drivers), wired into
`src/presentDayMap.ts::buildPresentDayGrid()` in place of the deterministic
`classifyLithology()`. Full design and the fit's own cross-validated
numbers (66.2% vs. the deterministic rule's 43.1%, both measured only
where drivers are valid) are in `docs/adr/0010-probabilistic-lithology-
classifier.md`.

**06-before-after-deployed-map.png** re-validates the ACTUAL deployed
pipeline end to end (`compute_probabilistic_grid.mjs`, calling
`loadPresentDayInputs`/`buildPresentDayGrid` for real against a running
dev server + the live Geode archive -- not a re-run of the offline fit),
against all 14,400 real points, no-data ring included as an automatic
miss this time (unlike the fit's own cross-validation, which excluded it).
Overall 3-class accuracy: **29.6% -> 45.5%**. By class: carbonate-ooze
25%->56%, siliceous-ooze 10%->21%, **clay 48%->45%, a small regression**
-- reported because it's real, not because it supports the headline
number. Net effect is a large improvement, achieved honestly rather than
by only checking the classes expected to improve.

## Upgrade: OTEMP replaces |latitude| (ADR-0011), and now runs through time too

|latitude| was always a proxy -- checked whether BRIDGE-Valdes's own OTEMP
(real ocean temperature, same dataset OVEL comes from, same frames, same
layer convention) does better. It does, at no coverage cost
(`fit_with_otemp.py`): 66.2% -> 67.9% 5-fold CV accuracy, and combining
both adds nothing (corr(|lat|, OTEMP) = -0.93 -- same signal, OTEMP is
just the real thing). Refit and deployed
(`fit_probabilistic_classifier.py`, `src/lithology.ts`).

**07-three-generations-deployed-map.png** re-validates the actual deployed
pipeline a third time. Overall 3-class accuracy: deterministic 29.6% ->
|lat| 45.5% -> OTEMP 46.8%. Siliceous-ooze keeps improving (10%->21%->27%);
carbonate-ooze is flat between the two probabilistic versions (56%->57%);
clay's small regression persists (48%->45%->45%) and did not get worse
again -- consistent with |lat| and OTEMP carrying nearly the same
information, as the correlation above already said they would.

Because OTEMP is a real quantity at every one of BRIDGE-Valdes's 109
frames (not a present-day-only proxy), **Phase 2 now uses this same
classifier through time** -- see ADR-0011 for the full decision and its
honest remaining limitation: the fit itself is still calibrated once, at
present day, and applied at other times on the strength of OTEMP being the
real driving mechanism rather than a proxy that changes meaning with
climate state -- not because the fit has been checked against any paleo
ground truth, which does not exist for this project to check against.

## What this does and does not show

Does show: real, checkable disagreement between the deterministic model
and independent point data, with two separable causes (a data-coverage gap
near Antarctica; a genuine classification error in the Southern Ocean opal
belt and, per the confusion matrix, in carbonate-vs-clay generally).

Does not show: a calibrated, deployable rule (the fit above is one global
logistic on present-day data, not cross-validated by basin, not compared
against simpler alternatives like a fixed |lat| cutoff, and not yet
extended to the OVEL<=0/clay branch this same real dataset could also
calibrate); or how the *through-time* Synthetic Core (Phase 2, which reuses
GDH1 + the global CCD curve, not this present-day pipeline) is affected --
this analysis is present-day only, and Phase 2 would need paleo-latitude
from its own trajectory, not present-day latitude, for the same idea to
carry through time.
