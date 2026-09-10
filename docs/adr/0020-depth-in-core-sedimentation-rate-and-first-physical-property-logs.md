# Depth-in-Core, a Sedimentation Rate model, and the first Physical Property Logs (density, porosity)

Requested as "physical property logs" -- the real IODP/ODP shipboard suite
(bulk density, porosity, P-wave velocity, magnetic susceptibility, natural
gamma radiation, color reflectance). Grilled down (`/grill-with-docs`,
`/domain-modeling`) from that literal framing to a specific, scoped
increment, across a sequence of explicit design decisions.

## The new axis, and why it needs its own validation milestone

Every existing field on `LithologyLogStep` (`oceanDepthKm`, `delta18O`,
`mgCa`, `hiatusRisk`, ...) is indexed purely by `ageMa`. `oceanDepthKm` is
water-column depth (GDH1 thermal subsidence) -- there has never been a
concept of depth *below the seafloor* (depth-in-core, mbsf) anywhere in
this project, because nothing before this needed to know how thick a given
age interval's sediment actually is. Real physical property logs are
conventionally read against depth-in-core, not age, so this increment adds
that axis for the first time: a **Sedimentation Rate** model integrates
forward through a Synthetic Core's own history to produce it.

This forces a new validation milestone, structurally different from the
Present-Day Lithology Map's (ADR-0006). That map could stay present-day-only
-- no reconstruction, no time integration -- because a single point's
Lithology Class only ever needed today's inputs. Total sediment thickness
at a point is a *sum over that point's entire age history*, so even the
"present-day" validation map for this model requires the full through-time
reconstruction machinery (paleoposition, paleo-OTEMP, per-step Lithology
Class mixture) already built for the single-point Synthetic Core, run
across a global grid instead of one point. There was no cheaper option
available here the way ADR-0006 had one.

## Decision

1. **Sedimentation Rate** -- a probsPrimary-weighted mixture of a literature
   end-member accumulation rate (cm/kyr) per Lithology Class, not a single
   global constant and not argmax-gated:
   `rate(step) = Σ_c probsPrimary[c] * RATE_CM_KYR[c]`. Checked directly
   during this session, real pelagic accumulation-rate literature does not
   cleanly separate carbonate-ooze and siliceous-ooze rates the way this
   project's other constants (GDH1, the CCD Curve, Anand et al. 2003) are
   cleanly sourced -- both can be fast in upwelling settings. **Sourced
   afterward** (Rothwell 2005, "Deep Ocean Pelagic Oozes", Encyclopedia of
   Geology, corroborated by Hüneke & Mulder 2011, *Deep-Sea Sediments*,
   Developments in Sedimentology 63): Carbonate Ooze 0.3-5 cm/kyr,
   Siliceous Ooze 0.2-1 cm/kyr, Clay 0.1-0.5 cm/kyr -- range midpoints
   (2.65/0.6/0.3 cm/kyr) used as `RATE_CM_KYR` in the validation prototype
   below. See "Validation result" for what running these particular
   numbers actually produced -- sourcing a real range is not the same as
   confirming the midpoint is the right point to use.
2. **Density, porosity, and the compaction integral** -- adopted from
   pyBacktrack's `lithology.py` parameter table (`primary.txt`), not
   invented fresh: `Coccolith_ooze` (2710 kg/m3, 0.59 surface porosity, 1660 m
   decay) for Carbonate Ooze, `Diatomite` (2457, 0.84, 436) for Siliceous
   Ooze, `Clay` (2735, 0.76, 1252) for Clay -- each itself literature-cited
   (Kominz et al. 2011, Sclater & Christie 1980) inside pyBacktrack's own
   table. `porosity(z) = phi0 * exp(-z / decayM)`,
   `bulkDensity(z) = porosity(z) * rhoFluid + (1 - porosity(z)) * rhoGrain`,
   both mixed across classes by the same `probsPrimary` weighting the rate
   model uses. The forward compaction math itself (accumulated-thickness ->
   compacted depth-in-core, a standard Sclater & Christie-style solve) is
   this project's own small reimplementation, not a pyBacktrack dependency
   -- see "Why constants, not the pipeline" below.
