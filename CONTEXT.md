# SODP — Domain Glossary

Vocabulary for the Synthetic Ocean Discovery Project: a tool that, given a
present-day ocean point, synthesizes a plausible sediment core from sparse
physical drivers. Glossary only — no implementation detail. See
`docs/plans/sediment-core-simulator.md` for the design itself and
`docs/adr/` for why particular choices were made.

## Language

**Synthetic Core**:
The full output for one queried (lon, lat): an age-depth model paired with
a Lithology Class at each point down-core. v1 carries no Proxy Tracer
values — those are a later increment.
_Avoid_: "sediment column", "core log" (both used loosely for real cores in
the literature; reserve those for actual IODP/ODP/DSDP material if this
project ever discusses it, to keep synthetic and real cleanly apart).

**Lithology Class**:
The single categorical label a Synthetic Core carries at each down-core
point in v1 — one of three: **Carbonate Ooze**, **Siliceous Ooze**, or
**Clay** — derived from depth relative to the CCD Curve and the Productivity
Signal at that position and age (see ADR-0007 for why three, not two: opal
preservation isn't CCD-gated, so a high-productivity point below the CCD is
genuinely siliceous ooze, not clay, and collapsing the two would fail the
Present-Day Lithology Map's own validation targets). Not annotated with
event beds (turbidites, ash, IRD) or subdivided within a producer (e.g.
diatom vs. radiolarian ooze) — both later increments, not part of v1.

**Basement Age**:
The age at which oceanic crust formed at a queried point, read once from the
Seton et al. (2020) age grid as a plain present-day (lon, lat) lookup — never
reconstructed or rotated (see ADR-0002). Bounds a Synthetic Core's deepest
possible age: nothing is synthesized older than a point's own Basement Age.

**CCD Curve**:
A carbonate compensation depth value as a function of age only (no basin
dependency in v1 — see ADR-0005). Computed two ways in parallel and
cross-checked: a digitized **Published CCD Curve** (a literature
compilation) and a **CO2-Linked CCD Curve** (the Foster et al. 2017 CO2
reconstruction — the same forcing behind the BRIDGE-Valdes Climate Driver —
run through an empirical CO2-to-CCD relationship). Divergence between the
two at a given age is a diagnostic signal, not averaged away. The Present-Day
Lithology Map is the one exception to "no basin dependency": it looks up a
per-basin CCD (Atlantic/Pacific/Indian) where a basin label is available,
falling back to the single global value elsewhere — see ADR-0008. The
through-time CCD Curve itself is unchanged.

**Productivity Signal**:
The signal that distinguishes calcareous from siliceous biogenic
production at a given depth relative to the CCD Curve — information the
CCD Curve alone cannot supply. Originally `OVEL` (modeled vertical
velocity, upwelling-positive) from the Climate Driver's ocean-depth data;
checked directly against 8,445 real seafloor-lithology points and found to
carry no measurable classification skill once `OTEMP` (ocean temperature,
~5m depth) was included, so ADR-0012 dropped it. The signal now used is
`OTEMP` alone — the actual physical driver this project's own domain
framing already names (calcifying plankton are temperature-limited,
diatoms/radiolarians are not). ADR-0013 adds an optional, EQUAL second
option ("Option A") that layers a smooth, latitude-graded equatorial
Radiolarian-ooze adjustment on top of the same OTEMP-based classification,
informed by an independent published map (Diesing 2020) — kept alongside
the OTEMP-only classification ("Option B"), not replacing it; see
ADR-0011/0012/0013 for the full reasoning and the honest tradeoff between
the two.

**Climate Driver**:
BRIDGE-Valdes (`bridge-valdes2021-monthly` + `bridge-valdes2021-ocean-depth`
in Geode's archive — the Valdes, Scotese & Lunt 2021 HadCM3 timeslices) —
the only source this project reads climate data from. Every other climate
Model in Geode's archive is out of scope for SODP: none of them carry any
ocean-specific field (SST, currents, or vertical velocity) at all.
_Avoid_: referring to "the climate model" ambiguously — always BRIDGE-Valdes
here, never climate-540myr or Pohl2022.

**Present-Day Lithology Map**:
The project's first build milestone and its validation method: a Lithology
Class computed at every point on today's ocean floor, with no reconstruction
or time-integration at all (today's Basement Age, CCD Curve value, and
Productivity Signal only), painted globally and checked by eye against the
well-known present-day deep-sea sediment distribution. Precedes the
single-point, through-time Synthetic Core in build order (see ADR-0006 and
the plan doc) — deliberately not validated against real IODP/ODP/DSDP core
data in v1.

**Preserved Crust**:
Oceanic crust that survives, unsubducted, to the present day — the only kind
of crust SODP can ever produce a Synthetic Core for, since every query
starts from a present-day (lon, lat). This is the scoping condition that
makes ADR-0002's Scotese/Seton pairing acceptable: both describe the same
surviving crust closely enough at present day, even though their deeper-time
reconstructions diverge in general.
