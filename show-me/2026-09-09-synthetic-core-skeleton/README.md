# Phase 2 Synthetic Core skeleton -- first eye-check (2026-09-09)

The first visual check of `src/syntheticCore.ts`'s real output -- trajectory
(`buildAgeDepthModel`), down-core Lithology Class log (`buildLithologyLog`),
and the CCD-through-time cross-check (ADR-0009) -- against a point chosen
for geological interest, not just to exercise the machinery. ADR-0009's own
"Consequences" section named this exact gap: the two points tested while
building the skeleton (old Western Atlantic, old equatorial Pacific) were
picked to test the code, not to look at anything interesting; this is that
missing validation pass.

**Point selection was itself checked, not assumed**: `explore_candidates.mjs`
scanned 8 real points across the Pacific for one with multiple Lithology
Classes and real CCD-curve divergence in its log, rather than picking
one and hoping. (-150, 15) — 85.33 Ma Basement Age — won on both counts (3
classes, 3 divergent steps) and also turned out to tell the textbook
pelagic-sedimentation story: formed near the equatorial upwelling band,
drifted north into the oligotrophic gyre as it aged.

## Lead finding: the skeleton reproduces the textbook story, and the CCD divergence is real and visible, not a corner case

All three figures agree with each other and with known Pacific plate
motion and pelagic sedimentation theory -- nothing here contradicts the
design decisions made while building Phase 2. The one thing worth flagging
rather than silently passing over: the single `siliceous-ooze` hit at 15
Ma (figure 2/3) sits on an OVEL value of essentially zero (+0.000002
cm/s) -- a real value, not a bug, but a reminder that ADR-0007's
zero-parameter sign threshold has no margin at all, consistent with the
"too dominated by upwelling/downwelling" finding from the Present-Day
Lithology Map investigation. This down-core log is the first place that
threshold's sensitivity shows up as a single-step flip rather than a
whole-basin proportion.

## Figures

1. **`01-paleo-trajectory.png`** -- claim: the reconstructed path is
   plausible plate motion, not noise. Robinson-style Mercator panel,
   Pacific region, real coastlines (Central America, Hawaiian-Emperor
   chain visible for context). Points are the point's own paleoposition
   at each 1 Ma step of `buildAgeDepthModel`, coloured by age (Ma,
   viridis, reversed so young=yellow/present). Shows a smooth, single-
   direction drift from formation (8.1°S, 105.6°W, near the East Pacific
   Rise) to today (15°N, 150°W) -- consistent with real Pacific plate
   motion (net northwestward drift over this time span), not a jagged or
   reversing path that would indicate a rotation-table artifact.

2. **`02-down-core-log.png`** -- claim: the log shows real class variation
   and real CCD-curve divergence, not one flat class or two curves that
   always agree. X-axis: age (Ma before present, 0-85.3). Y-axis: depth
   (km), inverted (deeper = lower, matching a real down-core sense).
   Black line: GDH1 depth from the finer 1 Ma trajectory model. Dashed/
   dotted magenta: Published/CO2-Linked CCD curves at this point's own
   ages. Coloured dots: `classPrimary` at each of the 17 real OVEL-frame
   steps (blue=Clay, gold=Carbonate Ooze, green=Siliceous Ooze); shaded
   vertical bands repeat the same colouring between steps. Red X: the 3
   steps (69, 75, 81 Ma) where Published and CO2-Linked disagree on the
   class outright, not just the CCD value -- at 81 Ma, Published CCD
   (3.19 km) puts the point below the CCD (Siliceous Ooze) while
   CO2-Linked (4.03 km) puts it above (Carbonate Ooze), a real
   classification-level disagreement, not a rounding difference. Shows
   the two CCD curves are visibly noisy relative to each other across
   this age range (crossing twice), not just offset by a constant -- the
   divergence flag is doing real work here, not flagging a corner case.

3. **`03-ovel-through-time.png`** -- claim: the class transitions in
   figure 2 track a real productivity signal, not an artifact. OVEL
   (cm/s) at this point's own paleoposition, one point per real BRIDGE-
   Valdes frame. Positive/upwelling shaded red, negative/downwelling
   shaded blue. Shows strong upwelling from formation to ~65 Ma
   (consistent with forming near the equatorial divergence), a clear
   swing to strongly negative (peak downwelling at 56 Ma, -0.0003 cm/s)
   as the point drifts north through the subtropics, then a long
   near-zero/weakly-negative tail to present as it settles into the
   gyre -- this is the physical driver behind figure 2's Siliceous
   Ooze-to-Clay transition, shown independently rather than just
   asserted from the class colours.

## Follow-up: does the story generalize, or was (-150, 15) a lucky pick?

Three more points from `explore_candidates.mjs`'s own scan, computed by
`compute_more_points.mjs`, chosen for contrast rather than to keep looking
good: N Pacific old crust A (bigger latitude range, 1 divergent step), NW
Pacific/"Emperor-ish" (all 3 classes, 0 divergent), and W Pacific old
crust (deliberately included as the "boring" case — only 2 classes, 0
divergent — not dropped for being unremarkable).

**Caught and fixed before reporting, not after**: the first version of
figure 4 used a naive map region (`-180` to `-95`) that doesn't cover two
of these four points at all — checked directly, both the Emperor-ish and
W Pacific trajectories cross the antimeridian (raw longitude range
essentially -180 to +180). The region silently clipped them, and the
W Pacific path rendered as a short, meaningless fragment near the date
line — not the real trajectory. Fixed by unwrapping each trajectory's own
longitude sequence into a continuous 0-360 frame before plotting and
widening the region to `[100, 280]` (0-360 convention) to cover all four
paths. The corrected W Pacific path is dramatically different from the
broken one: it actually starts near 40°S/175°E (close to present-day New
Zealand) and drifts the full ~48° to 10°N/150°E over 161 Myr — the
longest, most dramatic path of the four, not the shortest.

