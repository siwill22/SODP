#!/usr/bin/env python3
"""Figures testing whether src/lithology.ts's 3-class rule (ADR-0007)
reproduces the real-world present-day deep-sea sediment distribution.
Reads lithology_grid.json, written by compute_lithology.mjs from the REAL
app logic (src/lithology.ts) run against real data -- nothing here
re-derives the classification itself.

Usage:
    conda run -n pygmt17 python make_figures.py
"""
import json

import numpy as np
import pygmt
import xarray as xr

HERE = __file__.rsplit('/', 1)[0]
grid = json.load(open(f"{HERE}/lithology_grid.json"))

nlon, nlat = grid["nlon"], grid["nlat"]
classes = np.array(grid["classes"], dtype=np.uint8).reshape(nlat, nlon)
depth = np.array(grid["oceanDepthKm"], dtype=np.float32).reshape(nlat, nlon)
ovel = np.array(grid["ovelCmS"], dtype=np.float32).reshape(nlat, nlon)
ccd_used = np.array(grid["ccdKmUsed"], dtype=np.float32).reshape(nlat, nlon)
basin_code = np.array(grid["basinCode"], dtype=np.uint8).reshape(nlat, nlon)
global_ccd_km = grid["globalCcdKm"]
NO_DATA = grid["noDataSentinel"]

lon = np.linspace(-180.0, 180.0, nlon, endpoint=False)
lat = np.linspace(-90.0, 90.0, nlat)


def da(arr):
    return xr.DataArray(arr, coords=[("lat", lat), ("lon", lon)])


# ---------------------------------------------------------------------------
# Figure 1: the 3-class Lithology Map itself -- the main claim under test.
# ---------------------------------------------------------------------------
class_f = classes.astype(np.float32)
class_f[classes == NO_DATA] = np.nan
class_da = da(class_f)

fig = pygmt.Figure()
pygmt.makecpt(cmap="steelblue,gold,seagreen", series=[0, 3, 1])
fig.grdimage(grid=class_da, projection="R14c", region="d", cmap=True, nan_transparent=True)
fig.coast(land="grey85", shorelines="0.3p,black", area_thresh=5000)
fig.basemap(frame=["a", "+tPresent-Day Lithology Map -- claim: reproduces known present-day sediment belts"])
for label, color in [("Clay", "steelblue"), ("Carbonate Ooze", "gold"), ("Siliceous Ooze", "seagreen")]:
    # single point at the pole, hidden under the land fill above -- legend
    # entries need a real (even if invisible) plotted feature to attach to.
    fig.plot(x=[0], y=[89.9], style="s0.4c", fill=color, pen="0.5p,black", label=label)
fig.legend(position="JBR+jBR+o0.3c", box="+gwhite+p0.5p")
fig.savefig(f"{HERE}/01-lithology-map.png", dpi=200)

# ---------------------------------------------------------------------------
# Figure 2: ocean depth (real bathymetry, ADR-0008) MINUS CCD (per-basin
# where available, else the global fallback -- ccdKmUsed) -- the component
# that decides carbonate ooze vs siliceous ooze. Diverging, centred on zero.
# ---------------------------------------------------------------------------
depth_minus_ccd = depth - ccd_used
dmc_da = da(depth_minus_ccd)

fig = pygmt.Figure()
lim = float(np.nanpercentile(np.abs(depth_minus_ccd), 98))
pygmt.makecpt(cmap="polar", series=[-lim, lim], continuous=True)
fig.grdimage(grid=dmc_da, projection="R12c", region="d", cmap=True, nan_transparent=True)
fig.coast(land="grey85", shorelines="0.3p,black", area_thresh=5000)
fig.colorbar(frame=["x+lReal bathymetry minus CCD (km)"])
fig.basemap(frame=["a", "+tDepth relative to CCD (negative=above/preserved, positive=below/dissolved)"])
fig.savefig(f"{HERE}/02-depth-minus-ccd.png", dpi=200)

# ---------------------------------------------------------------------------
# Figure 3: OVEL sign -- the productivity threshold, entirely unweighted
# (ADR-0007: no magnitude cutoff, just upwelling vs downwelling).
# ---------------------------------------------------------------------------
ovel_sign = np.where(np.isnan(ovel), np.nan, np.where(ovel > 0, 1.0, 0.0))
ovel_da = da(ovel_sign)

fig = pygmt.Figure()
pygmt.makecpt(cmap="lightgrey,orangered", series=[0, 2, 1])
fig.grdimage(grid=ovel_da, projection="R12c", region="d", cmap=True, nan_transparent=True)
fig.coast(land="grey85", shorelines="0.3p,black", area_thresh=5000)
fig.basemap(frame=["a", "+tOVEL sign -- grey=downwelling (oligotrophic), orange=upwelling (productive)"])
fig.savefig(f"{HERE}/03-ovel-sign.png", dpi=200)

# ---------------------------------------------------------------------------
# Figure 4: basin mask actually used to pick per-basin CCD (ADR-0008) --
# lets figure 2's patchwork of CCD values be checked against a real map,
# not asserted.
# ---------------------------------------------------------------------------
basin_f = basin_code.astype(np.float32)
basin_f[basin_code == NO_DATA] = np.nan
basin_da = da(basin_f)

fig = pygmt.Figure()
pygmt.makecpt(cmap="steelblue,seagreen,gold", series=[0.5, 3.5, 1])
fig.grdimage(grid=basin_da, projection="R14c", region="d", cmap=True, nan_transparent=True)
fig.coast(land="grey85", shorelines="0.3p,black", area_thresh=5000)
fig.basemap(frame=["a", "+tBasin mask driving per-basin CCD (grey/white = global-fallback CCD used instead)"])
for label, color in [("Atlantic (5.00 km)", "steelblue"), ("Pacific (4.35 km)", "seagreen"), ("Indian (4.30 km)", "gold")]:
    fig.plot(x=[0], y=[89.9], style="s0.4c", fill=color, pen="0.5p,black", label=label)
fig.legend(position="JBR+jBR+o0.3c", box="+gwhite+p0.5p")
fig.savefig(f"{HERE}/04-basin-mask-used.png", dpi=200)

print("wrote 4 figures")
print(f"global fallback CCD: {global_ccd_km} km; per-basin CCD range used: "
      f"[{np.nanmin(ccd_used):.2f}, {np.nanmax(ccd_used):.2f}] km")
print(f"depth-minus-CCD range: [{np.nanmin(depth_minus_ccd):.2f}, {np.nanmax(depth_minus_ccd):.2f}] km")
print(f"OVEL>0 (productive) fraction of valid cells: {np.nanmean(ovel_sign):.3f}")
