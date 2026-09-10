#!/usr/bin/env python3
"""Real greyscale shaded-relief intensity for the globe/map viewer's
semi-transparent hillshade overlay (ADR-0023/ADR-0024).

Why a SEPARATE, much finer-grained model than bathymetry itself: the
Present-Day Lithology Map's classification (`buildPresentDayGrid` in
src/presentDayMap.ts) needs bathymetry on the SAME 360x181 grid as
Basement Age and OTEMP, so `prep_bathymetry.py` deliberately downsamples
real SRTM15 to that coarse 1-degree grid. The hillshade overlay is purely
visual -- nothing classifies against it -- so it has no reason to share
that constraint, and every reason not to: at 360x181 a hillshade looks
blocky and defeats the point of shading a coastline or a ridge. This ships
its own model, `bathymetry-hillshade`, at 0.1 degree (3600x1801) -- 10x
the classification grid's resolution per axis -- fetched independently
(PyGMT caches the underlying earth_relief download, so re-fetching at a
different resolution here is cheap, not a duplicate cost of
prep_bathymetry.py's own fetch).

Shading logic ports what ../Geode/prep/prep_paleogeography.py's own
compute_hillshade() already had to solve for a real hillshade on a lon/lat
grid -- see compute_hillshade()'s docstring below for the two specific
bugs (pole-row degeneracy, geographic vs. Cartesian derivative scaling)
this avoids re-discovering.

Output:
  archive/models/bathymetry-hillshade/manifest.json
  archive/models/bathymetry-hillshade/frames/shade/std/000.bin

Usage:
    conda run -n pygmt17 python prep/prep_hillshade.py
"""

import argparse
import json
from pathlib import Path

import numpy as np
import pygmt
import xarray as xr

# 0.1 deg = 6 arc-min ("06m" in PyGMT's earth_relief resolution keywords) --
# 10x prep_bathymetry.py's 360x181 classification grid per axis.
DEFAULT_NLON = 3600
DEFAULT_NLAT = 1801
DEFAULT_SOURCE_RESOLUTION = "06m"
DEFAULT_AZIMUTH = 315.0
DEFAULT_CLIP_PERCENTILE = 99.5


def load_and_resample(source_resolution, nlon, nlat):
    """Same shape as prep_bathymetry.py's own helper, parameterized on
    source resolution instead of hardcoding '01d' -- see module docstring
    for why this model needs a finer one."""
    relief = pygmt.datasets.load_earth_relief(resolution=source_resolution, registration="gridline")

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
    sentinel byte reserved: the gradient is computed from the FULL
    elevation grid (land and ocean both -- masking to ocean-only first
    would make the gradient discontinuous at every coastline), and nothing
    downstream reads a shade byte for a cell it hasn't already validated as
    real ocean via bathymetry's OWN sentinel (see presentDayCellInputs() in
    src/presentDayMap.ts) -- so a real shade value under every land pixel
    too is harmless, and reserving 255 here would falsely blank out real
    fully-lit pixels at the top of the percentile clip."""
    scaled = np.clip((shade + clip) / (2.0 * clip), 0.0, 1.0) * 255.0
    return np.round(scaled).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nlon", type=int, default=DEFAULT_NLON)
    ap.add_argument("--nlat", type=int, default=DEFAULT_NLAT)
    ap.add_argument("--source-resolution", default=DEFAULT_SOURCE_RESOLUTION)
    ap.add_argument("--azimuth", type=float, default=DEFAULT_AZIMUTH)
    ap.add_argument("--clip-percentile", type=float, default=DEFAULT_CLIP_PERCENTILE)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "archive")
    ap.add_argument("--validate", action="store_true")
    args = ap.parse_args()

    print(f"fetching    SRTM15 earth_relief ({args.source_resolution}, gridline) via pygmt.datasets.load_earth_relief")
    elev_m, lon, lat = load_and_resample(args.source_resolution, args.nlon, args.nlat)

    print(f"gradient    grdgradient, azimuth={args.azimuth:.0f} deg, geographic (gtype=1), grid {elev_m.shape}")
    shade = compute_hillshade(elev_m, lon, lat, args.azimuth)

    clip = float(np.percentile(np.abs(shade), args.clip_percentile))
    print(f"shade range {shade.min():+.3f} to {shade.max():+.3f} raw  "
          f"(clipping to +-{clip:.3f}, the {args.clip_percentile} percentile of |gradient|)")

    byte = encode_symmetric(shade, clip)

    model_dir = args.out / "models" / "bathymetry-hillshade"
    frame_dir = model_dir / "frames" / "shade" / "std"
    frame_dir.mkdir(parents=True, exist_ok=True)
    out_path = frame_dir / "000.bin"
    byte.tofile(out_path)
    mb = out_path.stat().st_size / 1024 / 1024
    print(f"encoded     [-{clip:.3f}, +{clip:.3f}] -> uint8, no sentinel   {mb:.2f} MB")

    manifest = {
        "id": "bathymetry-hillshade",
        "name": "Present-Day Shaded Relief (SRTM15 / Tozer et al. 2019, via PyGMT grdgradient)",
        "type": "hillshade",
        "source": "Tozer, B. et al. (2019), Global Bathymetry and Topography at 15 Arc Sec: SRTM15+, "
                   f"Earth and Space Science -- fetched via pygmt.datasets.load_earth_relief "
                   f"(resolution={args.source_resolution}, registration=gridline), resampled with grdsample, "
                   "shaded with pygmt.grdgradient. A purely visual overlay, deliberately at a much finer "
                   "grid than the Present-Day Lithology Map's own 360x181 classification grid -- see "
                   "ADR-0023/ADR-0024 and this script's module docstring for why.",
        "lon_min": -180.0, "lon_max": 180.0,
        "lat_min": -90.0, "lat_max": 90.0,
        "dtype": "uint8",
        "default_resolution": "std",
        "resolutions": [{"id": "std", "nlon": args.nlon, "nlat": args.nlat, "ndepth": 1}],
        "frames": [{"id": "000", "age_ma": 0}],
        "path_template": "frames/{variable}/{resolution}/{frame}.bin",
        "default_variable": "shade",
        "variables": [{
            "id": "shade",
            "name": "Shaded Relief (grdgradient, azimuth 315 deg)",
            "units": "unitless",
            "diverging": True,
            "encode_min": -clip,
            "encode_max": clip,
            "value_min": round(float(shade.min()), 4),
            "value_max": round(float(shade.max()), 4),
        }],
    }
    (model_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"wrote       {model_dir / 'manifest.json'}")

    if args.validate:
        back = np.fromfile(out_path, dtype=np.uint8).reshape(args.nlat, args.nlon)
        phys = -clip + (back.astype(np.float32) / 255.0) * (2 * clip)
        print(f"validate    {back.size} bytes, decoded range [{phys.min():.3f}, {phys.max():.3f}] "
              f"(raw range [{shade.min():.3f}, {shade.max():.3f}])")

    return manifest


if __name__ == "__main__":
    main()