4. **`04-four-trajectories.png`** — claim: the (-150,15) trajectory's
   plausibility generalizes, these aren't four versions of the same path
   or four different kinds of noise. Pacific-centred Mercator panel (0-360
   longitude convention, region 100°E-100°W), real coastlines. Each
   point's own colour, square=today, star=formation, labelled with
   Basement Age. All four are smooth, single-direction, non-repeating
   paths; the NW Pacific (green) path shows a directional bend around
   40-50 Ma consistent with the real, independently well-documented
   Hawaiian-Emperor bend in Pacific absolute plate motion — not asserted
   here, just consistent with it, worth an actual literature check if this
   becomes load-bearing later.

5. **`05-four-down-core-logs.png`** — claim: real class variation and CCD
   divergence aren't unique to the first point, but also aren't universal.
   Same layout as figure 2, stacked as four panels sharing both axes
   (depth 2.4-5.7 km, age 0-161 Ma) so the panels are directly comparable,
   not just individually plausible. Shows a real range of outcomes: 3
   divergent steps (original point) down to 0 (Emperor-ish, W Pacific);
   3 classes down to 2 (W Pacific never leaves Clay/Siliceous-Ooze — its
   OVEL history, not shown here, apparently never goes strongly enough
   positive to cross into Carbonate territory, consistent with it also
   having the least dramatic divergence). The W Pacific panel is the
   "null result" of this set, shown as computed rather than dropped for
   being uninteresting.

## Follow-up: Atlantic, younger/shallower crust

Three young Atlantic points (18-21 Ma, `explore_atlantic.mjs`'s scan of 11
candidates across South/equatorial/North Atlantic, `compute_atlantic_points.mjs`)
— the deliberate opposite case from the old, deep Pacific points above:
does the model behave sensibly for crust that never gets anywhere near
the CCD?

**Confirmed, not assumed: Siliceous Ooze never appears in any of the 11
scanned Atlantic candidates, young or the 3 taken to full figures.**
GDH1 depth for 18-21 Ma crust tops out around 4.2-4.3 km; both CCD curves
sit at 4.52-4.66 km over this age range (annotated directly on each panel
of figure 7, not left for the eye to guess at the barely-visible dashed
lines in the corner) — every point stays above the CCD its entire life,
so the rule can only ever produce Carbonate Ooze or Clay, decided purely
by OVEL sign. That's exactly what the rule should do given real Atlantic
CCD is if anything even deeper still (~5.0 km per ADR-0008's per-basin
value, though Phase 2's `buildLithologyLog` uses the single GLOBAL CCD
curve, not that per-basin figure — a real inconsistency between Phase 1
and Phase 2 worth flagging, not fixed here: Phase 1's basin-specific CCD
fix was never carried into Phase 2's through-time query).

6. **`06-atlantic-trajectories.png`** — same claim/format as figure 4, for
   the 3 Atlantic points. Short paths (18-21 Ma, not 85-161 Ma) — South
   Atlantic and North Atlantic points barely drift (~1-2° over 20 Myr,
   consistent with sitting close to their own ridge-flank spreading
   trajectory rather than a fast-moving hotspot track); equatorial point
   drifts west along the equator, consistent with South American plate
   motion opening the equatorial Atlantic.

7. **`07-atlantic-down-core-logs.png`** — same claim/format as figure 5,
   shared depth axis 2.4-4.6 km (much shallower range than figure 5's
   2.4-5.7 km, since these points never subside far). South Atlantic and
   equatorial Atlantic both show a Clay-to-Carbonate transition as OVEL
   crosses from negative to positive approaching the present; North
   Atlantic (50°N) stays Carbonate throughout, OVEL weakly positive the
   whole 20 Myr. All three transitions sit on an OVEL value within about
   0.00003 cm/s of zero — the same zero-margin sensitivity flagged in the
   Pacific set and, earlier, in the Present-Day Lithology Map investigation.

## What these figures do not show

No comparison against a real IODP/ODP/DSDP core at or near this location
-- still deliberately deprioritized per the plan doc. The `classPrimary`
convenience field (Published-preferred) is what figure 2's dots use;
figure 2's red X marks are the only place `classCo2Linked` disagreeing is
visible at all -- a future down-core UI would need to decide how much of
that disagreement to surface routinely, per ADR-0009's own open point.
Only one point was taken all the way to figures; `explore_candidates.mjs`'s
own scan output (in this session, not saved as a file) shows several other
candidates with similarly rich histories worth a second look if one
example isn't convincing enough on its own.

## Reproducing

```
cd show-me/2026-09-09-synthetic-core-skeleton
npx tsx explore_candidates.mjs          # scans candidates, prints a ranking (no file output)
npx tsx inspect_winner.mjs              # writes winner_log.json for the chosen point
conda run -n pygmt17 python make_figures.py       # figures 1-3

npx tsx compute_more_points.mjs         # writes more_points_log.json for 3 more points
conda run -n pygmt17 python make_more_figures.py  # figures 4-5

npx tsx explore_atlantic.mjs             # scans Atlantic candidates, prints a ranking (no file output)
npx tsx compute_atlantic_points.mjs      # writes atlantic_points_log.json for 3 Atlantic points
conda run -n pygmt17 python make_atlantic_figures.py  # figures 6-7
```

All point lists are hardcoded; edit them directly to scan a different
region or basement-age range.
