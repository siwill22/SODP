# Hiatus Risk: a preservation-probability annotation, not a modeled unconformity

Requested as "major ocean unconformities" — real stratigraphic surfaces
recording a gap (non-deposition) or removal (erosion) of section. Grilled
down (`/grill-with-docs`, `/domain-modeling`) from that literal framing to
something much smaller and honestly scoped, across a sequence of explicit
design decisions.

## What got scoped out, and why

**Erosion (physical removal of already-deposited section) is out of scope.**
Modeling it for real would mean `CoreStep`/`buildAgeDepthModel()`'s
age-depth relationship becoming discontinuous or non-monotonic — a
structural change to the core geometry itself, for a real stratigraphic
distinction (hiatus vs. erosion) that's usually reported together in real
cores anyway, since the erosional surface *is* the unconformity whether or
not material was actually removed.

**Fitting or validating against real hiatus-occurrence data is out of
scope.** Unlike the Lithology Class classifier (fit against 8,445 real
points, cross-checked against Diesing 2020), no comparable ground-truth
hiatus dataset is sourced in this project, and finding/digitizing one would
be new data-acquisition work on the scale of the CCD Curve's own sourcing
effort (ADR-0005) — explicitly not undertaken here. Decided directly: "no
need to ground-truth against real data... just make sure what we compute is
justifiable given the model we have."

**No threshold, no "major" category.** The model computes a continuous
probability only; where that becomes "major" is a viewer/reader judgment,
never something this project's own code decides.

## Decision

**Hiatus Risk** — a new set of fields on `LithologyLogStep` only
(`syntheticCore.ts::buildLithologyLog()`), Phase 2 only, no change to the
Present-Day Lithology Map (which has no down-core dimension for a
preservation-probability to apply to) and no change to `CoreStep`/
`buildAgeDepthModel()`'s geometry.

1. **`currentErosionRisk`** — real bottom-current speed
   (`sqrt(OCURU^2 + OCURV^2)`, BRIDGE-Valdes's ocean-depth manifest, sampled
   at whichever of the 20 real depth layers is nearest that step's own
   modeled `oceanDepthKm` — NOT a fixed layer, since a Synthetic Core's own
   seafloor depth ranges from ~2.6 km at the ridge crest to ~5.65 km
   asymptotically over its lifetime, and a fixed deep layer would sample
   current speed far from where young crust's sediment actually sits) run
   through three successive calibrations before landing — see "Verified,
   and two real recalibrations mid-flight" below for the full story of why
   each one failed:
   1. An absolute literature critical-erosion-velocity threshold (McCave
      2006's ~10-20 cm/s "sortable silt" winnowing figure, corroborated for
      chalk ooze at 8-20 cm/s) — unreachable by this coarse GCM's own
      resolved speeds (checked against a full sweep of real data).
   2. A logistic centred on this model's own 95th-percentile deep-cell
      speed instead — still practically inert: real clicks kept reading
      ~0 because the handful of cells fast enough to move the needle turn
      out to be unreachable by any real point's actual trajectory (checked
      directly against all 1,485 real candidate points).
   3. **Landed on**: a PERCENTILE RANK, not a threshold at all — reframed
      per explicit instruction ("never mind the absolute values, since the
      model values may be inaccurate... find where \[erosion\] is most
      likely"). `currentErosionRisk` is this cell's speed's rank within
      `CURRENT_SPEED_PERCENTILE_TABLE` (`src/hiatusRisk.ts`), a real,
      31-point percentile table built from every deep-ocean cell (layer>=15,
      ~2.1 km+) across all 109 real Frames (~7.6M samples,
      `show-me/2026-09-09-simplified-classifier-map/percentile_table.mjs`),
      looked up via piecewise-linear interpolation. This sidesteps what
      broke calibrations 1 and 2: it never depends on the model's absolute
      speed being right, only on its RELATIVE structure (which real cells
      are comparatively fast) being physically meaningful even if the
      magnitudes are systematically too small for this coarse a grid —
      and real erosion physics does concentrate wherever flow is locally
      fastest, so ranking is a defensible proxy even without trusting the
      numbers themselves.
2. **`dissolutionRisk`** — a smooth function of `classPrimary`'s own margin
   (`oceanDepthKm - ccdKm`, deeper below the CCD -> higher risk), boosted
   when `divergent` is true. Deliberately reuses `divergent` rather than
   ignoring it: a step where the Published and CO2-Linked CCD Curves
   disagree about which side of the CCD a point falls on is exactly the
   kind of step where real preservation would also be marginal and
   unstable (same underlying uncertainty, not a second independent one) --
   ADR-0005/0009's "diagnostic signal, not averaged away" principle,
   applied here rather than re-litigated. A single field off the primary
   curve, not tiered Published/CO2Linked/Primary like class/probs are --
   `divergent` already carries the two-curve-disagreement signal, so a
   second fully-separate per-curve value would mostly re-derive it.
3. **`hiatusRisk`** — derived convenience field,
   `1 - (1 - currentErosionRisk) * (1 - dissolutionRisk)` (probability at
   least one mechanism applies, treating the two as independent) -- the
   same Primary-on-top-of-full-detail shape `classPrimary`/`probsPrimary`
   already establish: the two named drivers stay separately inspectable
   (this project has consistently refused to silently blend distinct
   diagnostic signals -- ADR-0005, ADR-0015), with one derived number for a
   caller/viewer that just wants one.
4. New 6th viewer panel (`main.ts`), two lines (`currentErosionRisk` solid,
   `dissolutionRisk` dashed, 0-1 axis) -- same "one signal group, one
   panel" pattern as delta18O/Mg/Ca, and keeping both lines visible (not
   just the combined `hiatusRisk`) is the point: seeing *which* mechanism
   drives a spike is why Q2 rejected one blended number in the first place.

