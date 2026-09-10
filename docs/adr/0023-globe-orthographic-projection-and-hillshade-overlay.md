# A globe view (Orthographic), switchable with the flat map, plus a real hillshade overlay

Asked directly: view the Present-Day Lithology Map on a globe, not just the
flat map, with real bathymetry rendered as a greyscale shaded-relief layer
semi-transparently on top, and a way to switch between the two.

## Decision: canvas-2D orthographic, not three.js

The sibling project Geode has a proven three.js globe
(`viewer/src/globe/`) for its mantle tomography viewer. SODP does not
reuse it. This project's `src/core/constants.ts` already states the reason
for everything Geode-globe-specific being trimmed from the one-time copy
(ADR-0001): "SODP's v1 UI is a flat 2D map (no three.js, no raycasting)."
Adding three.js for one feature would mean a new dependency, a render
loop, a camera/scene/lighting setup, and losing the CPU-side one already
has (`presentDayCellInputs`-style per-pixel lookups) for no capability this
project's data actually needs -- the source data is a flat lon/lat raster
either way, never a real 3D volume the way Geode's mantle models are.

Instead, `src/projection.ts` implements the globe as a plain **inverse
orthographic projection** (Snyder 1987 ch. 20 -- the same formulas D3-geo's
`geoOrthographic` uses) over the *same* canvas/`ImageData` machinery the
flat map already used. A `Projection` interface
(`screenToLonLat`/`lonLatToScreen`, parameterized by a `GlobeView {lon0,
lat0}` rotation state) is implemented twice -- `equirectangular` (a
straight port of the map's existing linear math) and `orthographic` -- so
one render loop and one click handler serve both.

**Consequence: the render loop had to become destination-driven.** The old
`drawPresentDayGrid` was a *source* loop -- walk the classified grid,
forward-paint a `SCALE`-sized block per cell -- which only worked because
equirectangular's forward mapping happens to be a clean per-cell block.
Orthographic has no such structure (a screen pixel might show zero, one, or
several grid cells' worth of area depending on rotation and where on the
sphere it lands), so `renderProjectedGrid` in `src/main.ts` instead walks
every **canvas** pixel, asks the active projection for its lon/lat via
`screenToLonLat`, and looks that up in the grid with the existing
`texelIndex()` (`src/core/volume.ts`, unchanged, reused as-is). This also
decouples canvas resolution from grid resolution for the first time: the
canvas is now a fixed 1080x720 regardless of the grid's own 360x181, with
equirectangular letterboxed to its 2:1 aspect and orthographic filling the
inscribed circle.

**Click vs. drag share one pointer stream.** A globe needs drag-to-rotate;
the flat map's existing "click anywhere to build a Synthetic Core" needs to
keep working, unchanged, on both projections. `main.ts` tracks
pointerdown/move/up with a small movement threshold (`DRAG_THRESHOLD_PX`):
under it, treat pointerup as a click (query `screenToLonLat` at that pixel,
same downstream code as before); over it, and only when the active
projection is orthographic, treat it as a rotation (`GlobeView.lon0/lat0`
adjusted by the pixel delta, re-rendered via `requestAnimationFrame`
throttling so a drag doesn't queue more full-canvas repaints than the
browser can paint). Flat mode ignores drags -- it has no rotation state.

## Decision: the hillshade is prepped offline with PyGMT, not computed in JS

`prep/prep_hillshade.py` (new, `pygmt17` env) fetches and resamples the
same SRTM15 relief `prep_bathymetry.py` already uses, computes shaded-relief
intensity via `pygmt.grdgradient`, and ships it as a second `variables[]`
entry (`shade`) in the existing `archive/models/bathymetry/manifest.json`
-- same grid, same frame, no new model directory.

This ports, rather than re-derives, logic Geode's own
`prep/prep_paleogeography.py::compute_hillshade` already had to solve for
the identical problem (a real hillshade on a lon/lat grid): tagging the
grid geographic (`gtype=1`) so grdgradient scales the longitude-direction
derivative by latitude correctly (a plain Cartesian gradient measurably
wrong -- Geode's own check found ~45% error at a test point), and
overwriting the pole rows before differencing (grdgradient's azimuthal
derivative is otherwise spuriously ~1000x real terrain slope exactly at
the poles, where every longitude is the same physical point). Doing this
client-side in JS from the already-fetched 360x181 grid would mean
re-deriving both fixes in a second language, at much coarser resolution,
for a value that never changes at runtime -- a worse version of something
already solved once.

**No no-data sentinel on the `shade` variable, unlike every other variable
in this archive.** The gradient is computed from the *full* elevation grid
(land and ocean both) -- masking to ocean-only first, the way
`prep_bathymetry.py`'s own `depth_km` does, would make the gradient
discontinuous at every coastline. Nothing downstream ever reads a `shade`
byte for a cell it hasn't already validated as real ocean via
`bathyBytes`/`ageBytes`'s own sentinel (see `presentDayCellInputs()`), so a
real (not fake-no-data) shade value sitting under every land pixel too is
harmless -- and reserving byte 255 as a sentinel here would falsely blank
out real fully-lit pixels at the top of the percentile clip.

## Decision: two projections for v1, no Robinson/Mollweide yet

Equirectangular (existing) and Orthographic (new) only. Both are what the
user asked for directly ("try this on a globe... switch between
projections"); a compromise flat projection like Robinson or Mollweide is
easy to add later against the same `Projection` interface (each is also
just another pure inverse-projection function over the same canvas loop)
but wasn't asked for and would be speculative scope now.

## Consequences

- `src/presentDayMap.ts`'s `PresentDayInputs` grew two fields
  (`shadeVar`/`shadeBytes`), fetched alongside `bathyBytes` in the same
  `Promise.all` -- one more small (~64KB) request at startup, no new
  network round-trip shape.
- The render loop's cost changed from "once per data load / toggle" to
  "up to once per animation frame while dragging the globe" -- addressed by
  precomputing a small RGB lookup table for the four known colors (`CLASS_RGB`)
  instead of parsing hex strings per pixel per frame, and by `rAF`-throttling
  drag repaints rather than rendering on every raw `pointermove`.
- The flat map's visual output changed too, not just the globe's: it now
  always carries the real hillshade overlay (`SHADE_ALPHA = 0.35`), where
  before it was flat classification color only.
- `image-rendering: pixelated` was dropped from `#map-canvas`'s CSS -- it
  suited the old grid-aligned block render; the new per-pixel relief-shaded
  render looks better smoothed when the browser scales the canvas element.
