"""
ADR-0020's validation check itself: compare predict_sediment_thickness.py's
predicted present-day sediment thickness against Straume et al. (2019)
GlobSed at the same points. Run predict_sediment_thickness.py first.

Usage:
    conda run -n pygmt17 python compare_to_globsed.py

Reads GlobSed.nc from the local pyBacktrack checkout (confirmed present
during design, see ADR-0020) -- not vendored into this repo.
"""
import argparse
import json
import os

import numpy as np
import pygmt
import xarray as xr
import matplotlib.pyplot as plt

HERE = os.path.dirname(__file__)
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
GLOBSED_PATH = "/Users/simon/GIT/pyBacktrack/pybacktrack/bundle_data/sediment_thickness/GlobSed.nc"

NLON_AGE, NLAT_AGE = 360, 181  # archive/models/basement-age's "std" resolution


def load_predictions(filename: str):
    with open(os.path.join(HERE, "data", filename)) as f:
        d = json.load(f)
    stride = d["stride"]
    pts = d["points"]
    lon = np.array([p["lon"] for p in pts])
    lat = np.array([p["lat"] for p in pts])
    pred_m = np.array([p["predicted_thickness_m"] for p in pts])
    basement_age = np.array([p["basement_age_ma"] for p in pts])
    point_index = np.arange(len(pts))
    return stride, lon, lat, pred_m, basement_age, point_index


def grid_index(lon, lat, nlon, nlat):
    """Inverse of predict_sediment_thickness.py's grid_lonlat()."""
    i = np.round((lon + 180) / 360 * nlon - 0.5).astype(int)
    j = np.round((lat + 90) / 180 * (nlat - 1)).astype(int)
    return i, j


BASIN_NAMES = {1: "Atlantic", 2: "Pacific", 3: "Indian"}


