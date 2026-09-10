# SODP — Domain Glossary

Vocabulary for the Synthetic Ocean Discovery Project: a tool that, given a
present-day ocean point, synthesizes a plausible sediment core from sparse
physical drivers. Glossary only — no implementation detail. See
`docs/plans/sediment-core-simulator.md` for the design itself, `docs/adr/`
for why particular choices were made, and `docs/model-reference.md` for the
current per-data-type state (what's live/validated vs. prototyped vs.
designed-only) of everything below.

## Language

**Synthetic Core**:
The full output for one queried (lon, lat): an age-depth model paired with
a Lithology Class at each point down-core, plus, at each step, a Proxy
Tracer reading, a Hiatus Risk annotation, and (Python-validated, not yet
live) a Depth-in-Core / Physical Property Log reading. Proxy Tracers and
Hiatus Risk landed after v1 (ADR-0014/0018 and ADR-0019 respectively) —
the original v1 scope carried neither; see the plan doc for that historical
framing.
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

**Proxy Tracer**:
A down-core geochemical value inferred from a Synthetic Core step's own
real paleo-OTEMP via a published temperature-calcite calibration — δ18O
first (ADR-0014, Shackleton 1974, inverted), Mg/Ca second (ADR-0018, Anand
et al. 2003) — checked against real published core-top values
(`show-me/2026-09-09-proxy-core-top-check/`: δ18O r=0.93, Mg/Ca r=0.71).
Computed whenever OTEMP itself is valid, not gated on `classPrimary`
(ADR-0016): the classifier's carbonate-ooze probability is a label
confidence, not a measured volumetric composition, and real cores yield a
calcite signal from minor/accessory carbonate even in clay-dominated
intervals. Always paired with `probsPrimary['carbonate-ooze']` by a caller
judging plausibility, never read alone. Distinct from a Physical Property
Log: a Proxy Tracer is inferred from OTEMP and is only ever meaningful
where calcite exists; a Physical Property Log is inferred from a point's
Lithology Class mixture and Depth-in-Core, and applies regardless of
composition.
_Avoid_: "isotope tracer" (Mg/Ca is not an isotope; "Proxy Tracer" covers
both), "paleothermometer" alone (accurate but omits that this project uses
the *inverse* direction for δ18O — OTEMP is the known quantity here, not
the unknown being solved for).

**Hiatus Risk**:
A continuous, always-computed per-step probability that a Synthetic Core's
down-core record is missing at that age — deliberately an annotation on the
existing age-depth model, not a change to it (no depth discontinuity, no
removed step; see ADR-0019). Not the same as a real "unconformity", a
discrete stratigraphic surface/event with a threshold implied by the word
"major" — this project computes no such threshold or event, only the
probability; a "major unconformity" is a viewer-side interpretation of a
high Hiatus Risk value, never a category the model itself decides.
Decomposed into two independently-sourced, differently-mechanistic
components rather than one blended number (ADR-0019): **Current Erosion
Risk** (real BRIDGE-Valdes bottom-current speed's PERCENTILE RANK within
this model's own real speed distribution, not a threshold on the absolute
value — two absolute-threshold calibrations were tried first, a real
literature erosion-velocity figure and this model's own 95th percentile as
a centre, and both proved unreachable by any real query point; ranking
sidesteps trusting this coarse model's absolute magnitudes at all, see
ADR-0019) and **Dissolution Risk**
(depth below the CCD Curve, boosted when the two CCD Curves diverge). A derived combined
probability exists for callers wanting one number, alongside the two
underlying signals — the same Primary-on-top-of-full-detail shape the CCD
Curve and Lithology Class already use. Deliberately not fit or validated
against any real hiatus-occurrence dataset (no such dataset is sourced in
this project) — a physically-justified but unvalidated hypothesis, the same
honest-caveat treatment already given the Proxy Tracers' own simplifications.
_Avoid_: "unconformity" alone (reserve for real IODP/ODP/DSDP material, same
policy as "core log"/"sediment column" under Synthetic Core).

**Depth-in-Core**:
Depth below the seafloor (metres below seafloor, mbsf) at a point in a
Synthetic Core's down-core record, produced by integrating the
Sedimentation Rate through the core's own history and compacting the
result via the same porosity-depth relationship each Lithology Class
carries (ADR-0020). A genuinely different axis from Ocean Depth (the water
column above the seafloor, GDH1-derived) -- the two do not compose into a
single "total depth," and there is no conversion between them.
_Avoid_: "depth" alone (ambiguous with Ocean Depth), "burial depth" (used
informally during design discussion, not the canonical term), "mbsf" as a
standalone term outside of stating units.

**Sedimentation Rate**:
The rate (cm/kyr) at which uncompacted sediment accumulates at a Synthetic
Core's own position and age -- a probsPrimary-weighted mixture of a
literature end-member rate per Lithology Class, not a single global
constant (ADR-0020). The per-class end-member values themselves are not
yet sourced: real pelagic accumulation-rate literature doesn't cleanly
separate Carbonate Ooze from Siliceous Ooze the way this project's other
constants are cleanly sourced, so this is an open, explicitly-flagged
sourcing TODO, not a placeholder pretending otherwise.

**Physical Property Log**:
A down-core physical measurement synthesized as a function of Depth-in-Core
rather than age alone -- Bulk Density and Porosity first (ADR-0020),
Magnetic Susceptibility second (ADR-0021), each via the same
compaction/probsPrimary-mixture engine with a new per-Lithology-Class
end-member table per property. Named after the real IODP/ODP shipboard
Multi-Sensor Core Logger suite (bulk density, porosity, P-wave velocity,
magnetic susceptibility, natural gamma radiation, color reflectance), of
which SODP synthesizes only a growing subset, one property per increment.
Distinct from a Proxy Tracer (δ18O, Mg/Ca): a Proxy Tracer is inferred from
OTEMP and paired with carbonate plausibility, never gated on it (ADR-0016);
a Physical Property Log is inferred from a point's own Lithology Class
mixture and Depth-in-Core, and applies regardless of composition.
_Avoid_: "MSCL log" (the real instrument name; this project synthesizes the
measurement, not the instrument output, and only some of the suite).

**Present-Day Sediment Thickness Map**:
The validation milestone for the Sedimentation Rate model, checked against
Straume et al. (2019)'s GlobSed global sediment-thickness compilation
(ADR-0020). Named in deliberate parallel with the Present-Day Lithology
Map (ADR-0006), but NOT the same shape of thing: the Present-Day Lithology
Map could stay present-day-only because a point's Lithology Class only
ever needed today's inputs, while total sediment thickness at a point is a
sum over that point's entire age history, so this map requires the same
through-time reconstruction machinery the single-point Synthetic Core
already uses, run across a global grid rather than one point. Validated
once, offline, in Python -- not built as a live app feature by default;
whether it becomes one is a separate, later decision.
