"""
Claim under test: does real, independently-measured surface dissolved
silicate (WOA23) or salinity (BRIDGE-Valdes OSAL) actually separate real
warm-water (OTEMP>15C) carbonate-ooze from siliceous-ooze points -- the
split where OVEL and OTEMP give exactly 0% classifier recall
(../2026-09-09-otemp-example-cores/README.md)?
"""
import pandas as pd
import matplotlib.pyplot as plt

sil_df = pd.read_csv('validation_points_with_silicate.csv')[['Long', 'Lat', 'silicateUmolKg']]
osal_df = pd.read_csv('../2026-09-09-present-day-validation/validation_points_with_osal.csv')
core = osal_df.merge(sil_df, on=['Long', 'Lat'], how='inner').dropna(subset=['silicateUmolKg', 'osalPsu'])
warm = core[core['otempC'] > 15]

fig, axes = plt.subplots(1, 2, figsize=(10, 4.5))
for ax, col, label, auc in zip(
    axes, ['osalPsu', 'silicateUmolKg'],
    ['OSAL (surface salinity, PSU)\nBRIDGE-Valdes -- present-day proxy',
     'Surface silicate (umol/kg)\nWOA23 -- real measured, present-day only'],
    ['single-var AUC (direction-corrected) = 0.74', 'single-var AUC = 0.61'],
):
    for cls, color in [('carbonate-ooze', '#ddcc66'), ('siliceous-ooze', '#33aa55')]:
        vals = warm[warm['bucket'] == cls][col]
        ax.hist(vals, bins=30, alpha=0.55, density=True, color=color, label=f'{cls} (n={len(vals)})')
    ax.set_xlabel(label)
    ax.set_ylabel('density')
    ax.set_title(auc, fontsize=9)
    ax.legend(fontsize=8)

fig.suptitle('Warm-water (OTEMP>15C) carbonate-ooze vs siliceous-ooze: real signal exists in both,\n'
             'but neither separates the classes enough to fix the classifier (best isolated recall ~11-15%)')
plt.tight_layout()
plt.savefig('01-warm-water-osal-vs-silicate.png', dpi=150)
print('wrote 01-warm-water-osal-vs-silicate.png')
