# BRIDGE-Valdes is the sole Climate Driver; every other climate Model in Geode's archive is out of scope

Geode's archive carries four climate-family Models: `climate-540myr`,
`climate-pohl2022`, `bridge-valdes2021-monthly`, and
`bridge-valdes2021-ocean-depth`. Checked directly against each Model's own
manifest (not assumed): only the two BRIDGE-Valdes Models carry any
ocean-specific field at all —

```
climate-540myr           -> T, P, SALB, LANDFRAC, U, V, T_RANGE, KOPPEN
climate-pohl2022         -> T, P, EVP, RNF, PME, TOPO, LANDMASK, KOPPEN
bridge-valdes2021-monthly    -> T, P, MSLP, ICECONC, U, V, SST, SSS, OCU, OCV, ICEU, ICEV, STREAMFN, MLD, KOPPEN
bridge-valdes2021-ocean-depth -> OTEMP, OSAL, OCURU, OCURV, OVEL
```

`climate-540myr` and `climate-pohl2022` are land/atmosphere reconstructions
with no SST, no ocean currents, and no vertical velocity — nothing an ocean
sediment-core tool can read at all. BRIDGE-Valdes alone carries SST, SSS,
surface and depth-resolved ocean currents, and `OVEL` (the Productivity
Signal source — see CONTEXT.md).

**Decision: BRIDGE-Valdes (`bridge-valdes2021-monthly` +
`bridge-valdes2021-ocean-depth`, the Valdes, Scotese & Lunt 2021 HadCM3
timeslices) is the only Climate Driver SODP will ever read.** Not a default
with room for others later — the other two Models are structurally
incapable of supplying what this project needs, so there is nothing to
generalize to. This also happens to keep the whole system on one coherent
reconstruction lineage: BRIDGE-Valdes is itself Scotese-tied, matching the
plate-assignment source in ADR-0002.

A useful side effect: BRIDGE-Valdes's own boundary conditions were forced
with the Foster et al. (2017) CO2 reconstruction (per Geode's
`prep/bridge_runs.py`), which is exactly the curve ADR-0005's CO2-Linked CCD
Curve uses — the Climate Driver and the CCD cross-check share a forcing
history, not a coincidence.

## Consequences

- Any future request to "support other climate models" is answered by this
  ADR: it isn't a missing feature, it's a hard data-availability wall. It
  would require Geode itself to export ocean fields for another
  reconstruction lineage first — a Geode-side change, not a SODP one.
