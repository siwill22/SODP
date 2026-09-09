"""
Figures for the real-data validation of Phase 1's present-day Lithology
Class map (see validate.py and README.md for the full analysis). Run
validate.py first -- this script only plots validation_points.csv.
"""
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import pygmt

pts = pd.read_csv('validation_points.csv')

CLASS_COLOR = {
    'clay': '#6699cc',
    'carbonate-ooze': '#ddcc66',
    'siliceous-ooze': '#66bb66',
    'no-data': '#999999',
}

# --- Figure 1: agreement rate by real-world bucket (does the model's class
# match the real label, for the 3 buckets that can even agree) --------------
fig, ax = plt.subplots(figsize=(6, 4))
buckets = ['clay', 'carbonate-ooze', 'siliceous-ooze']
agree = [(pts[pts['bucket'] == b]['model_class'] == b).mean() for b in buckets]
n = [len(pts[pts['bucket'] == b]) for b in buckets]
bars = ax.bar(buckets, agree, color=[CLASS_COLOR[b] for b in buckets])
for bar, a, ni in zip(bars, agree, n):
    ax.text(bar.get_x() + bar.get_width() / 2, a + 0.01, f'{a:.0%}\n(n={ni})', ha='center', fontsize=9)
ax.axhline(1 / 3, color='k', linestyle='--', linewidth=1, label='chance if classes equally likely (1/3)')
ax.set_ylim(0, 0.6)
ax.set_ylabel('fraction of real points where model class == real class')
ax.set_title('Claim: does the deterministic present-day model reproduce\n'
              'real seafloor-lithology point observations? (n=14,400 total)', fontsize=11)
ax.legend(fontsize=8)
plt.tight_layout()
plt.savefig('01-agreement-by-class.png', dpi=150)
plt.close()

# --- Figure 2: siliceous-ooze agreement / no-data rate vs |latitude| -------
sil = pts[pts['bucket'] == 'siliceous-ooze'].copy()
bins = [0, 30, 50, 60, 70, 90]
sil['abslat_bin'] = pd.cut(sil['Lat'].abs(), bins)
grp = sil.groupby('abslat_bin', observed=True).apply(
    lambda g: pd.Series({
        'n': len(g),
        'agree': (g['model_class'] == 'siliceous-ooze').mean(),
        'no_data': (g['model_class'] == 'no-data').mean(),
    }), include_groups=False,
)
fig, ax = plt.subplots(figsize=(6, 4))
x = np.arange(len(grp))
ax.plot(x, grp['agree'], 'o-', color=CLASS_COLOR['siliceous-ooze'], label='model correctly says siliceous-ooze')
ax.plot(x, grp['no_data'], 'o-', color=CLASS_COLOR['no-data'], label='model says no-data (masked)')
ax.set_xticks(x)
ax.set_xticklabels([str(b) for b in grp.index])
for xi, ni in zip(x, grp['n']):
    ax.annotate(f'n={int(ni)}', (xi, 1.02), ha='center', fontsize=7, color='#666')
ax.set_ylim(0, 1.1)
ax.set_xlabel('|latitude| band, degrees')
ax.set_ylabel('fraction of real siliceous-ooze points')
ax.set_title("Claim: real siliceous-ooze points (Southern Ocean opal belt,\n"
             "median lat -55 deg) -- reproduced, or masked out?", fontsize=11)
ax.legend(fontsize=8)
plt.tight_layout()
plt.savefig('02-siliceous-vs-latitude.png', dpi=150)
plt.close()

# --- Figure 3: confusion matrix heatmap ------------------------------------
order_rows = ['clay', 'carbonate-ooze', 'siliceous-ooze', 'mixed', 'other-nonpelagic']
order_cols = ['clay', 'carbonate-ooze', 'siliceous-ooze', 'no-data']
mat = pd.crosstab(pts['bucket'], pts['model_class'])
mat = mat.reindex(index=order_rows, columns=order_cols).fillna(0)
frac = mat.div(mat.sum(axis=1), axis=0)

fig, ax = plt.subplots(figsize=(6, 5))
im = ax.imshow(frac.values, cmap='viridis', vmin=0, vmax=1, aspect='auto')
ax.set_xticks(range(len(order_cols)))
ax.set_xticklabels(order_cols, rotation=30, ha='right')
ax.set_yticks(range(len(order_rows)))
ax.set_yticklabels(order_rows)
for i in range(len(order_rows)):
    for j in range(len(order_cols)):
        n_ij = int(mat.values[i, j])
        ax.text(j, i, f'{frac.values[i, j]:.0%}\n(n={n_ij})', ha='center', va='center',
                color='white' if frac.values[i, j] < 0.6 else 'black', fontsize=8)
ax.set_xlabel('model prediction')
ax.set_ylabel('real label bucket')
ax.set_title('Confusion matrix: row-normalized fraction\n(real bucket -> model class)')
fig.colorbar(im, ax=ax, label='fraction of row')
plt.tight_layout()
plt.savefig('03-confusion-matrix.png', dpi=150)
plt.close()

# --- Figure 4: map of real siliceous-ooze points colored by model verdict --
sil_all = pts[pts['bucket'] == 'siliceous-ooze'].copy()
color_map = {'siliceous-ooze': 'green', 'carbonate-ooze': 'orange', 'clay': 'blue', 'no-data': 'gray'}
sil_all['color'] = sil_all['model_class'].map(color_map)

fig = pygmt.Figure()
fig.basemap(region='g', projection='G0/-90/12c', frame='g')
fig.coast(land='gray90', water='white', shorelines='0.25p,gray40')
for verdict, color in color_map.items():
    sub = sil_all[sil_all['model_class'] == verdict]
    if len(sub):
        fig.plot(x=sub['Long'], y=sub['Lat'], style='c0.08c', fill=color,
                  label=f'model: {verdict} (n={len(sub)})')
fig.legend(position='JBL+o0.2c', box='+gwhite+p0.5p')
title_lines = [
    'Real siliceous-ooze point observations, colored by model prediction there',
    '(south-polar projection -- most real siliceous-ooze points are the Southern Ocean opal belt)',
]
for i, line in enumerate(title_lines):
    fig.text(text=line, position='TC', offset=f'0/{1.0 - 0.5 * i}c', font='9p', no_clip=True)
fig.savefig('04-siliceous-points-south-polar.png', dpi=200)

print('wrote 01-04 PNGs')