def load_basin_grid():
    """archive/models/basin-mask (NOAA WOA13, ADR-0008) -- same 360x181 grid
    as Basement Age. Returns a (nlat, nlon) uint8 array, 255 = no-data
    (Southern Ocean sectors, marginal seas, Arctic -- not just land)."""
    manifest_path = os.path.join(REPO_ROOT, "archive", "models", "basin-mask", "manifest.json")
    with open(manifest_path) as f:
        manifest = json.load(f)
    res = manifest["resolutions"][0]
    frame_path = os.path.join(
        REPO_ROOT, "archive", "models", "basin-mask",
        manifest["path_template"].replace("{variable}", manifest["default_variable"])
        .replace("{resolution}", res["id"]).replace("{frame}", manifest["frames"][0]["id"]),
    )
    with open(frame_path, "rb") as f:
        raw = np.frombuffer(f.read(), dtype=np.uint8)
    return raw.reshape(res["nlat"], res["nlon"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="predicted_thickness.json",
                     help="filename under data/ to load predictions from")
    ap.add_argument("--prefix", default="", help="prefix for output figure filenames, e.g. 'corrected-'")
    ap.add_argument("--test-only", action="store_true",
                     help="restrict to the held-out TEST half (odd point index) -- the honest split "
                          "when --input was produced WITH --lat-correction, since that correction "
                          "was fit on the even-index TRAIN half only")
    ap.add_argument("--title-suffix", default="", help="appended to figure titles, e.g. ' (test half, corrected)'")
    args = ap.parse_args()

    stride, lon, lat, pred_m, basement_age, point_index = load_predictions(args.input)
    print(f"{len(lon)} predicted points, stride={stride}, source={args.input}")

    print("Loading GlobSed.nc (Straume et al. 2019)...")
    globsed = xr.open_dataset(GLOBSED_PATH)["z"]  # metres, (lat, lon), -90..90 / -180..180

    # Sample GlobSed at each predicted point (nearest-neighbour -- GlobSed's
    # 5-arcmin grid is far finer than our stride>=1deg prediction grid).
    globsed_m = globsed.sel(
        lat=xr.DataArray(lat, dims="points"), lon=xr.DataArray(lon, dims="points"), method="nearest",
    ).values

    print("Loading basin mask (NOAA WOA13, ADR-0008)...")
    basin_grid = load_basin_grid()
    i_idx, j_idx = grid_index(lon, lat, NLON_AGE, NLAT_AGE)
    i_idx = np.clip(i_idx, 0, NLON_AGE - 1)
    j_idx = np.clip(j_idx, 0, NLAT_AGE - 1)
    basin_code = basin_grid[j_idx, i_idx]

    valid = np.isfinite(globsed_m) & np.isfinite(pred_m)
    if args.test_only:
        valid = valid & (point_index % 2 == 1)
        print(f"Restricted to held-out TEST half (odd point index)")
    print(f"{valid.sum()} points with both a prediction and a GlobSed value")

    pred_v, obs_v, age_v, basin_v = pred_m[valid], globsed_m[valid], basement_age[valid], basin_code[valid]
    log_pred = np.log10(np.clip(pred_v, 1, None))
    log_obs = np.log10(np.clip(obs_v, 1, None))
    log_ratio = log_pred - log_obs  # >0: over-predict, <0: under-predict
    r = np.corrcoef(log_pred, log_obs)[0, 1]
    bias_m = np.median(pred_v - obs_v)
    ratio = np.median(pred_v / np.clip(obs_v, 1, None))
    print(f"log10-space Pearson r = {r:.3f}")
    print(f"median(predicted - GlobSed) = {bias_m:.0f} m")
    print(f"median(predicted / GlobSed) = {ratio:.3f}x")

    # -----------------------------------------------------------------------
    # Spatial breakdown of the mismatch: by ocean basin and by latitude band.
    # -----------------------------------------------------------------------
    print("\nBy basin (median predicted/observed ratio):")
    for code, name in BASIN_NAMES.items():
        m = basin_v == code
        if m.sum() > 20:
            print(f"  {name:10s} n={m.sum():5d}  median ratio={10 ** np.median(log_ratio[m]):.2f}x  "
                  f"log10 r={np.corrcoef(log_pred[m], log_obs[m])[0, 1]:.2f}")

    print("\nBy |latitude| band (median predicted/observed ratio):")
    abslat_v = np.abs(lat[valid])
    for lo, hi in [(0, 15), (15, 30), (30, 45), (45, 60), (60, 90)]:
        m = (abslat_v >= lo) & (abslat_v < hi)
        if m.sum() > 20:
            print(f"  [{lo:2d},{hi:2d}) n={m.sum():5d}  median ratio={10 ** np.median(log_ratio[m]):.2f}x")

    print("\nBy Basement Age band (median predicted/observed ratio) -- tests the")
    print("'accumulated hiatus' hypothesis: ratio should grow with age if so.")
    for lo, hi in [(0, 20), (20, 50), (50, 100), (100, 150), (150, 340)]:
        m = (age_v >= lo) & (age_v < hi)
        if m.sum() > 20:
            print(f"  [{lo:3d},{hi:3d}) Ma n={m.sum():5d}  median ratio={10 ** np.median(log_ratio[m]):.2f}x")

    # -----------------------------------------------------------------------
    # Figure 1: predicted vs. GlobSed correlation, log-log, 1:1 reference.
    # -----------------------------------------------------------------------
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.scatter(obs_v, pred_v, s=6, alpha=0.35, color="#2a6f97", edgecolors="none")
    lims = [1, max(obs_v.max(), pred_v.max()) * 1.2]
    ax.plot(lims, lims, color="#333333", linestyle="--", linewidth=1, label="1:1")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlim(lims)
    ax.set_ylim(lims)
    ax.set_xlabel("GlobSed observed sediment thickness (m)")
    ax.set_ylabel("Predicted sediment thickness (m)")
    ax.set_title(
        f"Claim: the Sedimentation Rate model reproduces real global\n"
        f"sediment thickness (n={valid.sum()}, log10 r={r:.2f}){args.title_suffix}",
        fontsize=11,
    )
    ax.legend(fontsize=8)
    plt.tight_layout()
    plt.savefig(os.path.join(HERE, f"{args.prefix}01-predicted-vs-globsed-scatter.png"), dpi=150)
    plt.close()

    # -----------------------------------------------------------------------
    # Figures 2/3: global maps, predicted and GlobSed-at-same-points, same
    # colour scale -- reconstructed as a regular (stride) grid so pygmt can
    # grdimage it, same convention as show-me/2026-09-08-lithology-map.
    # -----------------------------------------------------------------------
    js = list(range(0, NLAT_AGE, stride))
    is_ = list(range(0, NLON_AGE, stride))
    nrow, ncol = len(js), len(is_)
    pred_grid = np.full((nrow, ncol), np.nan)
    obs_grid = np.full((nrow, ncol), np.nan)
    ratio_grid = np.full((nrow, ncol), np.nan)  # log10(pred/obs), only where both exist

    row = j_idx // stride
    col = i_idx // stride
    in_bounds = (row >= 0) & (row < nrow) & (col >= 0) & (col < ncol)
    pred_grid[row[in_bounds], col[in_bounds]] = pred_m[in_bounds]
    obs_grid[row[in_bounds], col[in_bounds]] = np.where(
        np.isfinite(globsed_m[in_bounds]), globsed_m[in_bounds], np.nan,
    )
    both = in_bounds & valid
    ratio_grid[row[both], col[both]] = (
        np.log10(np.clip(pred_m[both], 1, None)) - np.log10(np.clip(globsed_m[both], 1, None))
    )

    grid_lon = ((np.array(is_) + 0.5) / NLON_AGE) * 360 - 180
    grid_lat = (np.array(js) / (NLAT_AGE - 1)) * 180 - 90

    def da(arr):
        return xr.DataArray(arr, coords=[("lat", grid_lat), ("lon", grid_lon)])

    vmax = float(np.nanpercentile(np.concatenate([pred_grid[np.isfinite(pred_grid)],
                                                    obs_grid[np.isfinite(obs_grid)]]), 95))

    for arr, title, fname in [
        (pred_grid, f"Predicted present-day sediment thickness (Sedimentation Rate model){args.title_suffix}",
         "02-predicted-thickness-map.png"),
        (obs_grid, "GlobSed (Straume et al. 2019) observed sediment thickness, same points",
         "03-globsed-thickness-map.png"),
    ]:
        fig = pygmt.Figure()
        pygmt.makecpt(cmap="viridis", series=[0, vmax], continuous=True)
        fig.grdimage(grid=da(arr), projection="R14c", region="d", cmap=True, nan_transparent=True)
        fig.coast(land="grey85", shorelines="0.3p,black", area_thresh=5000)
        fig.colorbar(frame=["x+lSediment thickness (m)"])
        fig.basemap(frame=["a", f"+t{title}"])
        fig.savefig(os.path.join(HERE, f"{args.prefix}{fname}"), dpi=200)

    # -----------------------------------------------------------------------
    # Figure 4: the difference map itself -- log10(predicted/GlobSed),
    # diverging, centred on 0 (perfect agreement). Same "polar" diverging
    # convention as show-me/2026-09-08-lithology-map's depth-minus-CCD figure.
    # Clipped to +-1 (100x) -- a handful of near-zero-GlobSed points near
    # ridges produce extreme ratios that would otherwise wash out the scale.
    # -----------------------------------------------------------------------
    lim = 1.0
    fig = pygmt.Figure()
    pygmt.makecpt(cmap="polar", series=[-lim, lim], continuous=True)
    fig.grdimage(grid=da(np.clip(ratio_grid, -lim, lim)), projection="R14c", region="d",
                 cmap=True, nan_transparent=True)
    fig.coast(land="grey85", shorelines="0.3p,black", area_thresh=5000)
    fig.colorbar(frame=["x+llog10(predicted / GlobSed) -- blue=under-predict, red=over-predict"])
    fig.basemap(frame=["a", f"+tOver- vs under-predict?{args.title_suffix}"])
    fig.savefig(os.path.join(HERE, f"{args.prefix}04-log-ratio-difference-map.png"), dpi=200)

    print(f"Wrote {args.prefix}01..04 figures")


if __name__ == "__main__":
    main()
