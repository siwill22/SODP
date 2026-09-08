# SODP — Synthetic Ocean Discovery Project

A standalone add-on to [Geode](../Geode): given a present-day ocean (lon,
lat), synthesize a plausible sediment core — an age-depth model and a
primary lithology class through time — from sparse, physically-grounded
drivers (basement age, carbonate compensation depth, modeled upwelling)
rather than any precomputed database.

**Status: designed, not yet built.** This repo currently holds the design
record from the grilling session that produced it — `CONTEXT.md` (domain
glossary) and `docs/adr/` (the decisions worth a future reader knowing the
reasoning behind). See `docs/plans/sediment-core-simulator.md` for the full
picture and what's left to build.

Not a fork or a submodule of Geode. It borrows a handful of Geode's `core/`
primitives (rotation, static-polygon plate assignment) as a one-time copy,
and fetches Geode's live hosted archive (BRIDGE-Valdes climate frames,
Scotese rotations/polygons) at runtime — the same pattern Geode's own
`generator/scaffoldRepo.mjs` already uses for its generated standalone
viewer sites. See ADR-0001.
