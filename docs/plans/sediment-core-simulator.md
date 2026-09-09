# Synthetic Core

**Status: both build-order phases below are built and validated** (Present-
Day Lithology Map: ADR-0006/0007/0008/0011/0012/0013; through-time
Synthetic Core: ADR-0009, also now on ADR-0011/0012/0013's classifier).
The rest of this doc is largely the original design record from a grilling
session (2026-09-08); driver details below (esp. Productivity Signal) have
since changed in ways the ADRs record but this doc doesn't fully reflect
line-by-line — treat the ADRs as authoritative where they disagree with
prose here. See `CONTEXT.md` for the terms used here and `docs/adr/` for
the reasoning behind the decisions marked below.

## What it is

Given a present-day (lon, lat) on the ocean floor, produce a Synthetic
Core: an age-depth model paired with a Lithology Class at each point
down-core, inferred on the fly from sparse physical drivers rather than
read from any precomputed database. Point-and-click, not batch.

## Why a separate repo

Originally brainstormed as a Geode feature; decided instead to build as a
standalone add-on borrowing Geode's `core/` primitives and live archive,
mirroring how `generator/scaffoldRepo.mjs` already produces standalone
deployable sites from Geode's catalog. See ADR-0001.

## The drivers, and where each comes from

- **Basement Age** — Seton et al. (2020) seafloor age grid, present-day
  lookup only, resampled once into a static web grid (ADR-0004).
- **Plate trajectory / assignment** — Scotese (an oceanic-inclusive
  static-polygon resource still needs sourcing; the one currently in
  Geode's archive is continental-only). Deliberately paired with the
  differently-sourced Seton grid above, scoped to Preserved Crust only
  (ADR-0002) — this is the single most important piece of reasoning in
  this repo for a future reader to have, since it looks like a mistake if
  you don't already know why.
- **CCD Curve** — two independent sources cross-checked against each
  other: a digitized literature compilation, and the Foster et al. (2017)
  CO2 curve run through an empirical CO2-to-CCD relationship (ADR-0005).
  Global only in v1, no basin differentiation.
- **Productivity Signal** — originally `OVEL` (modeled vertical velocity,
  upwelling-positive) from BRIDGE-Valdes's ocean-depth data; ADR-0012
  dropped it (no measurable classification skill once OTEMP was included,
  checked against 8,445 real points) in favour of `OTEMP` (ocean
  temperature) alone, with an optional equal second option (ADR-0013)
  layering a Diesing-informed equatorial adjustment on top. See
  CONTEXT.md's Productivity Signal entry.
- **Climate Driver** — BRIDGE-Valdes only
  (`bridge-valdes2021-monthly` + `bridge-valdes2021-ocean-depth`); every
  other climate Model in Geode's archive lacks any ocean field at all
  (ADR-0003).

## v1 scope

Lithology Class only, driven by depth relative to the CCD Curve and the
Productivity Signal. No Proxy Tracers, no event beds (turbidites, ash,
IRD), no biogenic-producer subdivision (calcareous vs. siliceous ooze).

**Deferred, in rough order:**
1. δ18O / Mg/Ca — fall out of temperature data BRIDGE-Valdes already
   carries, no new data source needed. That prerequisite is now doubly
   true: OTEMP is already fetched and used per-step by both maps
   (ADR-0011/0012), real paleo-OTEMP, not a proxy — the natural next
   increment.
2. Basin-specific CCD, sharing a basin-membership-through-time scheme with
   the item below rather than building it twice.
3. Nd isotope basin-mixing proxy — the hardest, least-validated piece,
   deliberately last. Needs ocean flow-field-derived basin mixing, not
   just a per-point read.
4. Everything else from the original brainstorm not listed above (dust,
   IRD, turbidites, bottom-current scour/winnowing, redox proxies,
   bioturbation mixing, compaction) — not scheduled, not ruled out.

## Build order

1. **Present-Day Lithology Map** — no reconstruction, no time integration:
   today's Basement Age, CCD Curve, and Productivity Signal only, painted
   across the whole present-day ocean. Validated by eye against the
   well-known modern deep-sea sediment distribution (carbonate ooze belts
   along ridges and equatorial upwelling, red clay in oligotrophic gyre
   centers, siliceous ooze under the Southern Ocean / equatorial Pacific
   divergence). This isolates the genuinely new, unvalidated logic (the
   CCD/productivity → lithology rule) from machinery Geode already trusts.
2. **Single-point, through-time Synthetic Core** — once (1) looks right,
   add the trajectory (Scotese plate assignment + rotation, mirroring
   Geode's Plate-Frame Point) and the CCD Curve's own time axis on top.

No caching in either stage for v1 — recompute fresh per query; v1's
synthesis is cheap enough that this isn't expected to matter, revisit only
if real usage shows otherwise.

**Validation is a visual sanity check, by design, not a comparison against
real IODP/ODP/DSDP cores.** A real-core validation pass was scoped (5-10
diverse sites — CCD-crossing history, persistently above-CCD, upwelling,
oligotrophic gyre) but explicitly deprioritized in favour of the
Present-Day Lithology Map check above.

## Open practical TODOs

- Source an oceanic-inclusive Scotese-family static-polygon resource (the
  one in Geode's archive today is continental-only, 245 polygons).
- Identify and digitize the Published CCD Curve compilation (none chosen
  yet).
- Find/derive the empirical CO2-to-CCD relationship for the CO2-Linked CCD
  Curve.
- Obtain the Seton et al. (2020) grid itself and write the resampling prep
  step (mirroring Geode's `prep_*.py` → `Volume` convention).
- Decide and set up this repo's actual build tooling (framework, deploy
  target) — not yet grilled, deliberately left for whichever session
  starts implementation.
