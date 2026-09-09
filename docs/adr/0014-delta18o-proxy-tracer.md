# First Proxy Tracer: δ18O, from OTEMP alone, carbonate-ooze steps only

CONTEXT.md scoped v1 to Lithology Class only, with Proxy Tracers ("no
Proxy Tracer values — those are a later increment") and the plan doc's own
deferred list named δ18O/Mg/Ca first, specifically because they "fall out
of temperature data BRIDGE-Valdes already carries, no new data source
needed." That's now doubly true: OTEMP is already fetched and classified
against per step by both maps (ADR-0011/0012). This is that increment.

## Scope decisions (asked directly, not assumed)

1. **Carbonate-ooze steps only.** δ18O/Mg/Ca are calcite-based
   paleothermometers — they mean nothing at a clay or siliceous-ooze step
   (no calcite preserved/produced there in this project's own 3-class
   model). `LithologyLogStep.delta18O` is `undefined` unless
   `classPrimary === 'carbonate-ooze'` at that step.
2. **δ18O only, not Mg/Ca.** Mg/Ca-temperature calibrations are genuinely
   species-specific (planktic foram calibrations differ materially by
   taxon) — picking one implicitly picks a fictional foraminifer, a bigger
   unstated assumption than δ18O needs. Deferred, not ruled out.
3. **Seawater δ18O fixed as a single global constant for now** (default
   0‰ VSMOW, i.e. today's approximate ice-free global mean), explicitly
   NOT varying with an ice-volume curve through time yet — matching this
   project's existing "start with the age-only/global version, add
   basin or ice-volume dependence later if it matters" pattern (CCD Curve,
   ADR-0005/0008). Scaling seawater δ18O with a real ice-volume proxy
   through deep time is real future work, not attempted here: it's an
   entirely separate external data source and literature choice, out of
   scope for landing the first Proxy Tracer.

## The equation, and its inverse

Shackleton (1974)'s calcite paleotemperature equation, refining Epstein et
al. (1953)/Craig (1965) — a form widely cited (e.g. Bemis et al. 1998,
Table 1):

```
T (degC) = 16.9 - 4.38*(dc - dw) + 0.10*(dc - dw)^2
```

where `dc` = calcite δ18O (‰ VPDB), `dw` = seawater δ18O converted to the
VPDB-equivalent scale (`dw_smow - 0.27`, the standard SMOW->PDB offset).

This project has OTEMP (the known quantity) and needs `dc` — the inverse.
Solved analytically via the quadratic formula
(`src/proxies.ts::delta18OFromTemperature()`); the equation has two roots,
and which one is physical was checked directly, not assumed:

- The discriminant is `12.4244 + 0.4*T`, positive for every `T > -31degC`
  — every real ocean temperature this project will ever see, polar to
  hothouse. Both roots are always real over the whole realistic domain.
- The smaller ("minus") root is the physically valid one throughout,
  confirmed numerically at both ends of a realistic range: T=0degC gives
  dc=+4.0‰ VPDB (matches real cold benthic values); T=25degC gives
  dc=-2.0‰ VPDB (matches real warm planktic values). Checked across
  -2degC to 40degC — monotonic, smooth, no sign flip or discontinuity
  anywhere in that range.

## Decision

1. New file `src/proxies.ts`: `delta18OFromTemperature(otempC, seawaterD18OSmow = 0)`.
2. `LithologyLogStep` (`src/syntheticCore.ts`) gains `delta18O: number | undefined`,
   computed once per step from that step's own real paleo-OTEMP (already
   fetched), gated on `classPrimary === 'carbonate-ooze'` — the same
   "single answer for a caller that wants one" tier `classPrimary` itself
   already uses, collapsing Published-vs-CO2-Linked-CCD ambiguity the same
   way. Not computed separately per curve; not affected by which of
   ADR-0013's two classifier options is active except through
   `classPrimary` itself (Option A can change which steps qualify as
   carbonate-ooze, and therefore which steps get a δ18O value, but the
   `delta18O` computation itself is identical either way — it only
   consumes OTEMP).
3. **Present-day map is NOT extended** — CONTEXT.md scopes Proxy Tracers
   to the Synthetic Core (through-time, per-step) specifically; the
   present-day grid stays Lithology-Class-only.
4. UI: down-core table gets a δ18O column (‰ VPDB), blank where undefined.

## Consequences

- **A second real, externally-sourced equation now lives in this
  project**, alongside the CCD Curve's two sources and the classifier's
  logistic fit — same standard of "real literature source, checked
  against real reference values," not a made-up formula.
- **Seawater δ18O as a fixed constant is a real, acknowledged
  simplification** — it will understate δ18O swings across genuinely
  different ice-volume states (full icehouse vs. ice-free hothouse) the
  same way the CCD Curve's original global-only version understated
  basin contrast before ADR-0008. Flagged here as the next thing to
  revisit if this proxy's absolute values matter for a real comparison,
  not silently assumed away.
- Mg/Ca stays deferred; nothing here blocks adding it later using the
  same OTEMP series once a specific foram calibration is chosen.
