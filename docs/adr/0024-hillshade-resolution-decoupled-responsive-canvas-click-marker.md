# The hillshade outgrows the classification grid; the canvas outgrows a fixed box

Direct feedback after ADR-0023 shipped: the globe "looks a bit rubbish"
next to Geode's -- specifically, the bathymetry can be much higher
resolution than the ocean model (at least 10x), the map should fill the
main panel's height rather than sit in a small fixed box, and a click needs
to leave a visible marker on the globe (otherwise the queried point is lost
the moment the view rotates).

## Decision: the hillshade is now its own model, ~10x finer than the classification grid

ADR-0023 shipped the hillshade as a second variable inside
`archive/models/bathymetry`'s own manifest, at the same 360x181 grid as
`depth` -- convenient, but wrong: that grid's resolution is dictated by
Basement Age and OTEMP, the two other present-day-map inputs it must align
with cell-for-cell (ADR-0008), a constraint that has nothing to do with how
finely a purely visual overlay could be shaded. At 360x181 a hillshade is
blocky regardless of source data quality.

`prep/prep_hillshade.py` now fetches its own copy of SRTM15 at `06m`
(0.1 deg, PyGMT's `earth_relief` resolution keyword) instead of `01d`,
producing a 3600x1801 grid -- 10x per axis -- and ships it as a wholly
separate model, `archive/models/bathymetry-hillshade`, with its own
manifest/resolution/frame, rather than a second variable riding along with
`bathymetry`. `src/presentDayMap.ts`'s `PresentDayInputs` carries
`shadeNlon`/`shadeNlat` alongside `shadeBytes` for exactly this reason, and
`renderProjectedGrid` (`src/main.ts`) now runs two independent
`texelIndex()` lookups per screen pixel -- one against the classification
grid's `nlon`/`nlat`, one against the hillshade's own -- rather than
assuming they share a grid the way ADR-0023's version silently did.

No change to the *classification* grid itself, and no change to
`prep_bathymetry.py` -- the depth input the classifier reads still has to
match Basement Age/OTEMP's 360x181, which is a real (not incidental)
constraint. Only the visual-only hillshade moved.

## Decision: canvas resolution follows the container, not a fixed constant

ADR-0023's `CANVAS_W`/`CANVAS_H` (1080x720) meant the map/globe sat in a
small fixed box regardless of how much room the browser window actually
gave it. `resizeCanvasToContainer()` now measures `#map-pane`'s own
`getBoundingClientRect()` and sets the canvas's drawing-buffer size to
match, re-checked on every `renderActive()` call and whenever a
`ResizeObserver` on `#map-pane` fires (not just on `window`'s own resize
event -- the pane can change size without the window doing so, e.g. if the
side panel's own content ever changed width). `index.html`'s CSS changed
to match: `#map-canvas` is `width:100%; height:100%; display:block` inside
a `#map-pane` with no more centering/padding, so the element box and the
drawing buffer stay in lockstep instead of the old fixed-box-centered-with-
`max-width:100%`-scaling approach.

One consequence threaded through: `ROTATE_DEG_PER_PX` was a module-level
constant derived from the old fixed `CANVAS_W/H` -- it's now computed at
drag time from `mapCanvas.width/height`, so rotation sensitivity stays
proportional to the globe's actual on-screen radius regardless of window
size.

## Decision: the click marker uses the `Projection` interface's other half

ADR-0023 defined `lonLatToScreen` on the `Projection` interface but noted
nothing called it yet. It's the natural fit here: `main.ts` now keeps
`markerPoint` (the last clicked lon/lat, set even when the click misses
real ocean data -- land clicks are useful feedback too, ADR-0022's own
map/core mismatch discussion is exactly the kind of thing seeing "you
clicked here" helps debug) and `renderProjectedGrid` draws a small pin
(`drawMarker`) at `projection.lonLatToScreen(markerPoint, ...)` after the
main pixel buffer is painted. On the globe this naturally disappears when
the marked point rotates onto the far hemisphere (`lonLatToScreen` returns
`undefined` there) and reappears correctly when rotated back -- no special
casing needed, since the same projection math both painted the globe and
now places the marker on it.

## Consequences

- `archive/` gained a new ~6.2MB file (the 3600x1801 hillshade grid,
  uncompressed uint8) -- still small enough to commit directly, consistent
  with this project's existing convention (ADR: total archive stays a few
  MB, unlike Geode's release-asset-hosted hundreds of MB).
- The render loop's cost is still `O(canvas pixels)`, not `O(source grid
  size)` -- `texelIndex()` is a direct lookup regardless of how large
  either source grid is, so the 10x finer hillshade and the now-larger
  (fills-the-panel) canvas don't multiply against each other.
- The header controls (`index.html`) were restyled to match Geode's own
  dark panel palette (`#1b1f24` panels, `#3a4048` borders, `#262b32`
  hover) purely cosmetically -- no behavior change, not itself an
  architectural decision, called out here only because it shipped in the
  same pass.
