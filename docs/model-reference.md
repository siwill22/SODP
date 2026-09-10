# SODP Model Reference

A lookup table for this project's outputs: for each map/core data type, what
it models, where the numbers come from, what's been checked against real
data, what's known to be wrong or unchecked, and what the recorded next
steps are. `CONTEXT.md` defines the vocabulary used here; `docs/adr/`
records *why* each choice was made — this doc is the *current-state*
cross-section through both, organized by deliverable rather than by
decision. Where this doc and an ADR disagree, the ADR is authoritative
(this doc can drift; individual ADRs are the permanent record).

**Status key**, used throughout:

| Status | Meaning |
|---|---|
| 🟢 **Live, validated** | Ships in the app; checked against independent real-world data. |
| 🟡 **Live, shape-only** | Ships in the app; checked for physical plausibility, not against independent real data (or checked and found to disagree, tracked as a known limitation). |
| 🔵 **Python-prototyped** | Validated offline in Python against real data; not ported to `src/`. |
| ⚪ **Designed only** | An ADR exists; no implementation or validation yet. |

---

## Foundational drivers

Not outputs themselves — every data type below is built on these. Listed
once here rather than repeated in every section.

| Driver | What it is | Source | Key caveat |
|---|---|---|---|
| **Basement Age** | Present-day-only crustal age lookup | Seton et al. (2020), resampled once (ADR-0004) | No-data ring near Antarctica — sparse magnetic-anomaly coverage in the source grid, not a bug (found during present-day validation) |
| **Plate reconstruction** | Rotation + assignment for Preserved Crust only | Scotese/PALEOMAP static polygons + Seton age grid, deliberately paired despite different provenance (ADR-0002) | Only valid for crust surviving to present day; not a general-purpose reconstruction |
| **Climate Driver** | OTEMP, OCURU/OCURV (and formerly OVEL) at 109 timeslices, 0–541 Ma | BRIDGE-Valdes (Valdes, Scotese & Lunt 2021 HadCM3) — the only Climate Driver this project reads (ADR-0003) | One model's simulated output, not observational; coarse ocean grid (currents ~0.14–0.26 m/s max vs. real 10–20 cm/s erosion-relevant flow) |
| **CCD Curve** | Carbonate compensation depth vs. age, two independent estimates | Published (digitized literature) + CO2-Linked (Foster et al. 2017 CO2 through an empirical regression), ADR-0005 | Real ~2 km discontinuity at the Published Curve's real/digitized tier boundary (~70–75 Ma), not smoothed; CO2-Linked's residuals are age-structured, not random (R²=0.49) |

---

## Present-Day Lithology Map

**Status: 🟢 Live, validated** (ADR-0006/0007/0008/0010/0011/0012/0013/0022)

**Models**: a single categorical Lithology Class (Carbonate Ooze / Siliceous
Ooze / Clay) at every present-day ocean grid cell, no time integration.

**Method**: `classifyLithologyProbabilistic()` — a multinomial logistic
regression on `[oceanDepthKm − ccdKm, otempC]`, fit against 8,445 real
seafloor-lithology points. Depth comes from real bathymetry (SRTM15), CCD
from a per-basin lookup (Atlantic/Pacific/Indian) where a basin is known,
else the single global value. An optional "Option A" (`applyEquatorialRadiolarianBelt`)
layers a Diesing-(2020)-informed smooth equatorial adjustment on top,
kept as an equal alternative to the OTEMP-only "Option B", not a
replacement.

**Assumptions**: OVEL was tested and dropped as a predictor (no measurable
skill once OTEMP is included); depth-CCD margin and OTEMP are treated as
independently sufficient; the equatorial belt (Option A) trusts Diesing's
richer-covariate extrapolation from the *same* thin 106-point sample this
project already has, not independent ground truth.

**Validated against**: 14,400 real point observations (Dutkiewicz-style
compilation) — deployed end-to-end accuracy 46.8% (vs. 29.6% for the
original deterministic rule); by class, carbonate-ooze 57%, siliceous-ooze
27%, clay 45%.

