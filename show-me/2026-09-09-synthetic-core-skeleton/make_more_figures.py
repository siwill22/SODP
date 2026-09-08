#!/usr/bin/env python3
"""Follow-up figures testing whether the first point's story (-150,15:
clean drift, real class variation, real divergence) generalizes across
other points, or was a lucky pick -- three more points from
explore_candidates.mjs's own scan, computed by compute_more_points.mjs.
Same real app logic, same plotting conventions as make_figures.py, laid
out as small multiples with SHARED axes so the points are directly
comparable, not just individually plausible.
"""
import json

import matplotlib.pyplot as plt
import numpy as np
import pygmt

HERE = __file__.rsplit('/', 1)[0]
results = json.load(open(f"{HERE}/more_points_log.json"))
winner = json.load(open(f"{HERE}/winner_log.json"))  # the original (-150,15) point, for the combined map

CLASS_COLOR = {"clay": "#4477aa", "carbonate-ooze": "#ccbb44", "siliceous-ooze": "#228833"}
ALL_POINTS = [{"name": "(-150, 15) -- original", **winner}] + [
    {"name": r["point"]["name"] + f" ({r['point']['lon']}, {r['point']['lat']})", **r} for r in results
]
POINT_COLORS = ["#d62728", "#1f77b4", "#2ca02c", "#9467bd"]

# ---------------------------------------------------------------------------
# Figure 4: all four trajectories on one map -- claim: these all look like
# plausible, DIFFERENT plate-motion paths (not the same path repeated, not
# noise), each consistent with the same general Pacific plate motion sense.
#
# Two of the four (NW Pacific/Emperor-ish, W Pacific) cross the antimeridian
# -- confirmed by checking their raw longitude ranges directly (both span
# essentially -180 to +180). A naive region=[-180,-95,...] silently clips
# or wraps those paths into nonsense; unwrapping into a continuous 0-360
# sequence per trajectory (so a path near +179 followed by -179 becomes
# +179 -> +181, not a fake jump across the whole Pacific) and plotting in
# that frame is the actual fix, not a cosmetic one -- the first version of
# this figure showed a badly wrong, truncated path for the W Pacific point.
# ---------------------------------------------------------------------------
def unwrap_lon_360(lons):
    """Continuous 0-360 longitude sequence -- no jump ever exceeds 180 deg."""
    out = [lons[0] % 360]
    for lo in lons[1:]:
        lo360 = lo % 360
        prev = out[-1]
        # bring lo360 to within 180 of prev by adding/subtracting whole turns
        while lo360 - prev > 180:
            lo360 -= 360
        while lo360 - prev < -180:
            lo360 += 360
        out.append(lo360)
    return out

region = [100, 280, -40, 45]  # 0-360 convention, Pacific-centred, covers all four paths
fig = pygmt.Figure()
fig.coast(region=region, projection="M16c", land="grey85", water="white", shorelines="0.3p,black",
          frame=["a10f5", "+tFour paleo-trajectories -- does the pattern generalize, not just one lucky point?"])
for p, color in zip(ALL_POINTS, POINT_COLORS):
    raw_lons = [s["position"]["lon"] for s in p["trajectory"]]
    lats = [s["position"]["lat"] for s in p["trajectory"]]
    lons = unwrap_lon_360(raw_lons)
    fig.plot(x=lons, y=lats, pen=f"1.3p,{color}")
    fig.plot(x=[lons[0]], y=[lats[0]], style="s0.3c", fill=color, pen="0.8p,black")
    fig.plot(x=[lons[-1]], y=[lats[-1]], style="a0.4c", fill=color, pen="0.8p,black",
              label=f"{p['name']}, {p['basementAgeMa']:.0f} Ma")
fig.legend(position="JBL+jBL+o0.3c", box="+gwhite+p0.5p")
fig.savefig(f"{HERE}/04-four-trajectories.png", dpi=200)
print("wrote 04-four-trajectories.png")

