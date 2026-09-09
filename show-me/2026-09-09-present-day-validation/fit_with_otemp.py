"""
Tests whether real paleo/present ocean temperature (OTEMP, BRIDGE-Valdes,
same dataset OVEL comes from, layerIndex=0/5m depth, age=0 frame) beats the
|latitude| proxy used in ADR-0010's first fit -- see fetch_otemp_layer0.mjs
for how otemp_layer0.json was produced (real fetch, not synthesized).

Motivation: |latitude| stands in for present-day SST control on
calcification, but a point's absolute latitude doesn't track its climate
history through geological time (hothouse periods had a much flatter
equator-to-pole gradient, no polar ice). OTEMP is the actual simulated
temperature at every one of BRIDGE-Valdes's 109 frames -- if it predicts
as well or better than |latitude| at present day, Phase 2 can fetch real
paleo-OTEMP per frame (same mechanism as fetchOvelSeriesForCore) instead
of reusing present-day latitude unmodified for the deep past.
"""
import json
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler


def texel_index(nlon, nlat, lon, lat):
    p_lon = (lon + 180.0) / 360.0
    i_lon = int(np.floor(p_lon * nlon)) % nlon
    if i_lon < 0:
        i_lon += nlon
    p_lat = (lat + 90.0) / 180.0
    j_lat = int(round(p_lat * (nlat - 1)))
    j_lat = min(nlat - 1, max(0, j_lat))
    return j_lat * nlon + i_lon


def main():
    with open('../2026-09-08-lithology-map/lithology_grid.json') as f:
        grid = json.load(f)
    nlon, nlat = grid['nlon'], grid['nlat']
    depth, ovel, ccd = grid['oceanDepthKm'], grid['ovelCmS'], grid['ccdKmUsed']

    with open('otemp_layer0.json') as f:
        otemp_grid = json.load(f)
    assert otemp_grid['nlon'] == nlon and otemp_grid['nlat'] == nlat
    otemp = otemp_grid['values']

    pts = pd.read_csv('validation_points.csv')
    idxs = [texel_index(nlon, nlat, lo, la) for lo, la in zip(pts['Long'], pts['Lat'])]
    pts['ovelCmS'] = [ovel[i] for i in idxs]
    pts['oceanDepthKm'] = [depth[i] for i in idxs]
    pts['ccdKmUsed'] = [ccd[i] for i in idxs]
    pts['margin'] = pts['oceanDepthKm'].astype(float) - pts['ccdKmUsed'].astype(float)
    pts['abslat'] = pts['Lat'].abs()
    pts['otempC'] = [otemp[i] for i in idxs]

    core = pts[pts['bucket'].isin(['clay', 'carbonate-ooze', 'siliceous-ooze'])].dropna(
        subset=['ovelCmS', 'margin', 'otempC']).copy()
    core['ovelCmS'] = core['ovelCmS'].astype(float)
    y = core['bucket'].values
    print(f'n = {len(core)} (dropped {len(pts[pts["bucket"].isin(["clay","carbonate-ooze","siliceous-ooze"])]) - len(core)} '
          f'with no OTEMP -- likely the same Antarctic-margin/land cells already missing Basement Age or bathymetry)')

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)

    feature_sets = {
        'ovel + margin + |lat|  (ADR-0010, current)': ['ovelCmS', 'margin', 'abslat'],
        'ovel + margin + OTEMP  (candidate)': ['ovelCmS', 'margin', 'otempC'],
        'ovel + margin + |lat| + OTEMP  (both)': ['ovelCmS', 'margin', 'abslat', 'otempC'],
    }
    for name, cols in feature_sets.items():
        X = StandardScaler().fit_transform(core[cols].values)
        acc = cross_val_score(LogisticRegression(max_iter=2000), X, y, cv=cv, scoring='accuracy')
        print(f'{name}: 5-fold CV accuracy {acc.mean():.1%} +/- {acc.std():.1%}')

    print(f'\ncorrelation(|lat|, OTEMP) = {core["abslat"].corr(core["otempC"]):.3f}  (sanity check -- should be strongly negative)')

    core.to_csv('validation_points_with_otemp.csv', index=False)


if __name__ == '__main__':
    main()
