"""
ADR-0013: Option B (fitted classifier, as-is) vs Option A (+ smooth,
Diesing-informed equatorial Radiolarian belt) -- both computed from the
real deployed code (grid.json / grid_belt.json, via compute_grid.mjs /
compute_grid_belt.mjs). Confirms the belt is gradational (fades smoothly,
no hard cutoff) and confined to the equatorial band -- not a blanket
change to the whole map.
"""
import json

import numpy as np
import pygmt
import xarray as xr

fitted = json.load(open('grid.json'))
belt = json.load(open('grid_belt.json'))
nlon, nlat = fitted['nlon'], fitted['nlat']
c_fitted = np.array(fitted['classes'], dtype=np.uint8).reshape(nlat, nlon)
c_belt = np.array(belt['classes'], dtype=np.uint8).reshape(nlat, nlon)

lon = np.linspace(-180.0, 180.0, nlon, endpoint=False)
lat = np.linspace(-90.0, 90.0, nlat)

# Diff layer: 0=unchanged, 1=clay->siliceous-ooze, 2=clay->carbonate-ooze, 3=other change
diff = np.zeros_like(c_fitted, dtype=np.float32)
diff[:] = np.nan
changed = (c_fitted != c_belt) & (c_fitted != 255) & (c_belt != 255)
diff[(c_fitted == 0) & (c_belt == 2)] = 1
diff[(c_fitted == 0) & (c_belt == 1)] = 2
other = changed & np.isnan(diff)
diff[other] = 3
da = xr.DataArray(diff, coords=[('lat', lat), ('lon', lon)])

DIFF_NAMES = {1: 'clay -> siliceous-ooze', 2: 'clay -> carbonate-ooze', 3: 'other change'}
DIFF_COLORS = {1: '51/170/85', 2: '102/153/204', 3: '204/102/204'}

fig = pygmt.Figure()
pygmt.makecpt(cmap=','.join(DIFF_COLORS[k] for k in sorted(DIFF_COLORS)), series=[0.5, 3.5, 1])
fig.basemap(region='d', projection='R0/25c',
            frame=['af', '+tADR-0013 Option A vs Option B: cells that change class (equatorial Radiolarian belt)'])
fig.grdimage(grid=da, cmap=True, nan_transparent=True)
fig.coast(land='gray70', shorelines='0.3p,gray30')

y0 = -80
for i, k in enumerate(sorted(DIFF_NAMES)):
    x = -90 + i * 70
    fig.plot(x=[x], y=[y0], style='s0.35c', fill=DIFF_COLORS[k], pen='0.5p,black')
    fig.text(x=x + 4, y=y0, text=DIFF_NAMES[k], font='9p', justify='ML', no_clip=True)

fig.savefig('02-option-a-vs-option-b-diff.png', dpi=200)
print('wrote 02-option-a-vs-option-b-diff.png')
print('cells changed:', int(changed.sum()), '/', int((c_fitted != 255).sum()), 'mapped cells')
