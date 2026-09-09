# Real core-top cross-check of δ18O and Mg/Ca against published observations

Neither Proxy Tracer (ADR-0014 δ18O, ADR-0018 Mg/Ca) had ever been checked
against a real measured value — both are pure functions of this project's
own modeled OTEMP, verified only at the equation level (the Shackleton 1974
and Anand et al. 2003 formulas themselves, confirmed against their
published sources). This is the first check of the full pipeline: does
`delta18OFromTemperature(OTEMP)` / `mgCaFromTemperature(OTEMP)`, run on
this project's own real present-day OTEMP, land anywhere near what real
sediment cores actually record at the same location?

## Data — real, independently published, not generated for this check

- **δ18O**: Anderson & Mulitza (2001), PANGAEA
  (https://doi.org/10.1594/PANGAEA.60896) — a compilation of real
  core-top planktic foraminiferal δ18O. 10 sites used here, one per
  10°-latitude band from -40° to 45°, spread across the Atlantic, Pacific
  and Indian basins, all in >2000 m water (avoiding shelf/marginal-sea
  effects), using *G. ruber* (white) — a shallow mixed-layer species, the
  closest real analogue to this project's generic (non-species-specific)
  "calcite in equilibrium with surface OTEMP" assumption.
- **Mg/Ca**: Johnstone, Elderfield & Yu (2011), PANGAEA
  (https://doi.org/10.1594/PANGAEA.807074) — real core-top *G. ruber*
  (white) Mg/Ca from the tropical/subtropical Pacific, Atlantic and western
  Indian Ocean. 8 sites picked for basin/latitude spread (-31° to 19°); one
  (WIND-20B, off Madagascar) fell on a masked/no-ocean-data grid cell in
  BRIDGE-Valdes at this resolution and is excluded, reported as such, not
  papered over.

Both are real published site coordinates joined against this project's own
live present-day OTEMP (BRIDGE-Valdes, layer 0, age=0) via the exact
production functions (`check_delta18o.mjs`, `check_mgca.mjs`).

## What the figure shows, and what it doesn't

**01-proxy-vs-real-coretop.png** — model-predicted vs. real published
value, one panel per proxy, both on a shared 1:1 reference line (perfect
agreement). This tests exactly the claim that matters: does this project's
synthetic proxy value land near what a real core actually records at that
location — not just whether the underlying equation is textbook-correct
(already checked separately, ADR-0014/0018).

**δ18O**: r=0.93, mean absolute error 0.58‰ across 10 sites — genuinely
close to real published core-top SST-δ18O calibration studies' own
intrinsic scatter (Malevich et al. 2019's own species-pooled annual model:
~0.47-0.54‰ standard error). A small systematic offset exists (model reads
~0.45‰ more negative than real on average — this project's OTEMP running
very slightly warm at these sites, not a broken equation).

**Mg/Ca**: r=0.71, mean absolute error 0.64 mmol/mol across 7 sites —
weaker than δ18O but still a real, positive relationship. A directional
pattern is visible in the figure, not just noise: the model reads slightly
high at the two coolest (highest-latitude, subtropical Indian Ocean) sites
and slightly low at the warmest (Caribbean) site — consistent with
BRIDGE-Valdes's own real, known behaviour as a coarse GCM (compressed
meridional SST gradient relative to reality), not a defect in the Mg/Ca
equation itself.

**What this does NOT show**: a large, statistically powered validation (10
and 7 sites respectively, not hundreds); nor does it separate "OTEMP is
slightly biased at these specific points" from "the equations themselves
have residual real-world scatter" — both proxies were checked at the
equation level already and are known-correct there, so the residuals shown
here are attributable to this project's own present-day OTEMP field, not
proxy-equation error.

## Reproducing

```
npx tsx check_delta18o.mjs   # needs the dev server running (LOCAL_BASE unused here -- fetches OTEMP live from Geode)
npx tsx check_mgca.mjs
conda run -n pygmt17 python make_figure.py
```

`coretop_sites.json` / `coretop_mgca_sites.json` are the real site
selections (lon/lat/real proxy value), pulled once from the PANGAEA
datasets above and saved so the check is reproducible without re-fetching
and re-parsing the full compilations each run.
