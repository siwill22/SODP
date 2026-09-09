"""
Three-way before/after/after check of the ACTUAL deployed present-day
pipeline: deterministic rule (ADR-0007) -> probabilistic + |latitude|
(ADR-0010) -> probabilistic + OTEMP (ADR-0011). Same real point data,
same no-data-ring-included accounting as make_before_after_figure.py.
"""
import pandas as pd
import matplotlib.pyplot as plt

old = pd.read_csv('validation_points.csv')  # has model_class (deterministic)
lat = pd.read_csv('validation_points_with_probabilistic.csv')  # has model_class_prob (|lat|)
otemp = pd.read_csv('validation_points_with_otemp_deployed.csv')  # has model_class_otemp

buckets = ['clay', 'carbonate-ooze', 'siliceous-ooze']
det = [(old[old['bucket'] == b]['model_class'] == b).mean() for b in buckets]
latv = [(lat[lat['bucket'] == b]['model_class_prob'] == b).mean() for b in buckets]
ot = [(otemp[otemp['bucket'] == b]['model_class_otemp'] == b).mean() for b in buckets]

fig, ax = plt.subplots(figsize=(8, 4.5))
x = range(len(buckets))
w = 0.27
for offset, vals, color, label in [
    (-w, det, '#999999', 'deterministic (ADR-0007)'),
    (0, latv, '#77aadd', 'probabilistic + |lat| (ADR-0010)'),
    (w, ot, '#3377bb', 'probabilistic + OTEMP (ADR-0011)'),
]:
    bars = ax.bar([i + offset for i in x], vals, width=w, color=color, label=label)
    for i, v in zip(x, vals):
        ax.text(i + offset, v + 0.01, f'{v:.0%}', ha='center', fontsize=8)

ax.set_xticks(list(x))
ax.set_xticklabels(buckets)
ax.set_ylabel('fraction of real points matching model class')
ax.set_ylim(0, 0.65)
ax.set_title('Deployed present-day map, three classifier generations,\nsame real point data', fontsize=11)
ax.legend(fontsize=8)
plt.tight_layout()
plt.savefig('07-three-generations-deployed-map.png', dpi=150)

mappable = old[old['bucket'].isin(buckets)]
print('overall accuracy: deterministic',
      (mappable['model_class'] == mappable['bucket']).mean())
mappable_lat = lat[lat['bucket'].isin(buckets)]
print('overall accuracy: +|lat|', (mappable_lat['model_class_prob'] == mappable_lat['bucket']).mean())
mappable_ot = otemp[otemp['bucket'].isin(buckets)]
print('overall accuracy: +OTEMP', (mappable_ot['model_class_otemp'] == mappable_ot['bucket']).mean())
print('wrote 07-three-generations-deployed-map.png')
