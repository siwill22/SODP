# The Seton et al. (2020) age grid is resampled once into a static web grid, never served by a backend

The published Seton et al. (2020) seafloor age grid is full-resolution
source data, not shaped for direct client-side use. Two ways to make it
queryable from a browser: resample it once into a small, uniform grid
shipped whole to the client (Geode's own `Volume` convention — every grid
Geode's viewer reads follows this shape, per its own CONTEXT.md), or keep
the full-resolution grid server-side behind a point-lookup endpoint.

**Decision: resample once, ship the whole grid, sample client-side. No
backend.** This matches every other grid in Geode's own architecture, keeps
SODP a static, backend-free site (consistent with ADR-0001's "add-on"
framing and how Geode's own generated viewer sites deploy), and costs
nothing new to build beyond a one-off prep script. The alternative — a live
point-lookup service — would be the only server-side component anywhere in
this system, for one input among several that are already
literature-resolution approximations (both CCD Curve variants, the
Productivity Signal's coarse categorical use of `OVEL`).

**Basement age precision is not the limiting factor here.** Resampling to
Geode's usual web-grid resolution loses precision relative to the published
grid, but that loss is not meaningfully worse than the approximations
already accepted elsewhere in v1's model (see ADR-0005, ADR-0002).

## Consequences

- A future need for full-resolution basement age (if some later increment
  turns out to be sensitive to it) would require revisiting this ADR, not
  just adding a flag — it's a real architectural change (introducing a
  backend) rather than a config toggle.
