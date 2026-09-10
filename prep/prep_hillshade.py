#!/usr/bin/env python3
"""Real greyscale shaded-relief intensity for the present-day bathymetry,
for the globe/map viewer's semi-transparent hillshade overlay (ADR-0023).

Why this exists: the viewer's Present-Day Lithology Map is a flat
classification (clay/carbonate-ooze/siliceous-ooze); the globe view adds a
literal shaded-relief render of the same real bathymetry underneath it, so
ridges/trenches/seamounts read as terrain rather than flat color. Computing
that shading correctly on a lon/lat grid needs a latitude-aware gradient
(a plain Cartesian numpy gradient gets the longitude-direction derivative
wrong toward the poles); this ports the fix already worked out for exactly
this problem in ../Geode/prep/prep_paleogeography.py::compute_hillshade,
rather than re-deriving it.

Same source and grid as prep_bathymetry.py (SRTM15 via PyGMT's
load_earth_relief, resampled with grdsample onto the same std 360x181
grid) -- deliberately re-fetched/re-resampled here rather than importing
from prep_bathymetry.py, matching this repo's prep/ convention of each
script being self-contained (see prep_basin_mask.py, prep_ccd.py). PyGMT
caches the underlying earth_relief download, so the re-fetch is cheap.

Unlike prep_bathymetry.py's own uint8 encoding, this variable's byte 255
is NOT reserved as a no-data sentinel: the gradient is computed from the
FULL elevation grid (land and ocean both), because a gradient computed
only from ocean-masked depth would be discontinuous at every coastline.
Nothing downstream ever reads a shade byte for a cell that presentDayMap.ts
has not already validated via ageBytes/bathyBytes's OWN no-data sentinel
(see presentDayCellInputs() in src/presentDayMap.ts) -- so a shade value
existing at every land pixel too is harmless, and reserving 255 as a
sentinel here would falsely blank out the real (and legitimate, at the
tails of a percentile clip) fully-lit or fully-shadowed pixels.

Output:
  archive/models/bathymetry/frames/shade/std/000.bin
  archive/models/bathymetry/manifest.json (variables[] gains a "shade" entry)

Usage:
    conda run -n pygmt17 python prep/prep_hillshade.py
"""

import argparse
import json
from pathlib import Path

import numpy as np
import pygmt
import xarray as xr

DEFAULT_NLON = 360
DEFAULT_NLAT = 181
DEFAULT_AZIMUTH = 315.0
DEFAULT_CLIP_PERCENTILE = 99.5


def load_and_resample(nlon, nlat):
    """Identical fetch/resample to prep_bathymetry.py's own helper -- same
    grid, same registration, so the shade grid lines up cell-for-cell with
    the existing depth grid."""
    relief = pygmt.datasets.load_earth_relief(resolution="01d", registration="gridline")

    tlon = np.linspace(-180.0, 180.0, nlon, endpoint=False)
    tlat = np.linspace(-90.0, 90.0, nlat)
    region = [-180.0, 180.0, -90.0, 90.0]
    spacing = [360.0 / nlon, 180.0 / (nlat - 1)]
    resampled = pygmt.grdsample(grid=relief, region=region, spacing=spacing, registration="gridline")

    z = resampled.reindex(lat=tlat, method="nearest").reindex(lon=tlon, method="nearest").values
    return np.asarray(z, dtype=np.float64), tlon, tlat