3. **Validation build path** -- a new Python prototype (show-me-style,
   mirroring `fit_probabilistic_classifier.py`), not live TS/app work first.
   It reconstructs each global grid point's full history, integrates the
   Sedimentation Rate model above, and compares predicted present-day
   sediment thickness against `GlobSed.nc` (Straume et al. 2019,
   `/Users/simon/GIT/pyBacktrack/pybacktrack/bundle_data/sediment_thickness/GlobSed.nc`
   -- confirmed present, 2161x4321, 5 arc-min, metres, max ~18.3 km). Only if
   that predicted pattern looks right does anything port into
   `syntheticCore.ts`/the live app -- the same "prototype/fit/validate in
   Python first" discipline already applied to the probabilistic classifier,
   the radiolarian belt, and the Mg/Ca calibration.
4. **v1 scope: density and porosity only.** P-wave velocity is a real
   candidate for a near-immediate follow-up (computable from bulk density
   via a published empirical relation, e.g. Erickson & Jarrard, with no new
   data source) but deliberately deferred to its own future increment --
   same "one Proxy Tracer per ADR" sizing precedent as delta18O (ADR-0014)
   landing separately from Mg/Ca (ADR-0018).
5. **Hiatus Risk stays decoupled from the Sedimentation Rate.** ADR-0019
   refused to let Hiatus Risk create any depth discontinuity in the
   *existing* age/water-depth model. That model had no accumulation concept
   to modify, so the question didn't fully apply there. It applies squarely
   here: a version where `hiatusRisk` scales the local rate toward zero
   (`rate *= (1 - hiatusRisk)`) would stay perfectly monotonic in
   depth-in-core -- it is a pause, not the erosion/removal case ADR-0019
   explicitly scoped out, so it isn't blocked by that ADR's own reasoning.
   Decided anyway, directly, not to wire it up yet: this increment's scope
   stays "add depth-in-core + density/porosity", and revisiting hiatus-as-
   rate-reduction is deliberately left as its own later increment once the
   base Sedimentation Rate model is validated against GlobSed on its own.

## Why constants, not the pipeline (pyBacktrack)

pyBacktrack is installed locally and already implements almost exactly this
domain (age-to-depth models including GDH1, a lithology-parameter table,
and a full backtracking/paleo-bathymetry pipeline) -- checked directly
before deciding how far to lean on it, not assumed reusable wholesale.
Two real mismatches surfaced:

- **Direction.** `pybacktrack.backtrack`/`paleo_bathymetry` solve the
  *inverse* problem: given a known present-day compacted thickness (from a
  real well, or from GlobSed itself), decompact backward through time.
  SODP needs the *forward* problem -- predict present-day thickness from
  the rate model, then check it against GlobSed. Feeding GlobSed in as an
  input to the model would make that check circular.
- **Plate model.** pyBacktrack's bundled reconstruction
  (`bundle_data/reconstruction/2019_v2`) is Muller et al. (2019) rotations +
  static polygons -- exactly the pairing ADR-0002 deliberately did *not*
  use. Reusing pyBacktrack's reconstruction wholesale would silently
  validate a different plate model than the one the live app ships.

So this project borrows pyBacktrack's lithology *constants* (direction- and
plate-model-agnostic data) and its published GDH1 formula as a cross-check,
but keeps its own Seton+Scotese reconstruction throughout and reimplements
the (small, standard) forward compaction integral itself, rather than
adapting pyBacktrack's `Well`/`StratigraphicUnit` API or its bundled plate
model.

## Validation result

`show-me/2026-09-09-sediment-thickness-validation/` ran the plan above:
8,062 grid points, SODP's own Seton+Scotese reconstruction ported to
Python (not pyBacktrack's pipeline, per this ADR's own decision above),
compared against GlobSed.nc. Honest result, not adjusted after the fact --
see that folder's README for the full breakdown, including a difference
map and a basin/latitude/age spatial analysis added after the first pass.

