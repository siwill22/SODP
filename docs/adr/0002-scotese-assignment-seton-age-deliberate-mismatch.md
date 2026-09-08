# Plate assignment uses Scotese; basement age uses Seton et al. (2020) — a deliberate provenance mismatch

Geode's own ADR-0004 establishes strict single-provenance discipline:
pairing a rotation file from one Reconstruction Model with geometry from
another silently mis-places continents by hundreds of km, so a Model must
never mix sources. Read literally, that discipline blocks SODP outright:
Scotese — the only Reconstruction Model with a viable plate-assignment path
this project can build on (Müller 2019/Seton 2012 have oceanic static
polygons but no attached climate data; Scotese has neither an oceanic
static-polygon resource in Geode's archive today nor, per Geode's own
ADR-0019, any topological ocean-plate model at all beyond continents rotated
absolutely) has no relationship whatsoever to the Seton et al. (2020)
seafloor age grid's own rotation lineage.

**Decision: pair them anyway, deliberately, scoped to Preserved Crust
only.** Every SODP query starts from a present-day (lon, lat) — by
construction, always a point on crust that survives, unsubducted, to today.
For that specific population, Scotese's reconstructed plate motion and the
Seton grid's own age determination are close enough at present day for this
project's purposes, even though the two disagree on deeper-time position in
general the way ADR-0004 warns about. This is a scientific judgement call
made deliberately by a domain expert for this specific, narrow case — not a
gap that was missed, and not a precedent for relaxing provenance discipline
anywhere else, in either this repo or Geode's own.

**Basement age is read as a plain present-day lookup, never rotated.** The
Seton grid answers "how old is the crust at this point, today" directly;
SODP never asks it "where was this point at 50 Ma" — that question is
answered by Scotese's own rotation instead. The two data sources are never
combined in a single rotation calculation, only used side by side for two
different questions about the same point.

**Scotese's currently-exported static polygons cannot support this on their
own.** They are continental-only (245 polygons, per Geode's ADR-0025/0026);
an oceanic-inclusive Scotese-family static-polygon resource is a real,
outstanding data dependency, not yet sourced.

## Corollary, found while building Phase 2 (2026-09-09): the static polygon's own age fields are unused too

Not just the rotation lineage — the static polygon's own `FROMAGE`/`TOAGE`
attributes play no role in this project either. The polygon supplies the
present-day plate ID via spatial containment, full stop; how far back a
point's history goes is answered entirely by its Basement Age (Seton et
al. 2020), already established above. This matters in code, not just
principle: the ported `assignPlate()`/`positionAt()` logic (Geode's own,
ADR-0001, un-renamed) was built against Müller et al. (2019)'s oceanic
static polygons, where a polygon's own begin age genuinely *is* a
geological formation age (isochron-zoned), and uses it to gate how far
back `positionAt()` will rotate a point. Reusing that gate unmodified with
Scotese/PALEOMAP's polygons is wrong — confirmed directly, not assumed:
PALEOMAP's `FROMAGE`/`TOAGE` shapefile fields are a degenerate `0`/`0` for
39% of polygons (196 of 503 exported), and even where non-zero, encode the
source shapefile's own digitizing/rendering-relevance window, not a
formation age. Left in place, it silently truncated `buildAgeDepthModel()`
(`src/syntheticCore.ts`) to a single step for any point landing on a
degenerate polygon, regardless of how old that point's real Basement Age
was — caught immediately by the Phase 2 skeleton's own smoke test, not by
inspection.

**Fix:** `createUnboundedPlateFramePoint()` (`src/syntheticCore.ts`)
builds a `PlateFramePoint` whose `beginAge` is set to the rotation table's
own maximum age, so the static polygon's begin age can never gate
`positionAt()`. `buildAgeDepthModel()`'s own loop, bounded by
`basementAgeMa`, is the sole real limit — exactly this ADR's original
"Seton grid alone answers how far back" principle, just not yet wired
through the borrowed code the first time Phase 2 needed it.

## Consequences

- If Scotese's and Seton et al.'s crustal reconstructions are ever found to
  diverge meaningfully even for Preserved Crust, that's a real problem this
  ADR's assumption doesn't survive — flagged explicitly rather than
  silently trusted, per the CCD Curve's own cross-check spirit (ADR-0005).
- A future contributor unfamiliar with this reasoning will see two
  differently-sourced reconstruction models feeding one query and, correctly
  per Geode's own house rules, wonder if it's a bug. It isn't — this ADR is
  why.
