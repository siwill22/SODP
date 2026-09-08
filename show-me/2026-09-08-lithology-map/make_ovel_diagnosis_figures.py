#!/usr/bin/env python3
"""Figures for the OVEL-sign investigation (README.md's "Is the pattern too
dominated by upwelling/downwelling?" section). Two claims, two figures:

  06: "the Clay class is exactly the OVEL<=0 mask, and 54% of those clay
      cells sit above the CCD" -- shown spatially, so WHERE this happens is
      checkable, not just the aggregate percentage.
  07: "no single global OVEL threshold reconciles Atlantic and Pacific" --
      shown as the actual swept curves (sweep_ovel_threshold.py's output),
      not asserted from the summary table alone.

Reads lithology_grid.json (real classifyLithology() output) and
ovel_threshold_sweep.json (sweep_ovel_threshold.py's output) -- both
already on disk, nothing re-derived here.
"""
import json

import matplotlib.pyplot as plt
import numpy as np
import pygmt
import xarray as xr

HERE = __file__.rsplit('/', 1)[0]
g = json.load(open(f"{HERE}/lithology_grid.json"))
nlon, nlat = g["nlon"], g["nlat"]
classes = np.array(g["classes"], dtype=np.uint8).reshape(nlat, nlon)
depth = np.array(g["oceanDepthKm"], dtype=np.float32).reshape(nlat, nlon)
ccd = np.array(g["ccdKmUsed"], dtype=np.float32).reshape(nlat, nlon)
lon = np.linspace(-180.0, 180.0, nlon, endpoint=False)
lat = np.linspace(-90.0, 90.0, nlat)

# ---------------------------------------------------------------------------
# Figure 6: clay cells, split by whether they sit above or below the CCD.
# "Above CCD" clay cells are ones a depth-first rule would instead call
# Carbonate Ooze -- the 54% figure quoted in the README, shown spatially.
# ---------------------------------------------------------------------------
clay = classes == 0
above_ccd = depth < ccd
split = np.full((nlat, nlon), np.nan, dtype=np.float32)
split[clay & above_ccd] = 1.0   # clay but above CCD -- disputed
split[clay & ~above_ccd] = 2.0  # clay and below CCD -- undisputed either way

frac_disputed = np.nansum(split == 1.0) / np.nansum(np.isfinite(split)) * 100

da_split = xr.DataArray(split, coords=[("lat", lat), ("lon", lon)])
fig = pygmt.Figure()
pygmt.makecpt(cmap="darkorange,steelblue", series=[0.5, 2.5, 1])
fig.grdimage(grid=da_split, projection="R14c", region="d", cmap=True, nan_transparent=True)
fig.coast(land="grey85", shorelines="0.3p,black", area_thresh=5000)
fig.basemap(frame=["a", f"+tClay cells split by CCD position ({frac_disputed:.0f}% of all Clay sits ABOVE the CCD)"])
for label, color in [("Clay ABOVE CCD -- disputed", "darkorange"),
                      ("Clay below CCD -- undisputed", "steelblue")]:
    fig.plot(x=[0], y=[-89.9], style="s0.4c", fill=color, pen="0.5p,black", label=label)
fig.legend(position="JBR+jBR+o0.3c", box="+gwhite+p0.5p")
fig.savefig(f"{HERE}/06-clay-above-vs-below-ccd.png", dpi=200)
print(f"wrote 06-clay-above-vs-below-ccd.png ({frac_disputed:.1f}% of clay is above-CCD/disputed)")

# ---------------------------------------------------------------------------
# Figure 7: the OVEL threshold sweep itself -- does any single global
# threshold reconcile all three basins with their real-world carbonate
# fractions simultaneously?
# ---------------------------------------------------------------------------
sweep = json.load(open(f"{HERE}/ovel_threshold_sweep.json"))
thresholds = np.array(sweep["thresholds"])
REAL_CARB = {"Atlantic": 60, "Pacific": 15, "Indian": 30}
COLORS = {"Atlantic": "#4477aa", "Pacific": "#ee6677", "Indian": "#ccbb44"}

fig2, ax = plt.subplots(figsize=(8, 5.5))
for name in ["Atlantic", "Pacific", "Indian"]:
    y = [bc[name] for bc in sweep["basin_carb"]]
    ax.plot(thresholds, y, "-o", color=COLORS[name], label=f"{name} (model)", markersize=3)
    ax.axhline(REAL_CARB[name], color=COLORS[name], linestyle="--", alpha=0.5,
               label=f"{name} real (~{REAL_CARB[name]}%)")
ax.axvline(0, color="black", linestyle=":", alpha=0.6, label="current threshold (0, sign-only)")
ax.set_xlabel("OVEL threshold (cm/s) -- classify() uses `ovel <= threshold -> Clay`")
ax.set_ylabel("% of basin classified as Carbonate Ooze")
ax.set_title("No single global OVEL threshold hits all three basins at once\n"
              "(Atlantic's own optimum overshoots Pacific to ~39-44%; Indian never reaches 30% at any threshold)")
ax.legend(fontsize=8, ncol=2)
ax.grid(alpha=0.3)
fig2.tight_layout()
fig2.savefig(f"{HERE}/07-ovel-threshold-sweep.png", dpi=150)
print("wrote 07-ovel-threshold-sweep.png")
