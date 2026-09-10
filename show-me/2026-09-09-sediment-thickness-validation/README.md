# Sediment Thickness validation (ADR-0020)

**Claim under test**: does ADR-0020's Sedimentation Rate model (a
probsPrimary-weighted mixture of Rothwell 2005 / Hüneke & Mulder 2011
literature midpoints per Lithology Class, forward-compacted through
pyBacktrack-adopted density/porosity/decay constants) reproduce the real
global pattern of present-day sediment thickness, checked against Straume
et al. (2019) GlobSed?

Python-first, per ADR-0020's build path -- nothing here has been ported to
TS/the live app.

## Method

`predict_sediment_thickness.py` reconstructs 8,062 present-day ocean grid
points (2deg stride over the basement-age grid's native 1deg resolution)
using **SODP's own Seton+Scotese reconstruction** (`reconstruct.py`, a
direct Python port of `src/core/staticPolygons.ts`/`rotation.ts` reading
the same prepped `archive/reconstructions/scotese-paleomap/` files the live
app ships -- not pyBacktrack's bundled Muller 2019 model, see ADR-0020's
"why constants, not the pipeline"). At each point's own real BRIDGE-Valdes
frame ages, it samples paleo-OTEMP, runs the same probabilistic classifier
`src/lithology.ts` uses (coefficients copied verbatim), derives a
Sedimentation Rate and pyBacktrack-sourced compaction parameters from the
resulting Lithology Class mixture, and forward-compacts the accumulated
column (`lithology_model.py`). `compare_to_globsed.py` samples GlobSed.nc
at the same points and produces the three figures below.

Run:
```
conda run -n pygmt17 python predict_sediment_thickness.py --stride 2
conda run -n pygmt17 python compare_to_globsed.py
```

## Result

- **01-predicted-vs-globsed-scatter.png** -- log10 Pearson r = 0.15 across
  all 8,048 points with both a prediction and a GlobSed value; median
  predicted/observed ratio 1.47x (we over-predict on the median).
- **02-predicted-thickness-map.png** / **03-globsed-thickness-map.png** --
  same colour scale, same points.
- **04-log-ratio-difference-map.png** -- log10(predicted/GlobSed) per point,
  diverging, the map that actually explains the weak correlation above.

Predicted thickness increases smoothly and monotonically with Basement
Age, exactly as expected (thin at ridges, thickest on the oldest crust) --
median 70 m at 0-10 Ma, 351 m at 30-60 Ma, 665 m at 100-150 Ma. That part
of the pattern is right.

**Two honest problems, not one -- and the second one has a clear spatial
signature, not a fuzzy one:**

1. **GlobSed's dynamic range is enormous (0-18.3 km) and dominated by
   terrigenous sources** -- river-derived clastic input, turbidites,
   glaciomarine debris near continental margins and in marginal seas/fans
   (Bengal, Indus, Mississippi). SODP's Lithology Class scheme is
   explicitly pelagic-only (Carbonate Ooze, Siliceous Ooze, Clay =
   *pelagic* red clay, CONTEXT.md) with no terrigenous source term at all
   -- this was never in scope, v1 or otherwise. 80% of validation points
   have GlobSed < 1000 m, but the remaining ~20% (mostly margin-adjacent)
   pull real thickness into the multi-km range this model has no
   mechanism to produce.
2. **Even restricted to GlobSed < 1000 m, the model still over-predicts by
   ~2.2x on the median** -- but the difference map shows this isn't a flat
   bias. It's three distinct, physically-recognizable regions:
   - **Deep red (2-10x over-prediction) sits almost exactly on the
     subtropical gyre centers** -- North & South Pacific, North & South
     Atlantic, the Indian Ocean gyre -- the real ocean's most sediment-
     starved "clay deserts", where real accumulation is at or below the
     bottom of Rothwell's own 0.1-0.5 cm/kyr Clay range. This model uses a
     single flat midpoint (0.3 cm/kyr) for every clay-classified point
     everywhere, so it cannot distinguish a true gyre-center desert from
     any other clay setting.
   - **A blue (under-prediction) band sits right on the equator**,
     visible in both Pacific and Atlantic -- the real equatorial
     upwelling carbonate/opal belt, one of the fastest pelagic
     accumulation settings on Earth, running well above this model's flat
     carbonate/siliceous-ooze midpoints.
   - **Strong blue at high southern latitudes (the Southern Ocean opal
     belt) and at Arctic margins.** Consistent with the literature check
     done while sourcing the rate table: real Southern Ocean diatom-ooze
     sites measure 6-80+ cm/kyr locally (ODP Sites 1091/1093/1094) against
     this model's flat 0.6 cm/kyr Siliceous Ooze midpoint -- roughly the
     right order of magnitude to explain the gap. High-latitude margins
     also carry real ice-rafted debris input this model has no term for
     at all.
   - By ocean basin: Pacific over-predicts hardest (median 3.9x, dominated
     by its huge oligotrophic gyre area), Atlantic is closest to balanced
     (1.2x), Indian in between (1.3x) -- consistent with the gyre-center
     story above, not a basin-intrinsic effect.

   **The mechanism, precisely stated**: the model's per-class rate is a
   single constant, with no room for the real, well-known fact that
   accumulation rate *within* a lithology class varies by an order of
   magnitude or more with local productivity -- gyre-center clay is far
   slower than margin clay; equatorial and Southern-Ocean biogenic ooze is
   far faster than the ooze end-member's own literature midpoint. The
   classifier's probsPrimary mixture already varies correctly with
   position (a gyre center gets more clay-weighted probs than the equator
   does); it's the constant attached to each class that doesn't.

   A **basement-age breakdown was also run, to test a specific alternative
   hypothesis (that the gap grows with age, consistent with uncounted
   Hiatus Risk accumulating over a longer history)** -- it does not: the
   ratio moves between 1.2x and 2.2x across age bands with no clear trend.
   That hypothesis is not well supported by this run and is downgraded
   below; the basin/latitude pattern is the dominant, well-evidenced
   signal, not a secondary one.

