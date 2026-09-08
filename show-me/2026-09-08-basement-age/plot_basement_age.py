import json
import numpy as np
import xarray as xr
import pygmt

root = "/Users/simon/GIT/SODP/archive/models/basement-age"
manifest = json.load(open(f"{root}/manifest.json"))
res = manifest["resolutions"][0]
nlon, nlat = res["nlon"], res["nlat"]
var = manifest["variables"][0]
sentinel = manifest["no_data_sentinel"]

byte = np.fromfile(f"{root}/frames/age/std/000.bin", dtype=np.uint8).reshape(nlat, nlon)
age = byte.astype(np.float32) / 255.0 * var["encode_max"]
age[byte == sentinel] = np.nan

lon = np.linspace(-180.0, 180.0, nlon, endpoint=False)
lat = np.linspace(-90.0, 90.0, nlat)

da = xr.DataArray(age, coords=[("lat", lat), ("lon", lon)], name="age_ma")

fig = pygmt.Figure()
pygmt.makecpt(cmap="batlow", series=[0, 340, 1], continuous=True)
fig.grdimage(grid=da, projection="R12c", region="d", cmap=True, nan_transparent=True)
fig.coast(shorelines="0.3p,black", area_thresh=5000)
fig.colorbar(frame=["x+lBasement age", "y+lMa"])
fig.basemap(frame=["a"])
out = "/Users/simon/GIT/SODP/show-me/scratch/basement_age.png"
fig.savefig(out, dpi=200)
print("wrote", out)