def compute_hillshade(elev_m, lon, lat, azimuth):
    """RAW (unnormalized) shaded-relief intensity -- port of
    ../Geode/prep/prep_paleogeography.py::compute_hillshade, trimmed to a
    single present-day grid (no series-wide clip-fitting pass needed here,
    since there is only one frame).

    Two real bugs fixed in the ported version, both specific to a
    geographic lon/lat grid:

    1. grdgradient's azimuthal (longitude-direction) derivative is
       numerically degenerate exactly at the poles -- every longitude is
       the same physical point there, so the derivative it computes anyway
       is spurious (Geode's own measurement: ~1000x the real max terrain
       slope elsewhere in the same grid). Fixed by overwriting each pole
       row with its neighbour before differencing, then zeroing the result.
    2. A plain Cartesian gradient (or an untagged grid) gets the
       longitude-direction derivative's latitude scaling wrong -- a degree
       of longitude covers less ground toward the poles. Tagging the grid
       geographic (`gtype=1`) makes grdgradient account for it (Geode's own
       check: ~45% error at a test point without this).
    """
    fixed = elev_m.copy()
    fixed[0, :] = fixed[1, :]
    fixed[-1, :] = fixed[-2, :]

    da = xr.DataArray(fixed, coords={"lat": lat, "lon": lon}, dims=("lat", "lon"))
    da.gmt.registration = 0  # gridline-registered, matching load_and_resample()'s grid
    da.gmt.gtype = 1         # geographic, NOT Cartesian -- see docstring
    raw = np.asarray(pygmt.grdgradient(grid=da, azimuth=azimuth).values, dtype=np.float32)
    raw[0, :] = 0.0   # no meaningful azimuthal slope AT a pole
    raw[-1, :] = 0.0
    return raw


def encode_symmetric(shade, clip):
    """Linear uint8 encode over [-clip, +clip], saturating outside it. No
    sentinel byte reserved -- see module docstring for why that's safe here."""
    scaled = np.clip((shade + clip) / (2.0 * clip), 0.0, 1.0) * 255.0
    return np.round(scaled).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nlon", type=int, default=DEFAULT_NLON)
    ap.add_argument("--nlat", type=int, default=DEFAULT_NLAT)
    ap.add_argument("--azimuth", type=float, default=DEFAULT_AZIMUTH)
    ap.add_argument("--clip-percentile", type=float, default=DEFAULT_CLIP_PERCENTILE)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "archive")
    ap.add_argument("--validate", action="store_true")
    args = ap.parse_args()

    print("fetching    SRTM15 earth_relief (01d, gridline) via pygmt.datasets.load_earth_relief")
    elev_m, lon, lat = load_and_resample(args.nlon, args.nlat)

    print(f"gradient    grdgradient, azimuth={args.azimuth:.0f} deg, geographic (gtype=1)")
    shade = compute_hillshade(elev_m, lon, lat, args.azimuth)

    clip = float(np.percentile(np.abs(shade), args.clip_percentile))
    print(f"shade range {shade.min():+.3f} to {shade.max():+.3f} raw  "
          f"(clipping to +-{clip:.3f}, the {args.clip_percentile} percentile of |gradient|)")

    byte = encode_symmetric(shade, clip)

    model_dir = args.out / "models" / "bathymetry"
    frame_dir = model_dir / "frames" / "shade" / "std"
    frame_dir.mkdir(parents=True, exist_ok=True)
    out_path = frame_dir / "000.bin"
    byte.tofile(out_path)
    kb = out_path.stat().st_size / 1024
    print(f"encoded     [-{clip:.3f}, +{clip:.3f}] -> uint8, no sentinel   {kb:.1f} KB")

    manifest_path = model_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["variables"] = [v for v in manifest["variables"] if v["id"] != "shade"] + [{
        "id": "shade",
        "name": "Shaded Relief (grdgradient, azimuth 315 deg)",
        "units": "unitless",
        "diverging": True,
        "encode_min": -clip,
        "encode_max": clip,
        "value_min": round(float(shade.min()), 4),
        "value_max": round(float(shade.max()), 4),
    }]
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"updated     {manifest_path} (variables[] now: {[v['id'] for v in manifest['variables']]})")

    if args.validate:
        back = np.fromfile(out_path, dtype=np.uint8).reshape(args.nlat, args.nlon)
        phys = -clip + (back.astype(np.float32) / 255.0) * (2 * clip)
        print(f"validate    {back.size} bytes, decoded range [{phys.min():.3f}, {phys.max():.3f}] "
              f"(raw range [{shade.min():.3f}, {shade.max():.3f}])")

    return manifest


if __name__ == "__main__":
    main()
