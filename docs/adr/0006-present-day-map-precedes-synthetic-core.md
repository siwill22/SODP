# Present-Day Lithology Map is built and validated before the single-point Synthetic Core

CONTEXT.md's Present-Day Lithology Map entry and the plan doc's build order
both already stated this decision in prose; this ADR is the record a future
reader following CONTEXT.md's own cross-reference expects to find.

The CCD/Productivity-Signal → Lithology Class rule (ADR-0007) is the one
genuinely new, unvalidated piece of domain logic in this whole project.
Everything else in v1 — reading Basement Age, fetching BRIDGE-Valdes,
Scotese plate assignment and rotation — is machinery Geode already trusts
(ADR-0001) or a literature-sourced curve cross-checked against itself
(ADR-0005).

**Decision: build and eye-validate the lithology rule with NO reconstruction
in the loop at all first.** Present-Day Lithology Map v1 uses only today's
Basement Age, today's CCD Curve value, and today's Productivity Signal —
painted across the whole present-day ocean, checked by eye against the
well-known modern deep-sea sediment distribution (carbonate ooze belts
along ridges and equatorial upwelling, red clay in oligotrophic gyre
centers, siliceous ooze under the Southern Ocean / equatorial Pacific
divergence). Only once that looks right does the single-point, through-time
Synthetic Core add the trajectory (Scotese plate assignment + rotation) and
the CCD Curve's own time axis on top.

**Why this ordering, not the reverse.** Building the through-time query
first would mean debugging two unvalidated things at once whenever a point
looked wrong: is the lithology rule itself broken, or is the plate
trajectory feeding it a bad position/age? The present-day map has no
trajectory in it at all, so a wrong answer there can only mean the rule is
wrong — the fastest possible feedback loop for the one piece of this system
that's actually new.

## Consequences

- The Present-Day Lithology Map's validation is a visual sanity check
  against well-known present-day sediment patterns, not a comparison
  against real IODP/ODP/DSDP core data — see the plan doc for why that
  comparison was deliberately deprioritized.
- Any future change to the classification rule (ADR-0007) should be
  re-validated at this present-day-only stage first, before touching the
  through-time query — the same reasoning that motivated building it this
  way in the first place.
