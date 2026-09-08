#!/usr/bin/env python3
"""Resample the Seton et al. (2020) seafloor age grid into a static web grid.

ADR-0004: this is the one dataset SODP hosts itself rather than fetching from
Geode's live archive -- Geode has no basement-age model at all. Output uses
the exact same Manifest/Volume shape Geode's own core/volume.ts already
reads (see Geode's prep/prep_model.py), so the viewer side needs no new
parsing logic, just a new modelId to point at -- ADR-0001's whole premise.

Unlike prep_model.py, this is deliberately NOT built as a generic multi-model
CLI: it serves exactly one source (Seton et al. 2020), so there is no
--var/--colormap/--high-means flag surface to replicate. Also unlike
prep_model.py's fill_nan(), NaN here is never filled -- it means "not
oceanic crust" (land), a real answer, not missing data to patch over. It is
carried through as the Manifest's no_data_sentinel byte instead, the same
mechanism Geode's own core/volume.ts and core/queryPoint.ts already know how
to skip (see queryPoint.ts's isInvalid()).

Output:
  archive/models/basement-age/manifest.json
  archive/models/basement-age/frames/age/std/000.bin

Usage:
    python prep_basement_age.py --input /path/to/age.2020.1.GeeK2007.2m.nc
"""

import argparse
import json
from pathlib import Path

import numpy as np
import xarray as xr
from scipy.interpolate import interp1d

DEFAULT_NLON = 360
DEFAULT_NLAT = 181
NO_DATA_SENTINEL = 255
# Round number safely above the grid's real max (338.68 Ma when this was
# written) so real ages never encode to 255 and collide with the sentinel --
# see encode() below.
ENCODE_MAX_MA = 340.0


def load(path: Path):
    ds = xr.open_dataset(path)
    z = np.asarray(ds["z"].values, dtype=np.float64)  # (lat, lon), NaN over land
    lon = np.asarray(ds["lon"].values, dtype=np.float64)
    lat = np.asarray(ds["lat"].values, dtype=np.float64)
    ds.close()

    if lat[0] > lat[-1]:
        lat, z = lat[::-1], z[::-1]

    # Grid ships both -180 and +180 (a duplicate seam) -- see
    # prep_model.py's drop_duplicate_seam() for the identical reasoning: the
    # volume texture wraps on S, which assumes column 0 and column nlon are
    # one step apart, not coincident.
    if len(lon) > 1 and abs((lon[-1] - lon[0]) - 360.0) < 1e-6:
        lon, z = lon[:-1], z[:, :-1]

    return z, lon, lat


def resample(z, lon, lat, nlon, nlat):
    """Linear resample onto a regular nlon x nlat grid.

    NaN (land) propagates through linear interpolation -- a coastal target
    cell that lands between a real ocean sample and a NaN land sample comes
    out NaN too, which is the safe outcome (an uncertain coastal cell becomes
    no-data rather than a fabricated blended age).
    """
    tlon = np.linspace(-180.0, 180.0, nlon, endpoint=False)
    tlat = np.linspace(-90.0, 90.0, nlat)

    lon_p = np.append(lon, lon[0] + 360.0)
    z_p = np.concatenate([z, z[:, :1]], axis=1)
    f_lon = interp1d(lon_p, z_p, axis=1, kind="linear", bounds_error=False)
    z = f_lon(tlon)

    f_lat = interp1d(lat, z, axis=0, kind="linear", bounds_error=False)
    z = f_lat(tlat)

    return z, tlon, tlat


def encode(z):
    valid = np.isfinite(z)
    byte = np.full(z.shape, NO_DATA_SENTINEL, dtype=np.uint8)
    scaled = np.clip(z[valid] / ENCODE_MAX_MA, 0.0, 1.0) * 255.0
    codes = np.round(scaled).astype(np.uint8)
    if np.any(codes == NO_DATA_SENTINEL):
        raise SystemExit(
            f"a real age encoded to the sentinel byte ({NO_DATA_SENTINEL}) -- "
            f"raise ENCODE_MAX_MA above the grid's true max age"
        )
    byte[valid] = codes
    return byte


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", type=Path, required=True)
    ap.add_argument("--nlon", type=int, default=DEFAULT_NLON)
    ap.add_argument("--nlat", type=int, default=DEFAULT_NLAT)
    ap.add_argument("--out", type=Path, default=Path("archive"))
    ap.add_argument("--validate", action="store_true")
    args = ap.parse_args()

    print(f"loading     {args.input}")
    z, lon, lat = load(args.input)
    valid_frac = np.isfinite(z).mean()
    print(f"native      {z.shape}  valid (ocean) fraction {valid_frac:.3f}"
          f"  age range [{np.nanmin(z):.2f}, {np.nanmax(z):.2f}] Ma")

    z, lon, lat = resample(z, lon, lat, args.nlon, args.nlat)
    resampled_valid_frac = np.isfinite(z).mean()
    print(f"resampled   {z.shape}  valid (ocean) fraction {resampled_valid_frac:.3f}")

    byte = encode(z)

    model_dir = args.out / "models" / "basement-age"
    frame_dir = model_dir / "frames" / "age" / "std"
    frame_dir.mkdir(parents=True, exist_ok=True)
    out_path = frame_dir / "000.bin"
    byte.tofile(out_path)
    mb = out_path.stat().st_size / 1024 / 1024
    print(f"encoded     [0, {ENCODE_MAX_MA}] Ma -> uint8, sentinel={NO_DATA_SENTINEL}   {mb:.2f} MB")

    manifest = {
        "id": "basement-age",
        "name": "Basement Age (Seton et al. 2020)",
        "type": "basement-age",
        "source": "Seton, M. et al. (2020), A global data set of present-day oceanic crustal "
                   "age and seafloor spreading parameters, Geochemistry, Geophysics, Geosystems "
                   "(age.2020.1.GeeK2007 grid)",
        "lon_min": -180.0, "lon_max": 180.0,
        "lat_min": -90.0, "lat_max": 90.0,
        "dtype": "uint8",
        "no_data_sentinel": NO_DATA_SENTINEL,
        "default_resolution": "std",
        "resolutions": [{"id": "std", "nlon": args.nlon, "nlat": args.nlat, "ndepth": 1}],
        "frames": [{"id": "000", "age_ma": 0}],
        "path_template": "frames/{variable}/{resolution}/{frame}.bin",
        "default_variable": "age",
        "variables": [{
            "id": "age",
            "name": "Basement Age",
            "units": "Ma",
            "diverging": False,
            "encode_min": 0.0,
            "encode_max": ENCODE_MAX_MA,
            "value_min": 0.0,
            "value_max": round(float(np.nanmax(z)), 3),
        }],
    }
    (model_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"wrote       {model_dir / 'manifest.json'}")

    if args.validate:
        back = np.fromfile(out_path, dtype=np.uint8).reshape(args.nlat, args.nlon)
        valid = back != NO_DATA_SENTINEL
        phys = back[valid].astype(np.float32) / 255.0 * ENCODE_MAX_MA
        print(f"validate    {back.size} bytes, {valid.mean():.3f} valid fraction, "
              f"decoded range [{phys.min():.2f}, {phys.max():.2f}] Ma")

    return manifest


if __name__ == "__main__":
    main()