- **The shape is right**: predicted thickness increases smoothly and
  monotonically with Basement Age (thin at ridges, thickest on the oldest
  crust), with no numerical artifacts on inspection of individual points.
- **The magnitude is not**: even restricted to the plausible pelagic
  regime (GlobSed < 1000 m, excluding terrigenous-dominated margins this
  model was never scoped to reproduce), the model over-predicts by ~2.2x
  on the median, log10 r = 0.25.
- **The mismatch has a clear, physically-recognizable spatial signature,
  not a flat bias**: strong over-prediction (2-10x) sits almost exactly on
  the subtropical gyre centers (real sediment-starved "clay deserts", where
  true accumulation runs below Clay's own cited range); strong
  under-prediction sits on the equatorial upwelling belt and the Southern
  Ocean opal belt (both real fast-accumulation settings, the latter
  measured at 6-80+ cm/kyr locally in the literature check done while
  sourcing the rate table -- far above this model's flat 0.6 cm/kyr
  Siliceous Ooze midpoint). The mechanism: this model's rate is a single
  constant per class, with no room for the real fact that accumulation
  *within* a class varies by an order of magnitude or more with local
  productivity, even though the classifier's own probsPrimary mixture
  already varies correctly with position.
- **A specific alternative hypothesis raised in the first pass -- that the
  gap reflects accumulated Hiatus Risk over a longer history, arguing for
  revisiting point 5 above -- was tested directly (a Basement-Age-band
  breakdown) and is NOT well supported**: the ratio moves between 1.2x and
  2.2x across age bands with no clear trend. Downgraded, not ruled out;
  the spatial-productivity story above is the dominant, well-evidenced
  explanation for what this run actually shows.

**Follow-up test, same folder**: since the spatial pattern above is a
textbook Ekman-upwelling signature (well-approximated by latitude alone),
`fit_latitude_correction.py` fit a |latitude|-banded multiplicative rate
correction directly against the residual -- on a deterministic TRAIN half
only, evaluated on the held-out TEST half, same cross-validation discipline
ADR-0011 used for the classifier itself. Held-out result: median
predicted/observed ratio 1.46x -> 0.99x, log10 r 0.16 -> 0.57, with
train-half performance (0.55) close enough to test-half (0.57) that this
isn't overfitting a 9-bin fit to 4,025 points. This is real, honest
evidence that a position-dependent rate would fit much better than a flat
one -- but it stays Python-only and explicitly labelled experimental in
`lithology_model.py`: it was fit against this project's own residual, not
an independent literature source, it ignores a real basin-specific
mismatch the by-basin breakdown itself surfaces (Pacific 1.71x vs.
Atlantic 0.66x even after correction), and it has not been ported to
`src/lithology.ts`. Whether the live app's Sedimentation Rate should ever
get a position-dependent term -- and if so, fit against what -- is left
for its own future grilling session, not decided by this diagnostic.

## Consequences

- **One sourcing TODO resolved, one still open**: per-Lithology-Class
  Sedimentation Rate values are now sourced (Rothwell 2005/Hüneke & Mulder
  2011, see "Validation result") but shown by that same validation to need
  further tuning, not treated as final; ADR-0021's per-class grain magnetic
  susceptibility values remain unsourced. Neither should be treated as more
  than a shape check until settled.
- **`oceanDepthKm` and depth-in-core are two genuinely different axes with
  no conversion between them** -- one is water column above the seafloor
  (GDH1), the other is burial depth below it (this ADR). A future reader
  should not expect them to compose into a single "total depth."
- The Present-Day Sediment Thickness Map is validated once, offline, in
  Python, against a real published compilation -- not built as a live app
  feature by default. Whether it ever becomes one (mirroring how the
  Present-Day Lithology Map did) is a separate future decision, made only
  after the offline check looks right.