# ---------------------------------------------------------------------------
# Figure 5: down-core logs, small multiples, SHARED depth axis -- claim:
# real class variation and divergence aren't unique to the first point,
# but also aren't universal (the "boring" W Pacific point is shown as-is,
# not dropped for being uninteresting).
# ---------------------------------------------------------------------------
all_depths = [s["oceanDepthKm"] for p in ALL_POINTS for s in p["trajectory"]]
depth_min, depth_max = min(all_depths), max(all_depths)
all_ages = [p["basementAgeMa"] for p in ALL_POINTS]
age_max = max(all_ages)

fig2, axes = plt.subplots(len(ALL_POINTS), 1, figsize=(10, 4 * len(ALL_POINTS)), sharex=True)
for ax, p in zip(axes, ALL_POINTS):
    log = p["log"]
    traj = p["trajectory"]
    ages = np.array([s["ageMa"] for s in log])
    depths = np.array([s["oceanDepthKm"] for s in log])
    primary = [s.get("classPrimary") for s in log]
    divergent = np.array([s.get("divergent", False) for s in log])
    pub_ccd = np.array([s.get("ccdPublishedKm") if s.get("ccdPublishedKm") is not None else np.nan for s in log])
    co2_ccd = np.array([s.get("ccdCo2LinkedKm") if s.get("ccdCo2LinkedKm") is not None else np.nan for s in log])

    for i in range(len(ages) - 1):
        ax.axvspan(ages[i], ages[i + 1], color=CLASS_COLOR.get(primary[i], "white"), alpha=0.25, lw=0)

    traj_age = np.array([s["ageMa"] for s in traj])
    traj_depth = np.array([s["oceanDepthKm"] for s in traj])
    ax.plot(traj_age, traj_depth, "-", color="black", lw=1.3)
    ax.plot(ages, pub_ccd, "--", color="#aa3377", lw=1.1)
    ax.plot(ages, co2_ccd, ":", color="#aa3377", lw=1.1)
    for cls, color in CLASS_COLOR.items():
        mask = [c == cls for c in primary]
        if any(mask):
            ax.scatter(ages[mask], depths[mask], color=color, s=35, zorder=5, edgecolor="black", linewidth=0.4)
    if divergent.any():
        ax.scatter(ages[divergent], depths[divergent], marker="x", color="red", s=110, zorder=6, linewidth=2.2)

    ax.set_ylim(depth_max + 0.2, depth_min - 0.2)  # shared, inverted
    ax.set_xlim(-2, age_max + 2)
    ax.set_ylabel("Depth (km)")
    n_classes = len(set(primary))
    ax.set_title(f"{p['name']}, {p['basementAgeMa']:.1f} Ma -- {n_classes} class(es), "
                 f"{int(divergent.sum())} divergent step(s)", fontsize=10)
    ax.grid(alpha=0.25)

axes[-1].set_xlabel("Age (Ma before present)")
handles = [plt.Line2D([0], [0], color="black", lw=1.3, label="GDH1 depth"),
           plt.Line2D([0], [0], color="#aa3377", ls="--", label="Published CCD"),
           plt.Line2D([0], [0], color="#aa3377", ls=":", label="CO2-Linked CCD")]
handles += [plt.Line2D([0], [0], marker="o", color="w", markerfacecolor=c, markeredgecolor="black",
                        markersize=7, label=k) for k, c in CLASS_COLOR.items()]
handles += [plt.Line2D([0], [0], marker="x", color="red", lw=0, markersize=9, markeredgewidth=2, label="divergent")]
fig2.legend(handles=handles, loc="upper center", ncol=4, bbox_to_anchor=(0.5, 1.0), fontsize=8)
fig2.suptitle("Down-core logs, four points, shared depth axis -- does the story generalize?", y=1.02, fontsize=13)
fig2.tight_layout()
fig2.savefig(f"{HERE}/05-four-down-core-logs.png", dpi=170, bbox_inches="tight")
print("wrote 05-four-down-core-logs.png")
