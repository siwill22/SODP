"""
The present-day Lithology Class map produced by the REAL, currently
deployed production code (src/presentDayMap.ts), after ADR-0012 dropped
OVEL from the classifier -- classification now uses only
[oceanDepthKm - ccdKm, otempC]. grid.json was written by compute_grid.mjs,
which calls loadPresentDayInputs()/buildPresentDayGrid() directly -- no
reimplementation of the classifier here.
"""
import json

import numpy as np
import pygmt
import xarray as xr

grid = json.load(open('grid.json'))
nlon, nlat = grid['nlon'], grid['nlat']
classes = np.array(grid['classes'], dtype=np.uint8).reshape(nlat, nlon)

lon = np.linspace(-180.0, 180.0, nlon, endpoint=False)
lat = np.linspace(-90.0, 90.0, nlat)
da = xr.DataArray(classes.astype(np.float32), coords=[('lat', lat), ('lon', lon)])
da = da.where(classes != grid['noDataSentinel'])

CLASS_NAMES = {0: 'Clay', 1: 'Carbonate ooze', 2: 'Siliceous ooze'}
CLASS_COLORS = {0: '153/102/51', 1: '102/153/204', 2: '51/170/85'}

fig = pygmt.Figure()
pygmt.makecpt(cmap=','.join(CLASS_COLORS[k] for k in sorted(CLASS_COLORS)), series=[-0.5, 2.5, 1])
fig.basemap(region='d', projection='R0/25c',
            frame=['af', '+tSODP present-day Lithology Class map -- deployed classifier (ADR-0012: margin + OTEMP only)'])
fig.grdimage(grid=da, cmap=True, nan_transparent=True)
fig.coast(land='gray70', shorelines='0.3p,gray30')

y0 = -80
for i, k in enumerate(sorted(CLASS_NAMES)):
    x = -60 + i * 60
    fig.plot(x=[x], y=[y0], style='s0.35c', fill=CLASS_COLORS[k], pen='0.5p,black')
    fig.text(x=x + 4, y=y0, text=CLASS_NAMES[k], font='9p', justify='ML', no_clip=True)

fig.savefig('01-present-day-lithology-map.png', dpi=200)
print('wrote 01-present-day-lithology-map.png')

counts = {CLASS_NAMES.get(k, 'no-data'): int((classes == k).sum()) for k in [0, 1, 2, grid['noDataSentinel']]}
total_mapped = sum(v for k, v in counts.items() if k != 'no-data')
print('class counts:', counts)
for name in ['Clay', 'Carbonate ooze', 'Siliceous ooze']:
    print(f'{name}: {100 * counts[name] / total_mapped:.1f}% of mapped cells')