## Consequences

- No existing field, curve, or geometry changes -- this is purely additive.
  `oceanDepthKm`, the age-depth trajectory, and the Lithology Class log are
  unaffected by a step's Hiatus Risk; nothing downstream currently reads
  these fields (no gating of Proxy Tracers, no filtering) -- interpretation
  is left entirely to the caller/viewer, consistent with delta18O/Mg/Ca's
  own non-gated treatment (ADR-0016).
- `currentErosionRisk` is a genuinely new, previously-untested BRIDGE-Valdes
  signal (`OCURU`/`OCURV`) -- unlike OVEL/OSAL, it has not been checked for
  any real classification skill, because there is nothing in this project's
  own data to check it against, and (per the two failed calibrations above)
  no longer even claims anything about absolute erosion-relevant speed --
  only a rank within this model's own output. If a real hiatus/erosion
  ground-truth dataset ever becomes available, this is the field most
  likely to need real refitting -- flagged here explicitly so a future
  reader knows this gap is a known one, not an oversight.
- **Flagged directly, not yet acted on**: a percentile-rank transform
  guarantees a roughly uniform spread across [0, 1] by construction (half
  of all real cells rank above the 50th percentile, by definition) -- that
  may overstate how often erosion-driven preservation loss should actually
  be considered likely at a typical point, compared to what's probably a
  genuinely rare real phenomenon. Deliberately not corrected here: the fix
  is cheap and orthogonal to everything else in this file -- a single
  scalar (or a power-law reshaping, e.g. `risk^k` for k>1 to compress the
  bulk of the distribution toward 0 while keeping the top tail near 1) can
  be applied to `currentErosionRisk` alone, `hiatusRisk` alone, or both,
  without touching the percentile table, the layer-fallback search, or
  `dissolutionRisk` -- left as an open, easy-to-apply future tuning knob
  rather than guessed at now.
- `dissolutionRisk` stands on firmer ground: every input (margin, divergent)
  is already a real, derived quantity this project computes and trusts
  elsewhere. Its own honest gap is the same one the Lithology Class rule
  already carries: no literature-sourced functional form for exactly how
  fast preservation risk should rise with margin, just a smooth,
  reasonable-shaped curve (mirrors ADR-0007's own "no literature source
  behind its exact functional form" caveat).

## Verified, and two real recalibrations mid-flight

Implementation checked against real production output
(`show-me/2026-09-09-simplified-classifier-map/verify_hiatus_risk.mjs`):
`hiatusRisk`/`dissolutionRisk`/`currentErosionRisk` all recompute exactly
from their own real inputs, values stay bounded [0, 1], and nearest-layer
selection genuinely varies across a core's lifetime (not silently pinned to
one layer). Decoding itself was separately confirmed against a known-strong
signal: real equatorial-Pacific surface current (layer 0) reads ~0.25 m/s,
matching real published equatorial current speeds.

