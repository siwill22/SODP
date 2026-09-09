"""
Plots Diesing (2020)'s actual global deep-sea lithology map (PANGAEA
https://doi.org/10.1594/PANGAEA.911692), pulled and reprojected from its
native Wagner IV equal-area GeoTIFFs to plain lon/lat (data/*_4326.tif,
gdalwarp, nearest-neighbour for the categorical class raster) -- the real
published map, not a re-derivation.

Five classes (confirmed directly by checking argmax-of-probabilities
against the class raster, 99.9% match): 1=Calcareous sediment,
2=Clay, 3=Diatom ooze, 4=Lithogenous sediment, 5=Radiolarian ooze.
"""
import pygmt
import xarray as xr

CLASS_NAMES = {1: 'Calcareous sediment', 2: 'Clay', 3: 'Diatom ooze', 4: 'Lithogenous sediment', 5: 'Radiolarian ooze'}
CLASS_COLORS = {1: '221/204/102', 2: '102/153/204', 3: '150/220/150', 4: '160/120/90', 5: '51/170/85'}

grid = xr.open_dataarray('data/lithology_classes_4326.tif').squeeze()
grid = grid.where(grid > 0)  # nodata -9999 -> NaN

fig = pygmt.Figure()
pygmt.makecpt(cmap=','.join(CLASS_COLORS[k] for k in sorted(CLASS_COLORS)), series=[0.5, 5.5, 1])
fig.basemap(region='d', projection='R0/25c', frame=['af', '+tDiesing (2020) global deep-sea lithology -- pulled from PANGAEA, real map'])
fig.grdimage(grid=grid, cmap=True, nan_transparent=True)
fig.coast(land='gray70', shorelines='0.3p,gray30')

y0 = -80
for i, k in enumerate(sorted(CLASS_NAMES)):
    x = -170 + i * 70
    fig.plot(x=[x], y=[y0], style='s0.35c', fill=CLASS_COLORS[k], pen='0.5p,black')
    fig.text(x=x + 4, y=y0, text=CLASS_NAMES[k], font='9p', justify='ML', no_clip=True)

fig.savefig('01-diesing-global-map.png', dpi=200)
print('wrote 01-diesing-global-map.png')
