"""
Follow-up to validate.py's finding: within the branch of classifyLithology()
that decides carbonate-ooze vs siliceous-ooze (OVEL>0, i.e. "something is
being produced"), the existing depth-minus-CCD margin does NOT separate real
carbonate-ooze points from real siliceous-ooze points (near-identical
median margins). |latitude| does separate them (median 29 deg for real
carbonate vs 57 deg for real siliceous, within this branch).

This fits two logistic-regression models -- margin alone (the model's
current, sole predictor for this branch) vs. margin + |latitude| -- against
the real point labels, and compares them with 5-fold cross-validated
accuracy and ROC-AUC. This is a present-day-only fit (the ground-truth data
has no other option); see README.md for why |latitude| is a stand-in for
present-day SST control on calcification, and is NOT the variable Phase 2
should reuse unmodified (paleo-latitude from the trajectory is the
time-aware version of the same idea).
"""
import json
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score, StratifiedKFold


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
    depth = grid['oceanDepthKm']
    ovel = grid['ovelCmS']
    ccd = grid['ccdKmUsed']

    pts = pd.read_csv('validation_points.csv')
    idxs = [texel_index(nlon, nlat, lo, la) for lo, la in zip(pts['Long'], pts['Lat'])]
    pts['ovelCmS'] = [ovel[i] for i in idxs]
    pts['oceanDepthKm'] = [depth[i] for i in idxs]
    pts['ccdKmUsed'] = [ccd[i] for i in idxs]
    pts['margin'] = pts['oceanDepthKm'].astype(float) - pts['ccdKmUsed'].astype(float)
    pts['abslat'] = pts['Lat'].abs()

    # The branch under test: OVEL>0 (model reached the depth-vs-CCD decision),
    # real label is one of the two classes that decision is choosing between.
    branch = pts[(pts['ovelCmS'].astype(float) > 0) & pts['bucket'].isin(['carbonate-ooze', 'siliceous-ooze'])].copy()
    branch = branch.dropna(subset=['margin', 'abslat'])
    y = (branch['bucket'] == 'siliceous-ooze').astype(int).values  # 1 = siliceous
    print(f'n = {len(branch)} (real carbonate-ooze={sum(y == 0)}, real siliceous-ooze={sum(y == 1)})')

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)

    X_margin = branch[['margin']].values
    X_both = branch[['margin', 'abslat']].values

    acc_margin = cross_val_score(LogisticRegression(), X_margin, y, cv=cv, scoring='accuracy')
    acc_both = cross_val_score(LogisticRegression(), X_both, y, cv=cv, scoring='accuracy')
    auc_margin = cross_val_score(LogisticRegression(), X_margin, y, cv=cv, scoring='roc_auc')
    auc_both = cross_val_score(LogisticRegression(), X_both, y, cv=cv, scoring='roc_auc')

    # current deterministic rule's own accuracy on this same branch, as the baseline:
    # margin < 0 -> predicts carbonate (0); margin >= 0 -> predicts siliceous (1)
    current_rule_pred = (branch['margin'].values >= 0).astype(int)
    current_rule_acc = (current_rule_pred == y).mean()

    print(f'\ncurrent deterministic rule (margin<0 -> carbonate) accuracy on this branch: {current_rule_acc:.1%}')
    print(f'logistic(margin only)      5-fold CV accuracy: {acc_margin.mean():.1%} +/- {acc_margin.std():.1%}, '
          f'AUC {auc_margin.mean():.3f}')
    print(f'logistic(margin + |lat|)   5-fold CV accuracy: {acc_both.mean():.1%} +/- {acc_both.std():.1%}, '
          f'AUC {auc_both.mean():.3f}')

    # fit on all data for plotting the decision boundary
    model_both = LogisticRegression().fit(X_both, y)
    coef = model_both.coef_[0]
    intercept = model_both.intercept_[0]
    print(f'\nfitted boundary: margin*{coef[0]:.3f} + |lat|*{coef[1]:.3f} + {intercept:.3f} = 0')

    # --- figure: real points in (margin, |lat|) space, current rule's boundary
    # (vertical line at margin=0) vs the fitted logistic boundary ------------
    fig, ax = plt.subplots(figsize=(7, 5.5))
    carb = branch[branch['bucket'] == 'carbonate-ooze']
    sil = branch[branch['bucket'] == 'siliceous-ooze']
    ax.scatter(carb['margin'], carb['abslat'], s=8, alpha=0.4, color='#ddaa33', label=f'real carbonate-ooze (n={len(carb)})')
    ax.scatter(sil['margin'], sil['abslat'], s=8, alpha=0.4, color='#33aa55', label=f'real siliceous-ooze (n={len(sil)})')

    ax.axvline(0, color='#333333', linestyle='--', linewidth=1.5,
               label=f'current rule (margin<0 -> carbonate)\naccuracy on this branch: {current_rule_acc:.0%}')

    m_grid = np.linspace(branch['margin'].min(), branch['margin'].max(), 200)
    # boundary: coef[0]*m + coef[1]*lat + intercept = 0 -> lat = -(coef[0]*m+intercept)/coef[1]
    lat_boundary = -(coef[0] * m_grid + intercept) / coef[1]
    valid = (lat_boundary >= 0) & (lat_boundary <= 90)
    ax.plot(m_grid[valid], lat_boundary[valid], color='#cc3333', linewidth=2,
            label=f'fitted logistic(margin, |lat|)\n5-fold CV accuracy: {acc_both.mean():.0%}')

    ax.set_xlabel('depth minus basin CCD, km  (negative = shallower than CCD)')
    ax.set_ylabel('|latitude|, degrees')
    ax.set_title('Claim: does adding |latitude| separate real carbonate-ooze from\n'
                  'real siliceous-ooze better than the current margin-only rule?', fontsize=11)
    ax.legend(fontsize=8, loc='upper left')
    plt.tight_layout()
    plt.savefig('05-margin-lat-decision-boundary.png', dpi=150)
    plt.close()
    print('\nwrote 05-margin-lat-decision-boundary.png')


if __name__ == '__main__':
    main()