**Known limitations**:
- **Warm/equatorial siliceous-ooze: 0% recall**, a real, investigated, and
  accepted blind spot. Real carbonate-ooze outnumbers real siliceous-ooze
  12:1 in warm water, and OVEL doesn't separate them there either. Four
  independent fix attempts failed (OVEL×OTEMP interaction, OSAL, Diesing's
  covariates, real WOA23 silicate) — even the true causal variable
  (measured silicate) only reaches AUC 0.61 there. Option A patches most of
  this geographically but is not a model fix.
- No area-weighting (percentages are pixel counts on an equirectangular
  grid, not `cos(latitude)`-weighted) — flagged, never fixed.
- Real-world magnitudes still undershoot: best case Atlantic 31.4% carbonate
  vs. real ~60%. Candidates not investigated: the OVEL-sign-inherited
  zero-margin sensitivity, 1°-grid resolution hiding narrow features.
- Antarctic no-data ring (Basement Age grid's own coverage gap).

**Avenues for improvement**: a real productivity/silicate proxy from a
source other than BRIDGE-Valdes; per-basin classifier refitting (current
fit is one global logistic, not basin-stratified); area-weighted validation
metrics.

---

## Synthetic Core: Lithology Class (through-time)

**Status: 🟡 Live, shape-only for the trajectory / 🟢 validated at the classifier level**
(ADR-0009/0011/0012/0013/0022)

**Models**: the same probabilistic classifier as the present-day map,
applied at every step of a queried point's real reconstructed history — its
own paleoposition, its own real paleo-OTEMP, both modeled CCD curves
carried in parallel and flagged (not averaged) where they disagree.

**Method**: `buildLithologyLog()` — GDH1 synthetic depth (not real
bathymetry — no observed depth exists for the past) at every step except
`ageMa === 0`, which is anchored to the same real bathymetry + basin CCD
the map itself used for that pixel (ADR-0022), so a core's "today" never
contradicts the map cell it was clicked from.

**Assumptions**: the classifier is fit once, at present day, and applied at
every past OTEMP value on the strength of OTEMP being the real physical
mechanism (not a proxy whose meaning changes with climate state) — a real,
unverifiable-for-now assumption, since no paleo lithology ground truth
exists to check it against.

**Validated against**: no direct through-time ground truth (none exists);
indirectly validated via the present-day classifier's own numbers, plus eye
checks against known Pacific/Atlantic plate-motion history and pelagic
sedimentation theory (`show-me/2026-09-09-synthetic-core-skeleton/`) — a
smooth, physically plausible trajectory and class history, not a
quantitative check.

**Known limitations**:
- **Every step older than `ageMa=0` still uses the single *global* CCD
  curve, not the present-day map's per-basin CCD** — a real, named
  inconsistency between the two phases (found in the synthetic-core-skeleton
  eye-check), not fixed: ADR-0008's basin-specific fix was never carried
  into the through-time query beyond the ADR-0022 anchor point.
- Same warm/equatorial siliceous-ooze blind spot as the present-day map,
  now visible as an erasure across a point's *entire* history, not one
  pixel — the flagship (-150, 15) "textbook story" example lost its
  siliceous-ooze phase entirely when OTEMP replaced the deterministic rule
  (a real, documented regression, traded for a net aggregate improvement).
- GDH1 has no dynamic topography/sediment-loading/hotspot-swell correction
  — a real, un-quantified source of error at every step except the ADR-0022
  anchor.
- No real IODP/ODP/DSDP core comparison anywhere (deliberately
  deprioritized from the start, per the plan doc).

**Avenues for improvement**: extend the ADR-0022 anchor logic's basin-CCD
awareness backward in time (would need a basin-membership-through-time
scheme — already flagged as future shared infrastructure with the deferred
Nd-isotope proxy, ADR-0005); investigate a per-regime (warm vs. cold)
classifier split.

---

## Synthetic Core: δ18O Proxy Tracer

**Status: 🟢 Live, validated** (ADR-0014, ADR-0016)

**Models**: calcite δ18O (‰ VPDB) at every step with valid OTEMP, via the
inverted Shackleton (1974) paleotemperature equation.

**Assumptions**: seawater δ18O is a fixed global constant (0‰ VSMOW,
today's approximate ice-free mean) — does not vary with ice-volume state
through deep time. Not gated on Lithology Class (ADR-0016): computed
wherever OTEMP is valid, paired with `probsPrimary['carbonate-ooze']` for
the caller to judge plausibility, not silently suppressed by a label.

**Validated against**: 10 real core-top sites (Anderson & Mulitza 2001,
*G. ruber*), r=0.93, mean absolute error 0.58‰ — comparable to published
calibration studies' own intrinsic scatter (~0.47–0.54‰). Small systematic
offset (~0.45‰): this project's OTEMP runs slightly warm at these sites.

**Known limitations**: fixed seawater δ18O will understate real swings
across genuinely different ice-volume states (full icehouse vs. ice-free
hothouse); single generic calcite assumption, not species-specific.

**Avenues for improvement**: scale seawater δ18O with a real ice-volume
proxy through time (flagged in ADR-0014 as the next thing to revisit if
absolute values need to matter for a real comparison).

---

## Synthetic Core: Mg/Ca Proxy Tracer

**Status: 🟢 Live, validated** (ADR-0018)

**Models**: Mg/Ca (mmol/mol) at every step with valid OTEMP, via Anand,
Elderfield & Wilson (2003)'s pooled multi-species calibration.

**Assumptions**: same non-gating treatment as δ18O (ADR-0016). No
dissolution correction — real Mg/Ca is depressed by carbonate dissolution
at depth (e.g. Dekens et al. 2002); this project already computes the
CCD-margin input such a correction would need but deliberately doesn't
apply it, to keep this a single-equation companion to δ18O rather than a
second, independently-sourced relationship.

**Validated against**: 7 real core-top sites (Johnstone, Elderfield & Yu
2011, *G. ruber*), r=0.71, mean absolute error 0.64 mmol/mol — weaker than
δ18O. Directional pattern consistent with BRIDGE-Valdes's known compressed
meridional SST gradient (reads high at cool sites, low at the warmest).

**Known limitations**: will read systematically warmer than a real, deeply
buried/dissolved sample, especially near/below the CCD; single pooled
calibration stands in for real species-specific variability.

**Avenues for improvement**: a dissolution correction using the
already-computed CCD margin (explicitly deferred, not attempted).

---

## Synthetic Core: Hiatus Risk

**Status: 🟡 Live, shape-only** (ADR-0019)

**Models**: a continuous per-step preservation-risk *annotation* (never a
depth discontinuity or removed step) — decomposed into **Current Erosion
Risk** (bottom-current speed, percentile-ranked within this model's own
real global speed distribution) and **Dissolution Risk** (CCD margin,
boosted when the two CCD curves diverge), plus a derived combined
probability.

**Assumptions**: erosion (physical removal of already-deposited section) is
explicitly out of scope — this only models a *pause*, not a discontinuity.
Current Erosion Risk went through three calibrations before landing on a
percentile rank: two absolute-threshold attempts (a literature
critical-erosion-velocity figure; this model's own 95th percentile) were
both found *functionally unreachable* by any real query point, not just
usually inert — checked directly against a full sweep of the real
dataset and all real candidate trajectories. The percentile-rank transform
trades away any claim about absolute erosion-relevant speed for a much
weaker, defensible one: relative speed within this model's own output.

**Validated against**: no ground-truth hiatus/erosion dataset exists or was
sourced (deliberately, per the original scoping) — verified only for
internal consistency (bounded [0,1], recomputes exactly from real inputs,
decoding cross-checked against a known-strong real signal).

**Known limitations**: a percentile-rank transform guarantees a roughly
uniform [0,1] spread by construction, which may overstate how often
erosion-driven loss should be considered likely at a typical point compared
to what's probably a genuinely rare real phenomenon — flagged, not
corrected. `currentErosionRisk` is the field in this whole project most
likely to need real refitting if a ground-truth dataset ever appears.

**Avenues for improvement**: a power-law reshaping (`risk^k`, k>1) to
compress the bulk of the distribution toward 0 while keeping the top tail
near 1 — identified as cheap and orthogonal to everything else, not yet
applied.

---

## Depth-in-Core & Sedimentation Rate

**Status: 🔵 Python-prototyped** (ADR-0020)

**Models**: depth below seafloor (mbsf), produced by integrating a
Sedimentation Rate (`probsPrimary`-weighted mixture of a literature
end-member rate per Lithology Class) forward through a core's own history
and compacting the result (Sclater & Christie-style forward integral,
Newton-solved).

**Assumptions**: rate end-member values (Carbonate Ooze 2.65, Siliceous
Ooze 0.6, Clay 0.3 cm/kyr — Rothwell 2005/Hüneke & Mulder 2011 range
midpoints) are flat constants per class, with no room for the real,
order-of-magnitude productivity variation *within* a class. Compaction
constants (density/porosity/decay) adopted from pyBacktrack's literature
table, not its reconstruction pipeline (direction mismatch: SODP needs
forward synthesis, pyBacktrack backtracks from a known present-day
thickness; plate-model mismatch: pyBacktrack bundles Müller 2019, not
Scotese+Seton).

**Validated against**: Straume et al. (2019) GlobSed, 8,062 grid points.
Shape is right (monotonic with Basement Age); magnitude over-predicts ~2.2x
median in the pelagic regime, with a clear spatial signature (gyre centers
over-predicted 2–10x, equatorial/Southern-Ocean upwelling belts
under-predicted) — a missing within-class productivity term, not noise. An
experimental, cross-validated |latitude|-banded rate correction closes most
of the gap on held-out data (median ratio 1.46x→0.99x, log10 r 0.16→0.57)
but is fit against this project's own residual, not an independent source,
and leaves a real basin-specific miss (Pacific 1.71x vs. Atlantic 0.66x
even after correction).

**Known limitations**: not ported to `src/`; GlobSed itself is dominated by
terrigenous sources this model was never scoped to reproduce (restricted
to GlobSed < 1000 m for the comparison above); the "accumulated Hiatus
Risk" hypothesis for the gap was tested directly and found unsupported (no
trend across Basement Age bands).

**Avenues for improvement**: source an independent literature
productivity/rate dataset rather than fitting to this project's own
residual; a basin-aware correction term; decide whether/how the live app's
Sedimentation Rate should ever vary by position (explicitly left for its
own future grilling session); revisit the Hiatus-Risk-as-rate-reducer
question once the base rate model is trusted.

---

## Density & Porosity Physical Property Log

**Status: 🔵 Python-prototyped** (ADR-0020)

**Models**: bulk density and porosity as a function of Depth-in-Core,
`porosity(z) = phi0 * exp(-z/decayM)`, `bulkDensity(z) = porosity(z)*rhoFluid
+ (1-porosity(z))*rhoGrain`, each mixed across Lithology Classes by
`probsPrimary`.

**Assumptions/sources**: pyBacktrack's `primary.txt` constants (Coccolith
ooze / Diatomite / Clay end-members), themselves literature-cited (Kominz
et al. 2011, Sclater & Christie 1980) — adopted as data, not as a
methodology.

**Validated against**: same GlobSed sediment-thickness check as
Sedimentation Rate above (density/porosity and rate are entangled in that
one validation — thickness depends on both).

**Known limitations**: v1 scope is density+porosity only; P-wave velocity
(computable from bulk density via a published empirical relation, e.g.
Erickson & Jarrard) is a deliberately deferred near-term follow-up, not
built.

**Avenues for improvement**: P-wave velocity as the next Physical Property
Log increment (no new data source needed).

---

## Magnetic Susceptibility Physical Property Log

**Status: ⚪ Designed only** (ADR-0021)

**Models (as designed, not yet built)**: `magSusceptibility(z) = (1 -
porosity(z)) * Σ_c probsPrimary[c] * GRAIN_MS[c]` — reuses the density
compaction/mixture engine exactly, substituting grain magnetic
susceptibility for grain density.

**Assumptions**: pore water is magnetically negligible next to grain
susceptibility, so bulk MS scales with solid fraction the same way bulk
density does — physically grounded, not just reused for convenience.

**Known limitations**: `GRAIN_MS` per Lithology Class is **not sourced at
all** — an explicit open TODO, not a placeholder value. No implementation
or validation of any kind exists yet.

**Avenues for improvement**: source real grain magnetic susceptibility
values per Lithology Class from the literature before writing any code.
Magnetostratigraphy (geomagnetic polarity reversals via the published GPTS)
was explicitly split out as a *different*, age-driven, non-compositional
feature and deliberately not designed by this ADR at all — a real future
increment, with a possible tie-in to visualizing Hiatus Risk as a missing
or thinned chron.

---

## Present-Day Sediment Thickness Map

**Status: 🔵 Python-prototyped, offline-only by design** (ADR-0020)

**Models**: the validation milestone for the Sedimentation Rate model
above — present-day total sediment thickness at a global grid of points,
requiring the full through-time reconstruction machinery (unlike the
Present-Day Lithology Map, which never needed reconstruction at all,
because a point's Lithology Class only ever needed today's inputs; total
thickness is a sum over a point's entire age history).

**Method**: a full Python port of SODP's own reconstruction/sampling code
(not pyBacktrack's), run across 8,062 grid points, checked against
Straume et al. (2019) GlobSed.

**Status note**: deliberately not a live app feature — validated once,
offline, per ADR-0020's build-path decision; whether it ever becomes one is
a separate, later decision, contingent on the Sedimentation Rate model
above being trusted first.

*(Results and limitations are the same as the Sedimentation Rate section
above — this map is that model's own validation output, not a separate
thing.)*

---

## Global Climate Reference (time-series viewer feature)

**Status: 🟢 Live** (ADR-0017)

**Models**: global-mean BRIDGE-Valdes OTEMP at two depth levels (surface
proxy, ~5m; "bottom water" proxy, the deepest level BRIDGE-Valdes
simulates, ~5.19km — not true seafloor depth everywhere) across all 109
real frames, precomputed once and shown alongside a queried point's own
temperature history for comparison.

**Assumptions**: this is raw simulated output, not a fitted/calibrated
quantity — it inherits every caveat BRIDGE-Valdes/HadCM3 itself carries as
one model's output, not an independent observational check.

**Known limitations**: none specific to this feature beyond BRIDGE-Valdes's
own general caveats (coarse grid, compressed meridional gradients).

---

## Deliberately out of scope / deferred (not yet started at all)

Recorded so a future reader doesn't mistake silence for an oversight:

- **Erosion** (physical removal of already-deposited section, as opposed
  to a non-depositional pause) — would require `CoreStep`'s age-depth
  geometry to become discontinuous, a structural change ruled out by
  ADR-0019.
- **Event beds** (turbidites, ash, IRD) and **biogenic-producer
  subdivision** (e.g. diatom vs. radiolarian ooze within Siliceous Ooze) —
  named in the original v1 scope, never picked up.
- **Nd isotope basin-mixing proxy** — needs ocean flow-field-derived basin
  mixing, deliberately last in the original deferred list; would share a
  basin-membership-through-time scheme with a future basin-specific CCD
  fix for Phase 2 (see the Lithology Class through-time section above).
- **Terrigenous/margin sediment sources** — SODP's Lithology Class scheme
  is pelagic-only by design; GlobSed's multi-km margin thickness values are
  out of scope, not a gap this project ever meant to close.
- **Real IODP/ODP/DSDP core validation** — deliberately deprioritized from
  the start (plan doc) in favour of the Present-Day Lithology Map's visual
  sanity check; a 5–10 site validation pass was scoped but never run.
- **P-wave velocity** — the next Physical Property Log candidate, needs no
  new data source, just its own increment (ADR-0020).
- **Magnetostratigraphy** — split out from Magnetic Susceptibility, its own
  future increment (ADR-0021).
