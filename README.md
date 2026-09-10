# SODP — Synthetic Ocean Discovery Project

A standalone add-on to [Geode](../Geode): given a present-day ocean (lon,
lat), synthesize a plausible sediment core — an age-depth model, a
Lithology Class through time, Proxy Tracer readings (δ18O, Mg/Ca), and a
Hiatus Risk annotation — from sparse, physically-grounded drivers (basement
age, carbonate compensation depth, real paleo-ocean temperature) rather
than any precomputed database.

**Status: built and live** (Vite + TypeScript, no backend — `npm run dev`).
Both build-order phases (Present-Day Lithology Map, through-time Synthetic
Core) are implemented and validated against real point data, plus two Proxy
Tracers (δ18O, Mg/Ca), a Hiatus Risk annotation, and a global climate
reference viewer. A further increment (Depth-in-Core, Sedimentation Rate,
density/porosity/magnetic-susceptibility Physical Property Logs) is
Python-validated but not yet ported in. See `docs/model-reference.md` for
the current state of every data type this project produces — what's live,
what's validated against what, and what's known to be wrong or missing —
and `docs/plans/sediment-core-simulator.md` for the original design record.
`CONTEXT.md` (domain glossary) and `docs/adr/` (the decisions and the
reasoning behind them) are the source of truth throughout.

Not a fork or a submodule of Geode. It borrows a handful of Geode's `core/`
primitives (rotation, static-polygon plate assignment) as a one-time copy,
and fetches Geode's live hosted archive (BRIDGE-Valdes climate frames,
Scotese rotations/polygons) at runtime — the same pattern Geode's own
`generator/scaffoldRepo.mjs` already uses for its generated standalone
viewer sites. See ADR-0001.
