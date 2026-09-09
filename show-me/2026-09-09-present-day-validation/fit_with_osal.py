"""
Tests whether real present-day ocean salinity (OSAL, same BRIDGE-Valdes
dataset as OVEL/OTEMP, layerIndex=0/5m depth, age=0 frame -- see
fetch_osal_layer0.mjs) separates real warm-water carbonate-ooze from real
warm-water siliceous-ooze points, where OVEL and OTEMP cannot: the
OVELxOTEMP interaction-term test (../2026-09-09-otemp-example-cores/
try_ovel_otemp_interaction.py) found exactly 0% accuracy on real warm
siliceous-ooze points (OTEMP>15C, n=271) no matter the functional form of
[ovelCmS, margin, otempC], because OVEL's own distribution is
indistinguishable between the two classes there.

Motivation: upwelled deep water often carries a distinct salinity
signature from surrounding surface water (a cheap, already-served proxy
for water-mass origin), unlike OVEL/OTEMP which the interaction test ruled
out for this specific split. Costs nothing new -- OSAL is already fetched
via the same manifest as OVEL/OTEMP.
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
    with open('osal_layer0.json') as f:
        osal_grid = json.load(f)
    nlon, nlat = osal_grid['nlon'], osal_grid['nlat']
    osal = osal_grid['values']

    pts = pd.read_csv('validation_points_with_otemp.csv')
    idxs = [texel_index(nlon, nlat, lo, la) for lo, la in zip(pts['Long'], pts['Lat'])]
    pts['osalPsu'] = [osal[i] for i in idxs]

    core = pts.dropna(subset=['ovelCmS', 'margin', 'otempC', 'osalPsu']).copy()
    n_dropped = len(pts) - len(core)
    print(f'n = {len(core)} (dropped {n_dropped} with no OSAL)')
    y = core['bucket'].values

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)

    feature_sets = {
        'ovel + margin + otemp  (ADR-0011, current)': ['ovelCmS', 'margin', 'otempC'],
        'ovel + margin + otemp + osal  (candidate)': ['ovelCmS', 'margin', 'otempC', 'osalPsu'],
        'ovel + margin + osal  (osal replacing otemp)': ['ovelCmS', 'margin', 'osalPsu'],
    }

    fitted = {}
    for name, cols in feature_sets.items():
        X = core[cols].values
        scaler = StandardScaler().fit(X)
        Xs = scaler.transform(X)
        acc = cross_val_score(LogisticRegression(max_iter=2000), Xs, y, cv=cv, scoring='accuracy')
        print(f'{name}: 5-fold CV accuracy {acc.mean():.1%} +/- {acc.std():.1%}')
        lr = LogisticRegression(max_iter=2000).fit(Xs, y)
        fitted[name] = (lr, scaler, cols)

    # The real test: does OSAL fix the warm/cold siliceous split?
    print()
    for name, (lr, scaler, cols) in fitted.items():
        X = core[cols].values
        pred = lr.predict(scaler.transform(X))
        core[f'pred_{name}'] = pred
        sil = core[core['bucket'] == 'siliceous-ooze']
        warm = sil[sil['otempC'] > 15]
        cold = sil[sil['otempC'] <= 15]
        acc_warm = (warm[f'pred_{name}'] == 'siliceous-ooze').mean()
        acc_cold = (cold[f'pred_{name}'] == 'siliceous-ooze').mean()
        print(f'{name}:')
        print(f'  warm/equatorial siliceous-ooze (n={len(warm)}): {acc_warm:.1%}')
        print(f'  cold/high-lat siliceous-ooze    (n={len(cold)}): {acc_cold:.1%}')
        print(f'  warm subset -- what it predicts instead: {warm[f"pred_{name}"].value_counts(normalize=True).to_dict()}')

    # Does OSAL itself even differ between the two classes in warm water? (the direct check,
    # mirroring the OVEL median comparison that ruled out the interaction term)
    print()
    sil = core[core['bucket'] == 'siliceous-ooze']
    carb = core[core['bucket'] == 'carbonate-ooze']
    warm_sil = sil[sil['otempC'] > 15]
    warm_carb = carb[carb['otempC'] > 15]
    print(f'warm siliceous-ooze OSAL (n={len(warm_sil)}): median={warm_sil["osalPsu"].median():.3f}, '
          f'mean={warm_sil["osalPsu"].mean():.3f}')
    print(f'warm carbonate-ooze OSAL (n={len(warm_carb)}): median={warm_carb["osalPsu"].median():.3f}, '
          f'mean={warm_carb["osalPsu"].mean():.3f}')

    core.to_csv('validation_points_with_osal.csv', index=False)


if __name__ == '__main__':
    main()
