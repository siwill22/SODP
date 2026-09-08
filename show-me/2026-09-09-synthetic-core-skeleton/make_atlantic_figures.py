#!/usr/bin/env python3
"""Figures for young/shallow Atlantic crust -- user follow-up request after
the old Pacific set: does the model behave sensibly for shallow crust that
never gets near the CCD, and across a latitude spread (South/equatorial/
North Atlantic)? Same real app logic, same conventions as
make_figures.py/make_more_figures.py. Reads atlantic_points_log.json,
written by compute_atlantic_points.mjs -- nothing re-derived here.
"""
import json

import matplotlib.pyplot as plt
import numpy as np
import pygmt

HERE = __file__.rsplit('/', 1)[0]
points = json.load(open(f"{HERE}/atlantic_points_log.json"))

CLASS_COLOR = {"clay": "#4477aa", "carbonate-ooze": "#ccbb44", "siliceous-ooze": "#228833"}
POINT_COLORS = ["#d62728", "#1f77b4", "#2ca02c"]

# ---------------------------------------------------------------------------
# Figure 6: three Atlantic trajectories on one map.
# ---------------------------------------------------------------------------
region = [-45, -5, -50, 60]
fig = pygmt.Figure()
fig.coast(region=region, projection="M12c", land="grey85", water="white", shorelines="0.3p,black",
          frame=["a10f5", "+tThree young Atlantic trajectories -- South / equatorial / North"])
for p, color in zip(points, POINT_COLORS):
    lons = [s["position"]["lon"] for s in p["trajectory"]]
    lats = [s["position"]["lat"] for s in p["trajectory"]]
    fig.plot(x=lons, y=lats, pen=f"1.3p,{color}")
    fig.plot(x=[lons[0]], y=[lats[0]], style="s0.3c", fill=color, pen="0.8p,black")
    fig.plot(x=[lons[-1]], y=[lats[-1]], style="a0.4c", fill=color, pen="0.8p,black",
              label=f"{p['point']['name']}, {p['basementAgeMa']:.0f} Ma")
fig.legend(position="JBR+jBR+o0.3c", box="+gwhite+p0.5p")
fig.savefig(f"{HERE}/06-atlantic-trajectories.png", dpi=200)
print("wrote 06-atlantic-trajectories.png")

# ---------------------------------------------------------------------------
# Figure 7: down-core logs, three Atlantic points, shared depth axis --
# NOTE the axis range is much shallower than figure 5's Pacific set (2.4-4.5
# km vs 2.4-5.7 km) -- these points never subside far enough for GDH1 to
# approach the CCD at all, which is exactly the "younger, shallower" claim
# under test: does Siliceous Ooze ever appear here? (it should not, and
# doesn't -- see the class legend actually used in each panel title.)
# ---------------------------------------------------------------------------
all_depths = [s["oceanDepthKm"] for p in points for s in p["trajectory"]]
depth_min, depth_max = min(all_depths), max(all_depths)
age_max = max(p["basementAgeMa"] for p in points)

# Both CCD curves over the shared age range, for reference on every panel.
published_curve = json.load(open(f"{HERE}/../../archive/ccd/published_ccd_curve.json"))
co2_curve = json.load(open(f"{HERE}/../../archive/ccd/co2_linked_ccd_curve.json"))

fig2, axes = plt.subplots(len(points), 1, figsize=(9, 3.6 * len(points)), sharex=True)
for ax, p in zip(axes, points):
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
    ax.plot(traj_age, traj_depth, "-", color="black", lw=1.3, label="GDH1 depth")
    ax.plot(ages, pub_ccd, "--", color="#aa3377", lw=1.1, label="Published CCD")
    ax.plot(ages, co2_ccd, ":", color="#aa3377", lw=1.1, label="CO2-Linked CCD")
    for cls, color in CLASS_COLOR.items():
        mask = [c == cls for c in primary]
        if any(mask):
            ax.scatter(ages[mask], depths[mask], color=color, s=45, zorder=5, edgecolor="black",
                       linewidth=0.5, label=f"classPrimary = {cls}")
    if divergent.any():
        ax.scatter(ages[divergent], depths[divergent], marker="x", color="red", s=120, zorder=6,
                   linewidth=2.2, label="divergent")

    ylim_bottom = depth_max + 0.3
    ax.set_ylim(ylim_bottom, depth_min - 0.3)  # shared, inverted
    ax.set_xlim(-1, age_max + 1)
    ax.set_ylabel("Depth (km)")
    n_classes = len(set(primary))
    ax.set_title(f"{p['point']['name']} ({p['point']['lon']}, {p['point']['lat']}), {p['basementAgeMa']:.1f} Ma -- "
                 f"classes: {sorted(set(primary))}", fontsize=10)
    ax.legend(fontsize=7, loc="upper left", ncol=3)
    ax.grid(alpha=0.25)
    # Both CCD curves sit almost entirely below this panel's y-range (real
    # depths here never get close) -- annotate explicitly, with the actual
    # numbers, rather than let a barely-visible dashed corner speak for
    # itself or read as a rendering glitch.
    ccd_here = np.concatenate([pub_ccd, co2_ccd])
    ccd_here = ccd_here[np.isfinite(ccd_here)]
    ax.text(0.99, 0.03, f"CCD curves this age range: {ccd_here.min():.2f}-{ccd_here.max():.2f} km "
            f"(this panel's depth never exceeds {depths.max():.2f} km)",
            transform=ax.transAxes, ha="right", va="bottom", fontsize=7.5, style="italic", color="#aa3377")

axes[-1].set_xlabel("Age (Ma before present)")
fig2.suptitle("Young Atlantic crust never reaches the CCD -- Siliceous Ooze should never appear here", fontsize=12)
fig2.tight_layout()
fig2.savefig(f"{HERE}/07-atlantic-down-core-logs.png", dpi=170)
print("wrote 07-atlantic-down-core-logs.png")

all_classes = sorted({s.get("classPrimary") for p in points for s in p["log"] if s.get("classPrimary")})
print(f"\nclasses seen across all 3 Atlantic points: {all_classes} "
      f"({'Siliceous Ooze absent, as expected' if 'siliceous-ooze' not in all_classes else 'Siliceous Ooze appeared -- unexpected, investigate'})")
