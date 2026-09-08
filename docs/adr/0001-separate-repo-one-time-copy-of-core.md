# SODP is a separate repo from Geode, reusing `core/` via a one-time copy

SODP needs Geode's rotation and static-polygon plate-assignment machinery
(`core/rotation.ts`, `core/staticPolygons.ts`, the Age Series query
pattern), but is not a Geode viewer — it computes new domain logic (CCD
comparison, lithology synthesis) that has no place in Geode's `core/`,
which is expected to stay generic across every viewer built on it.

**Decision: a separate repo, not a directory inside Geode.** Geode already
has a precedent for exactly this relationship: `generator/scaffoldRepo.mjs`
produces standalone, independently-deployed repos that carry a copy of
`viewer/src/core/` and `viewer/src/globe/`, no dev tooling, no private
submodule, no bundled data — everything else is fetched live from Geode's
own hosted archive at runtime. SODP follows the same shape, just not
produced by the generator itself (the generator only scaffolds thin
display wrappers around an existing catalog Model; SODP needs new
synthesis logic the generator's recipe schema has no room for).

**One-time copy, not a submodule or a published package.** Considered and
rejected: a git submodule (the exact thing `scaffoldRepo.mjs`'s own doc
comment calls out as deliberately avoided), and a published npm package for
the shared primitives (correct long-term, but new infrastructure neither
repo needs yet, and a published package is itself a compatibility
commitment). A one-time copy accepts drift as the cost — if Geode's
`core/` rotation or assignment logic changes later, SODP's copy won't
follow automatically — in exchange for zero new infrastructure and an
identical relationship to one this codebase has already chosen deliberately
once before.

## Consequences

- SODP has no automated way to pick up upstream `core/` changes; re-syncing
  is a manual, occasional task, not continuous.
- SODP is a static site with no backend, consistent with `dataHost`-style
  generated Geode viewers — see ADR-0004 for why this holds for the Seton
  age grid too.
