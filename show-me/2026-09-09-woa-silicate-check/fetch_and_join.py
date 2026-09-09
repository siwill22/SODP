"""
Real, independent test of the actual hypothesis (not a HadCM3 proxy):
does measured present-day surface dissolved silicate (World Ocean Atlas
2023, NOAA NCEI, data/woa23_silicate_annual_1deg.nc, variable i_an =
objectively-analysed mean, depth=0, 1x1 degree annual climatology)
separate real warm-water carbonate-ooze from real warm-water
siliceous-ooze points, where OVEL, OTEMP, and OSAL (all HadCM3/
BRIDGE-Valdes physical-model proxies) could not
(../2026-09-09-present-day-validation/fit_with_osal.py,
fit_balanced_with_osal.py)?

This is present-day-only, observational, not a paleo proxy -- the point
is to settle whether "missing silicate supply" is really the answer
before investing in a paleo proxy for it.
"""
import numpy as np
import pandas as pd
import xarray as xr
from scipy import stats

ds = xr.open_dataset('data/woa23_silicate_annual_1deg.nc', decode_times=False)
surf = ds['i_an'].isel(time=0, depth=0)  # surface, umol/kg
lats = surf['lat'].values  # cell centers, -89.5..89.5
lons = surf['lon'].values  # cell centers, -179.5..179.5
grid = surf.values  # (lat, lon)


def lookup(lon, lat):
    j = int(np.argmin(np.abs(lats - lat)))
    i = int(np.argmin(np.abs(lons - lon)))
    v = grid[j, i]
    return float(v) if np.isfinite(v) else np.nan


pts = pd.read_csv('../2026-09-09-present-day-validation/validation_points_with_osal.csv')
pts['silicateUmolKg'] = [lookup(lo, la) for lo, la in zip(pts['Long'], pts['Lat'])]

n_total = len(pts)
n_nan = pts['silicateUmolKg'].isna().sum()
print(f'n={n_total}, missing WOA silicate (land/coastal 1deg cell): {n_nan}')

core = pts.dropna(subset=['silicateUmolKg']).copy()
sil = core[core['bucket'] == 'siliceous-ooze']
carb = core[core['bucket'] == 'carbonate-ooze']
warm_sil = sil[sil['otempC'] > 15]
warm_carb = carb[carb['otempC'] > 15]
cold_sil = sil[sil['otempC'] <= 15]
cold_carb = carb[carb['otempC'] <= 15]

print(f'\nwarm siliceous-ooze silicate (n={len(warm_sil)}): median={warm_sil["silicateUmolKg"].median():.2f}, mean={warm_sil["silicateUmolKg"].mean():.2f}')
print(f'warm carbonate-ooze silicate (n={len(warm_carb)}): median={warm_carb["silicateUmolKg"].median():.2f}, mean={warm_carb["silicateUmolKg"].mean():.2f}')
u, p = stats.mannwhitneyu(warm_sil['silicateUmolKg'], warm_carb['silicateUmolKg'])
print(f'Mann-Whitney U, warm siliceous vs warm carbonate: p={p:.2e}')

print(f'\ncold siliceous-ooze silicate (n={len(cold_sil)}): median={cold_sil["silicateUmolKg"].median():.2f}')
print(f'cold carbonate-ooze silicate (n={len(cold_carb)}): median={cold_carb["silicateUmolKg"].median():.2f}')

core.to_csv('validation_points_with_silicate.csv', index=False)
print('\nwrote validation_points_with_silicate.csv')
