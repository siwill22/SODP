#!/usr/bin/env python3
"""Resample real present-day bathymetry (SRTM15, via PyGMT's earth_relief
dataset) into the same static web grid shape as basement-age.

Why this exists: the Present-Day Lithology Map (ADR-0006) originally derived
ocean depth from Basement Age via GDH1 (Stein & Stein 1992) -- see
ageToDepthKm() in src/lithology.ts. GDH1 is a *synthetic* age-depth curve
with no dynamic topography, sediment loading, or hotspot-swell correction;
it exists to answer "what was the depth at a past age" for the through-time
reconstruction (Phase 2), where no observed depth is available. For the
PRESENT DAY map specifically, real observed bathymetry is directly
available and is strictly better input -- see ADR-0008. This script sources
it the same way ADR-0004 sources basement age: prepped once into a static
grid, no backend.

Unlike prep_basement_age.py, the source here is not a downloaded file but
PyGMT's own bundled/cached dataset fetcher (pygmt.datasets.load_earth_relief),
which is itself SRTM15 (Tozer et al. 2019), WGS84/EGM96, real measured/
altimetry-derived relief -- not a model output.

Land (elevation >= 0) is not oceanic depth and is carried as no-data, same
convention as prep_basement_age.py's NaN-over-land handling.

Output:
  archive/models/bathymetry/manifest.json
  archive/models/bathymetry/frames/depth/std/000.bin

Usage:
    conda run -n pygmt17 python prep_bathymetry.py
"""

import argparse
import json
from pathlib import Path

import numpy as np
import pygmt

DEFAULT_NLON = 360
DEFAULT_NLAT = 181
NO_DATA_SENTINEL = 255
# Mariana Trench is ~10.99 km; round up so no real depth encodes to 255.
ENCODE_MAX_KM = 11.5


def load_and_resample(nlon, nlat):
    """Fetch SRTM15 at 1 arc-degree and resample onto the target grid via
    PyGMT's own grdsample (spherical-aware, unlike a flat linear resample)."""
    relief = pygmt.datasets.load_earth_relief(resolution="01d", registration="gridline")

    tlon = np.linspace(-180.0, 180.0, nlon, endpoint=False)
    tlat = np.linspace(-90.0, 90.0, nlat)
    region = [-180.0, 180.0, -90.0, 90.0]
    spacing = [360.0 / nlon, 180.0 / (nlat - 1)]
    resampled = pygmt.grdsample(grid=relief, region=region, spacing=spacing, registration="gridline")

    z = resampled.reindex(lat=tlat, method="nearest").reindex(lon=tlon, method="nearest").values
    return np.asarray(z, dtype=np.float64), tlon, tlat


def encode(depth_km):
    valid = np.isfinite(depth_km)
    byte = np.full(depth_km.shape, NO_DATA_SENTINEL, dtype=np.uint8)
    scaled = np.clip(depth_km[valid] / ENCODE_MAX_KM, 0.0, 1.0) * 255.0
    codes = np.round(scaled).astype(np.uint8)
    if np.any(codes == NO_DATA_SENTINEL):
        raise SystemExit(
            f"a real depth encoded to the sentinel byte ({NO_DATA_SENTINEL}) -- "
            f"raise ENCODE_MAX_KM above the grid's true max depth"
        )
    byte[valid] = codes
    return byte


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nlon", type=int, default=DEFAULT_NLON)
    ap.add_argument("--nlat", type=int, default=DEFAULT_NLAT)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "archive")
    ap.add_argument("--validate", action="store_true")
    args = ap.parse_args()

    print("fetching    SRTM15 earth_relief (01d, gridline) via pygmt.datasets.load_earth_relief")
    elev_m, lon, lat = load_and_resample(args.nlon, args.nlat)

    # elev_m: positive = land elevation, negative = ocean depth below sea
    # level. Ocean depth (km, positive-down) is what classifyLithology()
    # expects (matches ageToDepthKm()'s convention and the CCD Curve units).
    depth_km = np.where(elev_m < 0.0, -elev_m / 1000.0, np.nan)
    valid_frac = np.isfinite(depth_km).mean()
    print(f"resampled   {depth_km.shape}  valid (ocean) fraction {valid_frac:.3f}"
          f"  depth range [{np.nanmin(depth_km):.3f}, {np.nanmax(depth_km):.3f}] km")

    byte = encode(depth_km)

    model_dir = args.out / "models" / "bathymetry"
    frame_dir = model_dir / "frames" / "depth" / "std"
    frame_dir.mkdir(parents=True, exist_ok=True)
    out_path = frame_dir / "000.bin"
    byte.tofile(out_path)
    mb = out_path.stat().st_size / 1024 / 1024
    print(f"encoded     [0, {ENCODE_MAX_KM}] km -> uint8, sentinel={NO_DATA_SENTINEL}   {mb:.2f} MB")

    manifest = {
        "id": "bathymetry",
        "name": "Present-Day Bathymetry (SRTM15 / Tozer et al. 2019, via PyGMT earth_relief)",
        "type": "bathymetry",
        "source": "Tozer, B. et al. (2019), Global Bathymetry and Topography at 15 Arc Sec: "
                   "SRTM15+, Earth and Space Science -- fetched via pygmt.datasets.load_earth_relief "
                   "(resolution=01d, registration=gridline), resampled with grdsample. "
                   "See ADR-0008: replaces GDH1-synthetic depth for the Present-Day Lithology Map "
                   "(ADR-0006); GDH1 (ageToDepthKm in src/lithology.ts) remains the depth model for "
                   "Phase 2's through-time reconstruction, where no observed depth exists.",
        "lon_min": -180.0, "lon_max": 180.0,
        "lat_min": -90.0, "lat_max": 90.0,
        "dtype": "uint8",
        "no_data_sentinel": NO_DATA_SENTINEL,
        "default_resolution": "std",
        "resolutions": [{"id": "std", "nlon": args.nlon, "nlat": args.nlat, "ndepth": 1}],
        "frames": [{"id": "000", "age_ma": 0}],
        "path_template": "frames/{variable}/{resolution}/{frame}.bin",
        "default_variable": "depth",
        "variables": [{
            "id": "depth",
            "name": "Ocean Depth",
            "units": "km",
            "diverging": False,
            "encode_min": 0.0,
            "encode_max": ENCODE_MAX_KM,
            "value_min": 0.0,
            "value_max": round(float(np.nanmax(depth_km)), 3),
        }],
    }
    (model_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"wrote       {model_dir / 'manifest.json'}")

    if args.validate:
        back = np.fromfile(out_path, dtype=np.uint8).reshape(args.nlat, args.nlon)
        valid = back != NO_DATA_SENTINEL
        phys = back[valid].astype(np.float32) / 255.0 * ENCODE_MAX_KM
        print(f"validate    {back.size} bytes, {valid.mean():.3f} valid fraction, "
              f"decoded range [{phys.min():.3f}, {phys.max():.3f}] km")

    return manifest


if __name__ == "__main__":
    main()
