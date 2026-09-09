"""
Validate Phase 1's present-day 3-class Lithology Class map (ADR-0006/0007/
0008, computed by ../2026-09-08-lithology-map/compute_lithology.mjs and
cached in that folder's lithology_grid.json) against real point observations:

  /Users/simon/GIT/gpdata/seafloor_fabric/seafloor_lithology_point_data.csv

This is real seafloor-lithology ground truth (14,400 points, 13 named
classes, present-day only) -- the first real-world comparison this project
has had; everything before this was internal self-consistency checking
(mask agreement, threshold sweeps) with no external ground truth.

Deliberately keeps every point, including the 5 real classes with no
mapping onto SODP's 3-class scheme (Sand, Silt, Gravel and Coarser, Shells
and Coral Fragments, Ash and Volcanic Sand/Gravel -- mostly terrigenous/
near-shore/glacial-rafted, not pelagic sedimentation at all). Dropping them
would silently discard the information that the model's 3-class scheme does
not apply there; bucketing them as "other" and cross-tabulating against
what the model predicts there instead tests a real claim: does the model's
own Basement Age mask (oceanic crust only) already exclude these
locations, or does it wrongly paint them as pelagic ooze/clay?

"Mixed Calcareous/Siliceous Ooze" (282 points) is kept as its own bucket
too, not folded into either class -- it is real-world evidence of exactly
the in-between case a probabilistic classifier (under discussion) would
need to reproduce, and folding it into one side would erase that.
"""
import json
import numpy as np
import pandas as pd

POINTS_CSV = '/Users/simon/GIT/gpdata/seafloor_fabric/seafloor_lithology_point_data.csv'
GRID_JSON = '/Users/simon/GIT/SODP/show-me/2026-09-08-lithology-map/lithology_grid.json'

LABEL_TO_BUCKET = {
    'Clay': 'clay',
    'Calcareous Ooze': 'carbonate-ooze',
    'Fine-grained Calcareous Sediment': 'carbonate-ooze',
    'Siliceous Mud': 'siliceous-ooze',
    'Diaton Ooze': 'siliceous-ooze',  # sic -- typo in source data for "Diatom Ooze"
    'Radiolarian Ooze': 'siliceous-ooze',
    'Sponge Spicules': 'siliceous-ooze',
    'Mixed Calcareous/Siliceous Ooze': 'mixed',
    'Sand': 'other-nonpelagic',
    'Silt': 'other-nonpelagic',
    'Gravel and Coarser': 'other-nonpelagic',
    'Shells and Coral Fragments': 'other-nonpelagic',
    'Ash and Volcanic Sand/Gravel': 'other-nonpelagic',
}


def texel_index(nlon, nlat, lon, lat):
    """Exact port of src/core/volume.ts's texelIndex() -- must match the
    model grid's own indexing convention exactly, not a re-derivation."""
    p_lon = (lon + 180.0) / 360.0
    i_lon = int(np.floor(p_lon * nlon)) % nlon
    if i_lon < 0:
        i_lon += nlon
    p_lat = (lat + 90.0) / 180.0
    j_lat = int(round(p_lat * (nlat - 1)))
    j_lat = min(nlat - 1, max(0, j_lat))
    return j_lat * nlon + i_lon


def main():
    pts = pd.read_csv(POINTS_CSV)
    pts['bucket'] = pts['Label'].map(LABEL_TO_BUCKET)
    assert pts['bucket'].isna().sum() == 0, 'unmapped label found'

    with open(GRID_JSON) as f:
        grid = json.load(f)
    nlon, nlat = grid['nlon'], grid['nlat']
    classes = np.array(grid['classes'], dtype=np.int64)
    no_data = grid['noDataSentinel']
    idx_to_name = {v: k for k, v in grid['classIndex'].items()}
    idx_to_name[no_data] = 'no-data'

    model_class = []
    for lon, lat in zip(pts['Long'], pts['Lat']):
        idx = texel_index(nlon, nlat, lon, lat)
        model_class.append(idx_to_name[classes[idx]])
    pts['model_class'] = model_class

    crosstab = pd.crosstab(pts['bucket'], pts['model_class'], margins=True)
    print('=== real bucket (row) vs model prediction (col) ===')
    print(crosstab)
    print()

    for cls in ['clay', 'carbonate-ooze', 'siliceous-ooze']:
        sub = pts[pts['bucket'] == cls]
        agree = (sub['model_class'] == cls).mean()
        print(f'{cls}: n={len(sub)}, model agrees {agree:.1%}')

    other = pts[pts['bucket'] == 'other-nonpelagic']
    print(f'\nother-nonpelagic (n={len(other)}): model says no-data '
          f'{(other["model_class"] == "no-data").mean():.1%}, '
          f'model says a pelagic class {(other["model_class"] != "no-data").mean():.1%}')
    print(other['model_class'].value_counts())

    mixed = pts[pts['bucket'] == 'mixed']
    print(f'\nmixed (n={len(mixed)}) model prediction split:')
    print(mixed['model_class'].value_counts(normalize=True))

    pts.to_csv('validation_points.csv', index=False)
    crosstab.to_csv('confusion_matrix.csv')
    print('\nwrote validation_points.csv, confusion_matrix.csv')


if __name__ == '__main__':
    main()
