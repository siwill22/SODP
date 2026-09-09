"""
Fits the 3-class probabilistic Lithology Class classifier that replaces
classifyLithology()'s hard rule -- see docs/adr/0010-probabilistic-
lithology-classifier.md for the full design rationale. Two things drove
this, both found by validating the deterministic rule against real point
data (../2026-09-09-present-day-validation/validate.py):

  1. The OVEL<=0 -> clay gate is not just imperfect, it is WORSE than a
     trivial baseline: 53.3% accuracy on real "is this clay?" labels,
     vs. 63.2% for just always guessing "not clay" (the majority class).
     A logistic fit on OVEL alone does no better than that same baseline
     (63.2%, AUC 0.552) -- OVEL sign carries almost no information on its
     own. Overall 3-way accuracy of the deterministic rule against real
     labels is 43.1%, actually BELOW the 48.8% you'd get by always
     guessing "carbonate-ooze" for everything.
  2. Adding margin (depth minus basin CCD, km) and |latitude| (a present-
     day proxy for SST control on calcification -- real calcifiers are
     temperature-limited, diatoms are not) alongside OVEL lifts 5-fold
     cross-validated 3-way accuracy to 66.2%.

This fits a multinomial logistic regression (StandardScaler internally for
conditioning, converted back to raw-feature coefficients afterward so the
production TypeScript port needs no scaler state -- just
sigmoid/softmax(raw_coef . x + raw_intercept)) on
  X = [ovelCmS, marginKm, abslatDeg],  y = real bucket in
  {clay, carbonate-ooze, siliceous-ooze}
using every real point with a valid driver reading (i.e. excluding the
Basement Age no-data ring near Antarctica -- deferred, see README.md's
point 1). Trained on ALL such points (n=8,445) for the production
coefficients; cross-validated accuracy above is what justifies deploying
it at all.

Present-day only. |latitude| here is NOT what Phase 2 should use through
time -- paleo-latitude from the trajectory is the time-aware version of
the same idea (see the ADR).
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

    pts = pd.read_csv('validation_points.csv')
    idxs = [texel_index(nlon, nlat, lo, la) for lo, la in zip(pts['Long'], pts['Lat'])]
    pts['ovelCmS'] = [ovel[i] for i in idxs]
    pts['oceanDepthKm'] = [depth[i] for i in idxs]
    pts['ccdKmUsed'] = [ccd[i] for i in idxs]
    pts['margin'] = pts['oceanDepthKm'].astype(float) - pts['ccdKmUsed'].astype(float)
    pts['abslat'] = pts['Lat'].abs()

    core = pts[pts['bucket'].isin(['clay', 'carbonate-ooze', 'siliceous-ooze'])].dropna(subset=['ovelCmS', 'margin']).copy()
    core['ovelCmS'] = core['ovelCmS'].astype(float)
    X = core[['ovelCmS', 'margin', 'abslat']].values
    y = core['bucket'].values
    print(f'n = {len(core)}, class balance: {core["bucket"].value_counts(normalize=True).to_dict()}')

    def current_rule(row):
        if row['ovelCmS'] <= 0:
            return 'clay'
        return 'carbonate-ooze' if row['margin'] < 0 else 'siliceous-ooze'
    current_acc = (core.apply(current_rule, axis=1) == y).mean()
    print(f'current deterministic rule, overall 3-way accuracy: {current_acc:.1%}')
    print(f'majority-class baseline (always carbonate-ooze): {(y == "carbonate-ooze").mean():.1%}')

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)
    scaler = StandardScaler().fit(X)
    X_scaled = scaler.transform(X)
    acc = cross_val_score(LogisticRegression(max_iter=2000), X_scaled, y, cv=cv, scoring='accuracy')
    print(f'multinomial logistic (ovel, margin, |lat|): 5-fold CV accuracy {acc.mean():.1%} +/- {acc.std():.1%}')

    # Fit on ALL data for the production coefficients.
    lr = LogisticRegression(max_iter=2000).fit(X_scaled, y)
    print('classes (softmax output order):', list(lr.classes_))

    # Convert standardized-space coefficients back to raw-feature space:
    # score = coef . (x - mean)/scale + intercept = (coef/scale) . x + (intercept - coef.mean/scale)
    raw_coef = lr.coef_ / scaler.scale_
    raw_intercept = lr.intercept_ - (lr.coef_ * scaler.mean_ / scaler.scale_).sum(axis=1)

    coefficients = {
        'classes': list(lr.classes_),
        'features': ['ovelCmS', 'marginKm', 'abslatDeg'],
        'coef': raw_coef.tolist(),
        'intercept': raw_intercept.tolist(),
        'trainingN': len(core),
        'crossValAccuracy': float(acc.mean()),
        'deterministicRuleAccuracy': float(current_acc),
    }
    with open('probabilistic_classifier_coefficients.json', 'w') as f:
        json.dump(coefficients, f, indent=2)
    print('\nwrote probabilistic_classifier_coefficients.json')

    # sanity check: re-evaluate raw-space coefficients reproduce the same predictions
    scores = X @ raw_coef.T + raw_intercept
    pred_idx = scores.argmax(axis=1)
    pred = np.array(lr.classes_)[pred_idx]
    reproduced_acc = (pred == y).mean()
    print(f'raw-coefficient reproduction check (should equal training accuracy from lr.score): '
          f'{reproduced_acc:.1%} vs lr.score={lr.score(X_scaled, y):.1%}')


if __name__ == '__main__':
    main()
