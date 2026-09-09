"""
Updated example Synthetic Cores after ADR-0011 (probabilistic classifier,
OVEL + depth-minus-CCD margin + real paleo-OTEMP, now used through time).
Two points, both already validated in earlier show-me passes under the OLD
deterministic rule -- reused here specifically so any difference is
attributable to the classifier change, not a new point:

  - (-150, 15): the "textbook story" point from
    2026-09-09-synthetic-core-skeleton (85.33 Ma, equatorial formation
    drifting into the oligotrophic gyre).
  - (-68, 32): old Western Atlantic (137.33 Ma), previously flat all-Clay.

Claim under test: does the OTEMP classifier's real-data improvement
(present-day validation, previous show-me folder) carry over cleanly to
these down-core stories, or does it change them in a way worth flagging?
"""
import json
import numpy as np
import matplotlib.pyplot as plt

CLASS_COLOR = {'clay': '#6699cc', 'carbonate-ooze': '#ddcc66', 'siliceous-ooze': '#33aa55'}

with open('example_cores.json') as f:
    cores = json.load(f)
with open('../../archive/ccd/published_ccd_curve.json') as f:
    published_curve = json.load(f)['curve']
with open('../../archive/ccd/co2_linked_ccd_curve.json') as f:
    co2_curve = json.load(f)['curve']


def plot_core(core, filename):
    fig, (ax, ax2) = plt.subplots(2, 1, figsize=(9, 7), sharex=True, height_ratios=[2.2, 1])

    traj_age = [s['ageMa'] for s in core['trajectory']]
    traj_depth = [s['oceanDepthKm'] for s in core['trajectory']]
    ax.plot(traj_age, traj_depth, color='k', linewidth=1, label='GDH1 depth (1 Ma trajectory)')

    pub_age = [p['age_ma'] for p in published_curve if p['age_ma'] <= core['basementAgeMa']]
    pub_ccd = [p['ccd_km'] for p in published_curve if p['age_ma'] <= core['basementAgeMa']]
    co2_age = [p['age_ma'] for p in co2_curve if p['age_ma'] <= core['basementAgeMa']]
    co2_ccd = [p['ccd_km'] for p in co2_curve if p['age_ma'] <= core['basementAgeMa']]
    ax.plot(pub_age, pub_ccd, '--', color='magenta', linewidth=1, label='Published CCD Curve')
    ax.plot(co2_age, co2_ccd, ':', color='purple', linewidth=1.3, label='CO2-Linked CCD Curve')

    log = core['log']
    ages = [s['ageMa'] for s in log]
    depths = [s['oceanDepthKm'] for s in log]
    old_colors = [CLASS_COLOR[s['oldClassPublished']] for s in log]
    new_colors = [CLASS_COLOR[s['classPublished']] for s in log]

    jitter = (max(ages) - min(ages)) * 0.006 if len(ages) > 1 else 0.5
    ax.scatter([a - jitter for a in ages], depths, s=90, facecolors='none',
               edgecolors=old_colors, linewidths=2, marker='o', zorder=4,
               label='OLD: classifyLithology (ADR-0007)')
    ax.scatter([a + jitter for a in ages], depths, s=70, c=new_colors, marker='o', zorder=5,
               label='NEW: probabilistic + OTEMP (ADR-0011)')

    flips = [s for s in log if s['oldClassPublished'] != s['classPublished']]
    for s in flips:
        ax.annotate('', xy=(s['ageMa'] + jitter, s['oceanDepthKm']), xytext=(s['ageMa'] - jitter, s['oceanDepthKm']),
                    arrowprops=dict(arrowstyle='->', color='red', lw=1))

    ax.invert_yaxis()
    ax.set_ylabel('depth, km')
    ax.set_title(f"{core['name']}  ({core['point']['lon']}, {core['point']['lat']}), "
                  f"Basement Age {core['basementAgeMa']:.1f} Ma -- {len(flips)}/{len(log)} steps changed class")
    handles, labels = ax.get_legend_handles_labels()
    by_label = dict(zip(labels, handles))
    ax.legend(by_label.values(), by_label.keys(), fontsize=8, loc='lower left')

    # probability stack -- the actual "nuance" a probabilistic classifier adds over argmax
    classes = ['clay', 'carbonate-ooze', 'siliceous-ooze']
    probs = {c: [s['probs'][c] for s in log] for c in classes}
    ax2.stackplot(ages, [probs[c] for c in classes], colors=[CLASS_COLOR[c] for c in classes],
                  labels=classes, alpha=0.85)
    ax2.set_ylim(0, 1)
    ax2.set_xlabel('age, Ma before present')
    ax2.set_ylabel('class probability\n(NEW classifier)')
    ax2.legend(fontsize=7, loc='lower left', ncol=3)

    plt.tight_layout()
    plt.savefig(filename, dpi=150)
    plt.close()
    print(f'wrote {filename} ({len(flips)}/{len(log)} steps changed class)')


plot_core(cores[0], '01-equatorial-pacific-before-after.png')
plot_core(cores[1], '02-old-w-atlantic-before-after.png')