## Latitude correction (experimental, cross-validated)

The gyre-desert/equatorial-belt/Southern-Ocean pattern above is famously
well approximated by latitude alone -- wind-stress-curl-driven Ekman
upwelling gives high productivity at the equator and at high latitude, low
in the subtropical gyres between. Rather than guess a curve, `fit_latitude_correction.py`
fits a |latitude|-banded multiplicative rate correction **directly against
this folder's own baseline residual**, on a deterministic TRAIN half only
(even point index) -- same "don't grade a fit on the data it was fit to"
discipline ADR-0011 used for the Lithology Class classifier itself
(5-fold cross-validated there, not fit-then-graded-on-itself). The fitted
table lives in `lithology_model.py::latitude_rate_multiplier()`, labelled
there as experimental and NOT a literature constant, applied at each
Synthetic Core step's own **paleo**-latitude (same convention as
`applyEquatorialRadiolarianBelt()` in `src/lithology.ts`).

Run:
```
conda run -n pygmt17 python predict_sediment_thickness.py --stride 2 --lat-correction
conda run -n pygmt17 python compare_to_globsed.py --input predicted_thickness_latcorrected.json \
    --test-only --prefix corrected- --title-suffix " (held-out test half, lat-corrected)"
```

**Held-out TEST half (odd point index, never used to fit the correction) --
the only honest number:**

| | baseline | lat-corrected (test) |
|---|---|---|
| median predicted/observed ratio | 1.46x | **0.99x** |
| median absolute log10 ratio (typical error) | 0.52 | **0.33** |
| log10 Pearson r | 0.16 | **0.57** |

Train-half performance (log10 r = 0.55) is almost identical to test-half
(0.57) -- a 9-bin fit against 4,025 points is not overfitting this.
**corrected-01-predicted-vs-globsed-scatter.png** now hugs the 1:1 line
across two decades (10-2000 m), a visibly different shape from the
baseline's flat, uncorrelated blob. **corrected-04-log-ratio-difference-map.png**
still shows real residual structure -- notably the Pacific gyres remain
somewhat over-predicted (basin median 1.71x vs. Atlantic's 0.66x and
Indian's 0.81x) -- because a single *global* latitude curve can't capture
a basin-specific magnitude difference. That's a legitimate, named
limitation of this specific correction, not a hidden one.

This is still explicitly a diagnostic/experimental result, not a
literature-sourced replacement for `RATE_CM_KYR`: it's a curve fit to make
this specific comparison come out right, kept in Python only, clearly
labelled as such in `lithology_model.py`, and not ported to TS. Whether
SODP's real Sedimentation Rate model should ever get anything like this
(and if so, fit against something more principled than this project's own
residual, and probably basin-aware) is exactly the kind of decision that
belongs in its own grilling session.

## What this validates, and what it doesn't

**Validates**: the reconstruction pipeline (Seton+Scotese, ported
faithfully from the live TS), the classifier port, and the compaction
integral all behave sanely and produce a physically sensible age-thickness
relationship with no numerical artifacts (checked directly on individual
points, not just aggregate stats).

**Does not validate**: the actual literature rate values (flagged as
unsourced-for-this-model in ADR-0020, and this result is direct evidence
they need revisiting, not confirmation they're fine) or any terrigenous/
margin process (out of scope by design, not a gap this increment was ever
meant to close).

## Not done here, deliberately

The latitude correction above is diagnostic evidence, not a design
decision: it stays Python-only, unported, and explicitly labelled
experimental in code. Not done, on purpose:

- **No literature source was swapped in for `RATE_CM_KYR`** -- the
  correction was fit against this project's own residual, not against an
  independent real productivity/accumulation dataset the way every other
  constant in this project is sourced.
- **No basin-specific term**, even though the by-basin breakdown shows the
  single global curve over-corrects Atlantic/Indian while under-correcting
  Pacific -- a real, named limitation, not fixed here.
- **No change to `src/lithology.ts`/`syntheticCore.ts`** -- this result
  argues FOR eventually letting the live app's Sedimentation Rate vary
  with position, not that today's flat version is wrong for its own
  already-stated scope. That's a decision for its own grilling session.
- Hiatus Risk's interaction with the rate model (ADR-0020's original open
  question) stays downgraded, not ruled out, by the flat basement-age
  breakdown found in the baseline run -- still worth a look, just not the
  leading explanation for what this run shows.

## Full spatial/basin breakdown

```
By basin (median predicted/observed ratio):
  Atlantic   n=1511  median ratio=1.17x  log10 r=0.47
  Pacific    n=3056  median ratio=3.87x  log10 r=0.31
  Indian     n=1252  median ratio=1.34x  log10 r=0.30

By |latitude| band (median predicted/observed ratio):
  [ 0,15) n=1776  median ratio=2.38x
  [15,30) n=1499  median ratio=4.98x
  [30,45) n=1777  median ratio=2.21x
  [45,60) n=1452  median ratio=0.88x
  [60,90) n=1364  median ratio=0.21x

By Basement Age band (median predicted/observed ratio):
  [  0, 20) Ma n=1532  median ratio=1.22x
  [ 20, 50) Ma n=2269  median ratio=1.92x
  [ 50,100) Ma n=2538  median ratio=1.33x
  [100,150) Ma n=1412  median ratio=1.25x
  [150,340) Ma n= 297  median ratio=2.24x
```
