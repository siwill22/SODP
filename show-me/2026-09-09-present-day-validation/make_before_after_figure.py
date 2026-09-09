"""
Final before/after check: re-validates the ACTUAL deployed present-day
pipeline (src/presentDayMap.ts, now calling ADR-0010's
classifyLithologyProbabilistic()) against the same real point data used to
find the original problem -- not a re-run of the offline fit's own
cross-validation number, which excluded the Basement Age no-data ring.
This includes that ring as an automatic miss (real-world usage), so the
absolute accuracy is lower than the 66.2% figure quoted for the fit itself;
it is what a user actually clicking on this map would experience.
"""
import pandas as pd
import matplotlib.pyplot as plt

pts = pd.read_csv('validation_points_with_probabilistic.csv')
buckets = ['clay', 'carbonate-ooze', 'siliceous-ooze']
old = [(pts[pts['bucket'] == b]['model_class'] == b).mean() for b in buckets]
new = [(pts[pts['bucket'] == b]['model_class_prob'] == b).mean() for b in buckets]

fig, ax = plt.subplots(figsize=(7, 4.5))
x = range(len(buckets))
w = 0.35
ax.bar([i - w / 2 for i in x], old, width=w, color='#999999', label='deterministic rule (ADR-0007)')
ax.bar([i + w / 2 for i in x], new, width=w, color='#3377bb', label='probabilistic classifier (ADR-0010)')
for i, (o, n) in enumerate(zip(old, new)):
    ax.text(i - w / 2, o + 0.01, f'{o:.0%}', ha='center', fontsize=9)
    ax.text(i + w / 2, n + 0.01, f'{n:.0%}', ha='center', fontsize=9)
ax.set_xticks(list(x))
ax.set_xticklabels(buckets)
ax.set_ylabel('fraction of real points matching model class')
ax.set_ylim(0, 0.65)
ax.set_title('Before/after: the ACTUAL deployed present-day map,\nre-validated against the same real point data', fontsize=11)
ax.legend(fontsize=9)
plt.tight_layout()
plt.savefig('06-before-after-deployed-map.png', dpi=150)
print('wrote 06-before-after-deployed-map.png')

mappable = pts[pts['bucket'].isin(buckets)]
overall_old = (mappable['model_class'] == mappable['bucket']).mean()
overall_new = (mappable['model_class_prob'] == mappable['bucket']).mean()
print(f'overall 3-class accuracy on deployed map: old={overall_old:.1%} new={overall_new:.1%} (n={len(mappable)})')
