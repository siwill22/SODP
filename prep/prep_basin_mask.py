#!/usr/bin/env python3
"""Resample the NOAA WOA13 ocean-basin mask into the same static web grid
shape as basement-age/bathymetry.

Why this exists: ADR-0005 deliberately used a single global CCD value for
v1 ("no basin differentiation"), and the Present-Day Lithology Map
(ADR-0006) exposed exactly the cost of that: a single global CCD flattens
the real, large Atlantic (~60% carbonate)/Pacific (~15%) contrast the CCD
Curve sources (Van Andel 1975, Pälike 2012, Dutkiewicz & Müller 2021)
already disagree about by basin. ADR-0008 replaces the single global CCD
with a per-basin CCD (ccdKmForBasin() in src/lithology.ts) for the
present-day map, which needs a basin label at every grid cell -- this is
that label.

Source: NOAA WOA13 basin mask (data/basins/basinmask_01.msk), a real
1-degree-resolution objective-analysis basin classification, not a guess or
a longitude-band heuristic (see show-me/2026-09-08-lithology-map/
basin_diagnosis.py, which first showed a crude longitude-band mask was
misleading and switched to this real mask). Uses the surface (Basin_0m)
column only -- basin identity does not change with depth in a way that
matters for a single present-day CCD lookup.

Only codes 1 (Atlantic), 2 (Pacific), 3 (Indian) are kept -- the three
basins src/lithology.ts's ccdKmForBasin() has literature CCD values for.
Everything else (Southern Ocean sectors, marginal seas, Arctic, Hudson Bay,
etc.) is carried as no-data; classifyLithology() falls back to the single
global Published CCD Curve value there (see compute_lithology.mjs).

Output:
  archive/models/basin-mask/manifest.json
  archive/models/basin-mask/frames/basin/std/000.bin

Usage:
    python prep_basin_mask.py --input ../data/basins/basinmask_01.msk
"""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

DEFAULT_NLON = 360
DEFAULT_NLAT = 181
NO_DATA_SENTINEL = 255
# WOA13 basin codes kept -- see module doc. Re-coded 1:1 (values already fit
# in a byte and already match the codes used in the basin_diagnosis.py
# exploration this script formalizes).
KEEP_CODES = {1: "Atlantic", 2: "Pacific", 3: "Indian"}


def load(path: Path):
    df = pd.read_csv(path, skiprows=1)
    lat = np.sort(df["Latitude"].unique())
    lon = np.sort(df["Longitude"].unique())
    grid = df.pivot(index="Latitude", columns="Longitude", values="Basin_0m")
    grid = grid.reindex(index=lat, columns=lon)
    z = grid.values.astype(np.float64)  # NaN where no data (e.g. land, deep polar gaps)
    return z, lon, lat


def resample_nearest(z, lon, lat, nlon, nlat):
    """Nearest-neighbour resample -- basin identity is categorical, so linear
    interpolation (used for basement age) would invent nonsense codes at
    basin boundaries."""
    tlon = np.linspace(-180.0, 180.0, nlon, endpoint=False)
    tlat = np.linspace(-90.0, 90.0, nlat)

    lon_idx = np.clip(np.searchsorted(lon, tlon), 0, len(lon) - 1)
    # searchsorted can land one index low/high of the true nearest -- fix up.
    for i, lo in enumerate(tlon):
        j = lon_idx[i]
        if j > 0 and abs(lon[j - 1] - lo) < abs(lon[j] - lo):
            lon_idx[i] = j - 1
    lat_idx = np.clip(np.searchsorted(lat, tlat), 0, len(lat) - 1)
    for i, la in enumerate(tlat):
        j = lat_idx[i]
        if j > 0 and abs(lat[j - 1] - la) < abs(lat[j] - la):
            lat_idx[i] = j - 1

    return z[np.ix_(lat_idx, lon_idx)], tlon, tlat


def encode(basin_code):
    byte = np.full(basin_code.shape, NO_DATA_SENTINEL, dtype=np.uint8)
    for code in KEEP_CODES:
        byte[basin_code == code] = code
    return byte


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", type=Path,
                     default=Path(__file__).resolve().parent.parent / "data" / "basins" / "basinmask_01.msk")
    ap.add_argument("--nlon", type=int, default=DEFAULT_NLON)
    ap.add_argument("--nlat", type=int, default=DEFAULT_NLAT)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "archive")
    ap.add_argument("--validate", action="store_true")
    args = ap.parse_args()

    print(f"loading     {args.input}")
    z, lon, lat = load(args.input)
    native_counts = {name: int(np.sum(z == code)) for code, name in KEEP_CODES.items()}
    print(f"native      {z.shape}  basin cell counts (of {np.isfinite(z).sum()} valid): {native_counts}")

    z, lon, lat = resample_nearest(z, lon, lat, args.nlon, args.nlat)
    byte = encode(z)
    resampled_counts = {name: int(np.sum(byte == code)) for code, name in KEEP_CODES.items()}
    print(f"resampled   {byte.shape}  basin cell counts: {resampled_counts}")

    model_dir = args.out / "models" / "basin-mask"
    frame_dir = model_dir / "frames" / "basin" / "std"
    frame_dir.mkdir(parents=True, exist_ok=True)
    out_path = frame_dir / "000.bin"
    byte.tofile(out_path)
    print(f"encoded     categorical uint8 (1=Atlantic,2=Pacific,3=Indian), sentinel={NO_DATA_SENTINEL}")

    manifest = {
        "id": "basin-mask",
        "name": "Ocean Basin Mask (NOAA WOA13)",
        "type": "basin-mask",
        "source": "NOAA World Ocean Atlas 2013 basin mask (basinmask_01.msk), 1-degree objective-analysis "
                   "basin classification, surface (Basin_0m) column. Re-coded to keep only Atlantic(1)/"
                   "Pacific(2)/Indian(3); all other codes (Southern Ocean sectors, marginal seas, Arctic, "
                   "Hudson Bay, etc.) are no-data. See ADR-0008.",
        "lon_min": -180.0, "lon_max": 180.0,
        "lat_min": -90.0, "lat_max": 90.0,
        "dtype": "uint8",
        "no_data_sentinel": NO_DATA_SENTINEL,
        "default_resolution": "std",
        "resolutions": [{"id": "std", "nlon": args.nlon, "nlat": args.nlat, "ndepth": 1}],
        "frames": [{"id": "000", "age_ma": 0}],
        "path_template": "frames/{variable}/{resolution}/{frame}.bin",
        "default_variable": "basin",
        "variables": [{
            "id": "basin",
            "name": "Ocean Basin",
            "units": "code",
            "diverging": False,
            "encode_min": 0.0,
            "encode_max": 3.0,
            "value_min": 1.0,
            "value_max": 3.0,
            "classes": {"1": "Atlantic", "2": "Pacific", "3": "Indian"},
        }],
    }
    (model_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"wrote       {model_dir / 'manifest.json'}")

    if args.validate:
        back = np.fromfile(out_path, dtype=np.uint8).reshape(args.nlat, args.nlon)
        for code, name in KEEP_CODES.items():
            print(f"validate    {name}: {int(np.sum(back == code))} cells")

    return manifest


if __name__ == "__main__":
    main()
