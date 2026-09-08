# The through-time Synthetic Core carries both CCD curves at every step, rather than picking one

ADR-0005 built the CCD Curve two ways in parallel (Published, digitized-literature; CO2-Linked, derived from
Foster et al. 2017 CO2 through an empirical regression) specifically so
they could be cross-checked, "not averaged away." ADR-0007 used only the
age=0 value for the Present-Day Lithology Map, where the two happen to
agree closely (4.65 vs. 4.687 km), and explicitly left open how the
cross-check should behave once a real through-time query needed CCD at
ages where they might not agree. Phase 2 (`src/syntheticCore.ts`) is that
query.

## The two curves are not a free choice at every age

Checked before deciding anything: the Published CCD Curve only covers
0-140 Ma (`archive/ccd/published_ccd_curve.json`); the CO2-Linked Curve
covers 0-419.5 Ma (`archive/ccd/co2_linked_ccd_curve.json`, the Foster
compilation's own range). Past 140 Ma, there is no Published value to
choose between — only CO2-Linked has anything to offer. "Pick one curve
globally" was never really available as a simpler option; any design has
to handle the two curves having different coverage, not just different
values.

Within the 0-140 Ma overlap, the two genuinely diverge, not just in
principle: mean absolute difference 0.42 km, max 1.69 km (at age 70 Ma —
close to the known Published-Curve real/digitized tier discontinuity near
74-75 Ma, already flagged and accepted in the CCD-curves show-me
investigation; not a new problem, but confirmation the divergence check
below surfaces exactly that kind of disagreement rather than hiding it).
1.69 km is large enough to flip a classification outright — confirmed
directly: at age 70, Published CCD = 2.95 km vs. CO2-Linked = 4.64 km; a
depth of 3.80 km (deliberately chosen between them) with positive OVEL
classifies as Siliceous Ooze under Published and Carbonate Ooze under
CO2-Linked.

## Decision: carry both curves through every step, flag disagreement, never average

`src/ccdCurve.ts`'s `ccdKmAt()` looks up either curve at a given age by
linear interpolation, returning `undefined` outside that curve's own
covered range — never extrapolated. `src/syntheticCore.ts`'s
`buildLithologyLog()` classifies each step against BOTH curves
independently (`classPublished`, `classCo2Linked`), sets `divergent: true`
only when both are defined and disagree, and exposes a single convenience
`classPrimary` (Published where available, else CO2-Linked — the same
"real data preferred over modeled" tiering `prep_ccd.py` already uses
building the Published Curve itself) for a caller that just wants one
answer.

This is ADR-0005's own principle, not a new one — extended from a design
intent that had nothing to bite on at age=0 (Phase 1) to something
actually load-bearing now that Phase 2 queries ages where the two curves
disagree by over a kilometre.

## Consequence found while verifying this: divergence is real but gets suppressed by the OVEL-sign issue

Tested against two real points end-to-end (an old Western Atlantic point,
137 Ma, and an old equatorial Pacific point, 127 Ma) — zero divergent steps
in either real down-core log, despite both curves disagreeing by up to
1.69 km somewhere in that age range. Traced directly, not assumed: at
every age where the two curves diverge enough to matter, `classifyLithology()`'s
`OVEL<=0 -> Clay` check (ADR-0007) fires first and returns Clay before the
CCD comparison is ever reached, on both real test points. Divergence can
only surface at a step where OVEL is positive AND depth sits between the
two curves' values at that age — confirmed possible (see the age-70
example above), just apparently rare among the points checked so far. This
is a real interaction between two already-documented open issues (the
OVEL-sign dominance flagged in the Present-Day Lithology Map investigation,
and this ADR's own CCD divergence), not a new one — noted here rather than
chased further, since resolving the OVEL-sign issue was already left open
pending further investigation.

## Consequences

- `classifyLithology()` itself (ADR-0007) is unchanged. Both fixes in this
  project so far (ADR-0008's real bathymetry/basin CCD, and this ADR) have
  been to what feeds the rule, not the rule itself.
- A future UI showing a down-core log should surface `divergent` visibly
  (not just `classPrimary`) — collapsing to one answer without showing
  when the two curves disagree would quietly undo the whole point of
  ADR-0005's cross-check design.
- Not yet built: a real eye-check of a full down-core log against a point
  with a geologically interesting history (e.g. one that crosses the CCD
  going deeper with age, or drifts through a paleo-upwelling zone) — the
  two test points used here were chosen to exercise the machinery
  (movement, mixed OVEL sign, curve coverage boundaries), not chosen for
  geological interest. That validation pass is still open.
