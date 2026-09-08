# Lithology Class is three-way (Carbonate Ooze / Siliceous Ooze / Clay), depth comes from GDH1, productivity threshold is the sign of OVEL

Two things this project's own documents disagreed with each other about,
resolved together here because the second decision only makes sense once
the first is settled.

## Two classes or three

CONTEXT.md's original Lithology Class entry said v1 is not "subdivided by
biogenic producer (e.g. calcareous vs. siliceous ooze)" — implying two
classes, Carbonate Ooze vs. Clay. The plan doc's own Present-Day Lithology
Map validation section asked the eye-check to confirm "siliceous ooze under
the Southern Ocean / equatorial Pacific divergence" as a distinct pattern —
which only means anything if siliceous ooze is a class the map can actually
paint. The two documents contradicted each other; caught directly while
implementing the classification rule, not assumed away.

**Decision: three classes.** Opal (silica) preservation is not gated by the
CCD at all — it is a different chemical system from carbonate entirely. A
high-productivity point below the CCD (the Southern Ocean's own case) is
real siliceous ooze, not clay, regardless of carbonate dissolution. A
two-class rule has no way to express that outcome; it would paint the
Southern Ocean the same as an oligotrophic gyre center with nothing being
produced at all, which fails the plan doc's own validation target. Decided
directly with the project owner (2026-09-08) rather than silently picked
from the ambiguous prose.

## Depth: GDH1 (Stein & Stein 1992)

> **Amended by ADR-0008 (2026-09-09):** GDH1 remains the depth model below,
> and is still correct for Phase 2's through-time query. For the
> Present-Day Lithology Map specifically, depth now comes from real
> bathymetry instead — GDH1 turned out to be a significant source of error
> for a map that had an observed answer available. See ADR-0008.

Comparing a point against the CCD Curve needs actual water depth, not
Basement Age itself — a real, previously-undiscussed data need, resolved
without a new external dataset: ocean depth is a well-established empirical
function of Basement Age alone (thermal subsidence), so no bathymetry grid
is needed, consistent with this project's "sparse, physically-grounded
drivers, not a precomputed database" framing (README).

**Decision: GDH1** (Stein & Stein 1992) over the older Parsons & Sclater
(1977) curve — fit to a larger heat-flow-and-depth dataset, the current
standard in plate-tectonic reconstruction work generally.

```
d(t) = 2600 + 365*sqrt(t)                  t <= 20 Ma
d(t) = 5651 - 2473*exp(-0.0278*t)          t > 20 Ma
```
(`d` in metres, `t` in Myr.)

## Productivity threshold: the sign of OVEL, not a magnitude cutoff

CONTEXT.md's Productivity Signal entry already frames the distinction this
needs to make as "an oligotrophic gyre center from an upwelling zone" —
gyre centers are Ekman-driven downwelling (OVEL negative); the equatorial
divergence, coastal upwelling, and the Southern Ocean divergence are
upwelling (OVEL positive) by the same physics CONTEXT.md already names.

**Decision: `OVEL > 0` is the entire productivity threshold** — no
magnitude cutoff chosen or tuned. This is a zero-parameter rule with a
direct physical reading (production happens where water is upwelling into
the photic zone; it does not where it's being pumped down), rather than an
arbitrary cm/s value that would need justifying on its own and would be the
one truly unconstrained free parameter in the whole system.

## The rule

```
if OVEL <= 0:                    Clay        (nothing being produced)
elif oceanDepth < CCD:           Carbonate Ooze  (produced AND preserved)
else:                            Siliceous Ooze  (produced, carbonate dissolved, opal survives)
```

Present-Day Lithology Map v1 always uses TODAY's CCD Curve value (age = 0),
never a historical one, per ADR-0006 — Basement Age here is used only to
derive present ocean depth via GDH1, not to look up a CCD value at the
crust's formation age. The Published CCD Curve's real value (Pälike, 4.65
km) is used as the primary CCD input for this map, not an average with the
CO2-Linked Curve — the two agree closely at age 0 (4.65 vs 4.687 km) so this
doesn't currently change any classification, but ADR-0005's "surface
divergence, don't average" principle should still govern once the
through-time query (which needs CCD at ages where the two curves diverge
more) is built. **Resolved in ADR-0009**: the through-time query carries
both curves at every step and flags disagreement rather than picking one.

## Consequences

- This is the one piece of domain logic in the whole project without a
  literature source behind its exact functional form (unlike the CCD
  curves or the CO2 compilation) — it is this project's own synthesis rule,
  and the Present-Day Lithology Map's eye-validation (ADR-0006) is the only
  check it gets before the through-time query builds on top of it.
- If the eye-check shows the OVEL-sign threshold is too strict or too loose
  (e.g. real oligotrophic-but-weakly-upwelling regions painting as
  productive, or vice versa), revisit this ADR before tuning a magnitude
  cutoff in code with no record of why.
