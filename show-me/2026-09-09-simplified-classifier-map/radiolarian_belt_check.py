"""
Testing a specific claim: comparing our model to Diesing (2020), it looks
like Radiolarian Ooze should probabilistically replace our "clay"
prediction specifically within ~5-15 deg of the equator, and nowhere
else. Depth/margin (depth - CCD) matters too, not just latitude -- near
the equator, cells ABOVE the CCD should stay carbonate-ooze regardless;
the question is only live for cells where our model predicts clay (i.e.
below CCD, real warm water) -- is that specific bucket, in that specific
latitude band, actually Diesing's Radiolarian ooze?

Joins, all on our own 360x181 (1deg) grid:
  - our classes: ../2026-09-09-simplified-classifier-map/grid.json (real
    deployed classifier, post-ADR-0012)
  - real bathymetry + per-basin CCD (unaffected by the classifier change):
    ../2026-09-08-lithology-map/lithology_grid.json (oceanDepthKm, ccdKmUsed)
  - Diesing's real map, nearest-pixel lookup from the reprojected 0.25deg
    raster: ../2026-09-09-diesing-validation/data/lithology_classes_4326.tif
"""
import json

import numpy as np
import pandas as pd
import xarray as xr

ours = json.load(open('grid.json'))
nlon, nlat = ours['nlon'], ours['nlat']
our_classes = np.array(ours['classes'], dtype=np.uint8).reshape(nlat, nlon)
CLASS_NAMES = {0: 'clay', 1: 'carbonate-ooze', 2: 'siliceous-ooze', 255: 'no-data'}

base = json.load(open('../2026-09-08-lithology-map/lithology_grid.json'))
depth = np.array(base['oceanDepthKm'], dtype=np.float32).reshape(nlat, nlon)
ccd = np.array(base['ccdKmUsed'], dtype=np.float32).reshape(nlat, nlon)
margin = depth - ccd  # >0 = below CCD (real warm-water clay-vs-siliceous question is only live here)

lon = np.linspace(-180.0, 180.0, nlon, endpoint=False)
lat = np.linspace(-90.0, 90.0, nlat)

diesing_da = xr.open_dataarray('../2026-09-09-diesing-validation/data/lithology_classes_4326.tif').squeeze()
DIESING_NAMES = {1: 'Calcareous sediment', 2: 'Clay', 3: 'Diatom ooze', 4: 'Lithogenous sediment', 5: 'Radiolarian ooze'}
diesing_nearest = diesing_da.sel(x=xr.DataArray(lon, dims='lon'), y=xr.DataArray(lat, dims='lat'), method='nearest')
diesing_grid = diesing_nearest.values  # (lat, lon)

rows = []
for j in range(nlat):
    for i in range(nlon):
        oc = our_classes[j, i]
        dv = diesing_grid[j, i]
        if oc == 255 or not np.isfinite(dv) or dv <= 0:
            continue
        rows.append({
            'lat': lat[j], 'lon': lon[i], 'our_class': CLASS_NAMES[oc],
            'margin': margin[j, i], 'diesing_class': DIESING_NAMES.get(int(dv), 'unknown'),
        })
df = pd.DataFrame(rows)
df['abslat'] = df['lat'].abs()
df.to_csv('our_vs_diesing_with_margin.csv', index=False)
print(f'n = {len(df)}')

# Restrict to cells where OUR model predicts clay (the only cells where this question is live)
clay = df[df['our_class'] == 'clay'].copy()
print(f'\nour clay cells: n = {len(clay)}')

bands = [(0, 5), (5, 15), (15, 25), (25, 40), (40, 90)]
print('\nWithin our-clay cells, fraction that Diesing calls Radiolarian ooze, by |latitude| band:')
for lo, hi in bands:
    b = clay[(clay['abslat'] >= lo) & (clay['abslat'] < hi)]
    if len(b) == 0:
        continue
    frac_rad = (b['diesing_class'] == 'Radiolarian ooze').mean()
    frac_below_ccd = (b['margin'] > 0).mean()
    print(f'  |lat| {lo}-{hi}: n={len(b)}, {frac_rad:.1%} Radiolarian ooze in Diesing, '
          f'{frac_below_ccd:.1%} below-CCD (margin>0)')

# Same, but only among our-clay cells that ARE below CCD (margin>0) -- the truly "live" subset,
# since above-CCD clay cells are a different situation (shallow clay, not the deep-basin question)
print('\nSame, restricted to our-clay cells that are also below CCD (margin>0):')
clay_below = clay[clay['margin'] > 0]
for lo, hi in bands:
    b = clay_below[(clay_below['abslat'] >= lo) & (clay_below['abslat'] < hi)]
    if len(b) == 0:
        print(f'  |lat| {lo}-{hi}: n=0')
        continue
    frac_rad = (b['diesing_class'] == 'Radiolarian ooze').mean()
    print(f'  |lat| {lo}-{hi}: n={len(b)}, {frac_rad:.1%} Radiolarian ooze in Diesing')

# And: how much of ALL Diesing Radiolarian ooze area does this "our-clay, below-CCD, 5-15deg"
# bucket actually cover? (does fixing this bucket capture most of the real belt, or a small piece?)
all_rad = df[df['diesing_class'] == 'Radiolarian ooze']
target = clay_below[(clay_below['abslat'] >= 5) & (clay_below['abslat'] < 15)]
print(f'\nTotal Diesing Radiolarian ooze cells (over our valid grid): {len(all_rad)}')
print(f'Of those, how many are in our-clay+below-CCD+5-15deg bucket: '
      f'{(target["diesing_class"] == "Radiolarian ooze").sum()} '
      f'({100 * (target["diesing_class"] == "Radiolarian ooze").sum() / len(all_rad):.1f}% of all Diesing radiolarian cells)')
