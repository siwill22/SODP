# Anchor the Synthetic Core's own ageMa=0 step to the map's real bathymetry + basin CCD

Reported directly: clicking a map pixel can hand back a Synthetic Core
whose own "today" (ageMa=0) log step disagrees with the map pixel that was
clicked -- e.g. (4.5, -1.0), 89.3 Ma Atlantic crust, mapped as
carbonate-ooze but logged as clay at ageMa=0. ADR-0008 already named this
exact gap in its own Consequences section ("If Phase 2 eventually wants a
present-day anchor point for its own reconstruction... that is a new
design question, not decided here") without deciding it. This ADR decides
it.

## Diagnosis

Checked directly against the real archive data and a live Geode fetch at
(4.5, -1.0), not assumed:

| Input | Present-Day Map (ADR-0008) | Synthetic Core's ageMa=0 step (pre-fix) |
|---|---:|---:|
| Ocean depth | 4.014 km (real bathymetry) | 5.445 km (GDH1 at crustal age 89.3 Ma) |
| CCD | 5.00 km (Atlantic basin CCD) | 4.65 km (global Published Curve, age=0) |
| OTEMP | 28.2°C (same live frame either way) | 28.2°C |
| depth − CCD margin | **−0.99 km** (above CCD) | **+0.79 km** (below CCD) |
| classifier result | **carbonate-ooze** (78%) | **clay** (66%) |

The margin sign itself flips. `buildLithologyLog()` (`src/syntheticCore.ts`)
always used `ageToDepthKm()`/GDH1 and the two modeled CCD curves at every
step, including ageMa=0, because that is the only real inputs available
for Phase 2's own claimed use case: reconstructing depth at ages with no
directly observed answer. But ageMa=0 is not such an age -- a real,
directly observed depth and CCD already exist for it, and the Present-Day
Lithology Map already uses them (ADR-0008). Using GDH1 there instead is not
a case of missing data, it's declining to use data that is already loaded.

GDH1's own lack of dynamic topography/sediment-loading/hotspot-swell
correction (ADR-0007/0008) is large enough at this point (1.4 km) to flip
which side of the CCD the cell falls on by itself; the global-vs-basin CCD
gap (0.35 km here) compounds it in the same direction. Both were already
known, named limitations (ADR-0008) -- what was new here is that they can
combine at a single real point to flip the winning class entirely, and a
user clicking that exact point sees the contradiction immediately.

## Decision

`buildLithologyLog()` gains an optional `presentDayAnchor: { oceanDepthKm,
ccdKm }` parameter. When provided, the `sample.age === 0` step alone uses
`anchor.oceanDepthKm` in place of `ageToDepthKm(crustalAgeMa)`, and
`anchor.ccdKm` in place of *both* `ccdKmAt(publishedCurve, 0)` and
`ccdKmAt(co2LinkedCurve, 0)` -- a real, directly-observed present-day cell
has one CCD, not two competing modeled curves, so `classPublished` and
`classCo2Linked` are equal by construction there and `divergent` is
naturally `false`, which is the correct answer for an observed step, not a
special case. Every step at `ageMa > 0` is completely unchanged: GDH1 and
both modeled CCD curves remain the only way to answer "what was it like
back then," exactly as ADR-0008 left them.

`presentDayMap.ts` exposes the anchor as `presentDayCellInputs(inputs,
idx)`, factored out of `buildPresentDayGrid()`'s own per-cell loop (which
now calls it too) so the map and the anchor are provably the same lookup,
not two independent implementations that could drift apart later. `main.ts`
calls it with the same `idx` the click handler already computed to read
Basement Age, and passes the result into both `buildLithologyLog()` calls
(fitted and belt variants).

## Consequences

- **The Synthetic Core's ageMa=0 step and the map pixel it was clicked from
  now always classify identically** -- verified directly (not just
  reasoned about) for (4.5, -1.0): pre-fix ageMa=0 gave clay, post-fix
  gives carbonate-ooze, matching the map exactly.
- **`buildAgeDepthModel()` (the smooth GDH1 trajectory used for drift
  distance and the depth-panel's reference curve) is untouched** -- it
  stays pure GDH1 geometry by design (its own doc comment), so the
  depth-vs-age chart will now show the ageMa=0 data point sitting off the
  smooth GDH1 curve at whatever real point clicked. That's the anchor
  effect being visible, not a bug.
- **Every step older than ageMa=0 is unaffected.** This does not reduce or
  resolve GDH1's real, general disagreement with observed depth at any
  other age -- there is no observed depth at any other age to anchor to.
  A user can still see a GDH1 vs. reality gap widen smoothly moving away
  from ageMa=0 on the depth panel; that gap is real and this ADR does not
  hide it, it only removes the one age (0) where hiding it was never
  necessary in the first place.
