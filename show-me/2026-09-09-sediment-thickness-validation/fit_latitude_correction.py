"""
Fits lithology_model.py's EXPERIMENTAL `_LAT_CORRECTION_CENTERS`/
`_LAT_CORRECTION_LOG10` table -- a |latitude|-banded multiplicative
correction to the flat Sedimentation Rate, fit directly against this
folder's own baseline GlobSed residual (data/predicted_thickness.json,
run WITHOUT --lat-correction first).

Fit on the deterministic TRAIN half only (even point index) -- same
"don't grade a fit on the data it was fit to" discipline ADR-0011 used for
the Lithology Class classifier itself. The held-out TEST half (odd point
index) is what compare_to_globsed.py --test-only reports on.

This script only PRINTS the fitted table (to copy into lithology_model.py
by hand, same "fit in Python, hand-copy the result" pattern this project
already uses for the classifier coefficients) -- it does not write files.

Usage:
    conda run -n pygmt17 python predict_sediment_thickness.py --stride 2   # baseline, if not already run
    conda run -n pygmt17 python fit_latitude_correction.py
"""
import json
import os

import numpy as np
import xarray as xr

HERE = os.path.dirname(__file__)
GLOBSED_PATH = "/Users/simon/GIT/pyBacktrack/pybacktrack/bundle_data/sediment_thickness/GlobSed.nc"
BIN_EDGES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
MIN_POINTS_PER_BIN = 20


def main():
    with open(os.path.join(HERE, "data", "predicted_thickness.json")) as f:
        d = json.load(f)
    pts = d["points"]
    lon = np.array([p["lon"] for p in pts])
    lat = np.array([p["lat"] for p in pts])
    pred = np.array([p["predicted_thickness_m"] for p in pts])
    idx = np.arange(len(pts))

    globsed = xr.open_dataset(GLOBSED_PATH)["z"]
    obs = globsed.sel(
        lat=xr.DataArray(lat, dims="points"), lon=xr.DataArray(lon, dims="points"), method="nearest",
    ).values

    valid = np.isfinite(obs) & np.isfinite(pred)
    train = valid & (idx % 2 == 0)
    print(f"train n={train.sum()} (of {valid.sum()} valid, {len(pts)} total)")

    log_ratio = np.log10(np.clip(pred, 1, None)) - np.log10(np.clip(obs, 1, None))
    abslat = np.abs(lat)

    centers, log10_mult = [], []
    for lo, hi in zip(BIN_EDGES[:-1], BIN_EDGES[1:]):
        m = train & (abslat >= lo) & (abslat < hi)
        if m.sum() < MIN_POINTS_PER_BIN:
            print(f"  |lat| [{lo:2d},{hi:2d}) n={m.sum()} -- too few points, skipped")
            continue
        med = np.median(log_ratio[m])
        centers.append((lo + hi) / 2)
        log10_mult.append(round(-med, 4))
        print(f"  |lat| [{lo:2d},{hi:2d}) n={m.sum():4d}  median log_ratio={med:+.3f}  "
              f"-> rate multiplier {10 ** -med:.3f}x")

    print("\nCopy into lithology_model.py:")
    print(f"_LAT_CORRECTION_CENTERS = {centers}")
    print(f"_LAT_CORRECTION_LOG10 = {log10_mult}")


if __name__ == "__main__":
    main()