**Calibration 1 (literature threshold) was, in practice, inert.** After
shipping it, real clicks in the live viewer showed `currentErosionRisk`
always reading ~0 wherever a line was drawn at all. A full sweep of every
deep cell (layer>=12, ~1 km+) across ALL 109 real Frames (~18.5M samples)
found this coarse GCM's own deep-ocean speeds top out around 0.14 m/s at
the 99.9th percentile and 0.26 m/s at the global maximum, an order of
magnitude below where real point current-meter measurements put
erosion-relevant flow (10-20 cm/s) almost everywhere — the literature
threshold was *functionally unreachable* by this dataset, not just usually
inert.

**Calibration 2 (this model's own 95th percentile) was ALSO, in practice,
inert**, for a subtler reason. Real clicks still read ~0-1% almost
everywhere. Checked why: of the "top 15 fastest deep cells" in the entire
real dataset, all but one occur at ages exceeding the real basement-age
archive's own maximum (338.7 Ma) — no surviving crust that old exists, so
those cells were never reachable by any real query regardless of location.
The one candidate young enough (145 Ma) was checked against literally every
real present-day point with basement age >=145 Ma (1,485 candidates, each
rotated to its own real paleoposition at 145 Ma via the same machinery
`buildLithologyLog()` uses) — the closest any of them ever comes to that
cell is 22 degrees (~2,400 km). Not "rare," but **unreachable by any real
point in this application**, a materially different and stronger finding
than what calibration 2 was shipped believing.

**Calibration 3 (percentile rank) is the one that stuck**, prompted by
explicit instruction to stop trusting the model's absolute magnitudes
altogether: "never mind the absolute values, since the model values may be
inaccurate... we know erosion happens, so find where it is most likely."
Re-verified against the same real trajectory that exposed calibrations 1
and 2 as inert: `currentErosionRisk` now spans 0.000-0.723 across one
core's real steps (median 0.25 across a spot-check of several points) --
genuinely informative variation, not a constant floor. Trades away any
claim about absolute erosion-relevant speed (calibrations 1 and 2's shared
failure mode) for a much weaker, more defensible claim: this cell's current
is unusually fast RELATIVE TO this model's own real output. This also
retroactively resolves a plotting-scale red herring raised mid-investigation
(a 0.003-wide real spread on calibration 2 was invisible at ~0.17px on a
0-1 axis) -- moot now that the field's real range spans the full axis by
construction of the percentile transform.

## The gaps: fallback to the nearest VALID layer, not just the nearest one

Separately from calibration, ~47% of steps had `currentErosionRisk`
undefined outright (visible as a discontinuous line, not just a flat one).
Root cause: BRIDGE-Valdes encodes no-data per depth layer -- a real grid
column can be masked at exactly the target layer (that Frame's own
paleobathymetry doesn't reach that deep at that cell) while carrying real,
valid current data one layer shallower or deeper, at the SAME real location
and time. The original `plateFrameAgeSeriesNearestLayer()` picked the
single nearest layer and gave up if THAT one was masked, discarding real
nearby data a Synthetic Core step already has independent grounds (Basement
Age + GDH1) to believe should exist there.

Fixed by replacing the single nearest-layer pick with a full search order
(`depthLayerSearchOrder()`, `src/hiatusRisk.ts`) -- every layer ranked by
proximity to the target depth, tried in that order until one isn't masked
at that real column/Frame (`plateFrameAgeSeriesNearestLayer()`,
`core/queryPoint.ts`), same zero-extra-network-cost property as before
(every layer for a Frame is already in the bytes `cache.get()` returns).
Only returns no-data if EVERY real layer is masked at that column -- a
genuine total absence, not a near-miss. Re-verified: 0/56 steps undefined
across a 4-point spot-check, down from 47% on one representative core.
