"""
Tests whether adding an OVEL x OTEMP interaction term fixes the blind spot
found in README.md: the OTEMP-only fit gets warm/equatorial siliceous-ooze
right 0% of the time (n=271) while getting cold/high-latitude siliceous-
ooze right 69% of the time (n=949) -- it learned "siliceous = cold" from
the training data's cold-water majority and cannot express "high OVEL
regardless of temperature" as its own signature.

An interaction term is the direct fix IF that hypothesis is right: it lets
the model learn "strong upwelling matters more/differently when water is
warm" instead of forcing OTEMP's effect to be the same slope everywhere.
Tests both overall cross-validated accuracy AND, more importantly, the
warm-vs-cold siliceous-ooze split specifically -- overall accuracy alone
already proved too coarse to catch the original blind spot.
"""
import json
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler

df = pd.read_csv('../2026-09-09-present-day-validation/validation_points_with_otemp.csv')
core = df.dropna(subset=['ovelCmS', 'margin', 'otempC']).copy()
core['ovelXotemp'] = core['ovelCmS'] * core['otempC']
y = core['bucket'].values

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)

feature_sets = {
    'ovel + margin + otemp  (ADR-0011, current)': ['ovelCmS', 'margin', 'otempC'],
    'ovel + margin + otemp + ovel*otemp  (candidate)': ['ovelCmS', 'margin', 'otempC', 'ovelXotemp'],
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

# The real test: does the interaction term fix the warm/cold siliceous split?
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

# also fit on ALL data to inspect coefficients, in case this looks worth deploying
X_all = core[['ovelCmS', 'margin', 'otempC', 'ovelXotemp']].values
scaler = StandardScaler().fit(X_all)
lr_all = LogisticRegression(max_iter=2000).fit(scaler.transform(X_all), y)
raw_coef = lr_all.coef_ / scaler.scale_
raw_intercept = lr_all.intercept_ - (lr_all.coef_ * scaler.mean_ / scaler.scale_).sum(axis=1)
print('\nclasses:', list(lr_all.classes_))
print('raw coef (ovel, margin, otemp, ovel*otemp):')
for cls, c in zip(lr_all.classes_, raw_coef):
    print(' ', cls, c.tolist())
print('raw intercept:', raw_intercept.tolist())
