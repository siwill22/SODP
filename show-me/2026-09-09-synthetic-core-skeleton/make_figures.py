#!/usr/bin/env python3
"""Figures for the Phase 2 Synthetic Core skeleton (src/syntheticCore.ts) --
the first eye-check of a full down-core trajectory + Lithology Class log,
per ADR-0009's own flagged gap ("a real eye-check... against a point with a
geologically interesting history... is still open").

Point: (-150, 15), central/northern Pacific, 85.33 Ma Basement Age --
selected by scanning 8 candidate points (explore_candidates.mjs) for one
that actually exercises the machinery (multiple Lithology Classes, real
CCD-curve divergence), not chosen after the fact to look good.

Reads winner_log.json, written by inspect_winner.mjs from the REAL app
logic (src/syntheticCore.ts's buildAgeDepthModel/buildLithologyLog,
src/lithology.ts, src/ccdCurve.ts) against real data -- nothing here
re-derives the trajectory or classification itself.
"""
import json

import matplotlib.pyplot as plt
import numpy as np
import pygmt

HERE = __file__.rsplit('/', 1)[0]
d = json.load(open(f"{HERE}/winner_log.json"))
pt = d["point"]
basement_age = d["basementAgeMa"]
log = d["log"]
traj = d["trajectory"]

# ---------------------------------------------------------------------------
# Figure 1: paleo-trajectory -- claim: this is a plausible plate-motion
# path (smooth, geologically reasonable), not noise. Colour = age (Ma),
# so the direction of travel through time is readable, not just the path.
# ---------------------------------------------------------------------------
traj_lon = np.array([s["position"]["lon"] for s in traj])
traj_lat = np.array([s["position"]["lat"] for s in traj])
traj_age = np.array([s["ageMa"] for s in traj])

region = [-175, -95, -20, 25]
fig = pygmt.Figure()
pygmt.makecpt(cmap="viridis", series=[0, basement_age], reverse=True)
fig.coast(region=region, projection="M14c", land="grey85", water="white",
          shorelines="0.3p,black", frame=["a10f5", f"+tPaleo-trajectory, ({pt['lon']}, {pt['lat']}) today, "
                                                    f"{basement_age:.1f} Ma Basement Age"])
fig.plot(x=traj_lon, y=traj_lat, pen="1p,grey40")
fig.plot(x=traj_lon, y=traj_lat, style="c0.12c", fill=traj_age, cmap=True, pen="0.3p,black")
fig.plot(x=[pt["lon"]], y=[pt["lat"]], style="s0.35c", fill="red", pen="0.8p,black", label="Today (0 Ma)")
fig.plot(x=[traj_lon[-1]], y=[traj_lat[-1]], style="a0.4c", fill="yellow", pen="0.8p,black",
         label=f"Formation ({basement_age:.1f} Ma)")
fig.colorbar(frame=["x+lAge (Ma)"])
fig.legend(position="JBL+jBL+o0.3c", box="+gwhite+p0.5p")
fig.savefig(f"{HERE}/01-paleo-trajectory.png", dpi=200)
print("wrote 01-paleo-trajectory.png")

# ---------------------------------------------------------------------------
# Figure 2: down-core age-depth-CCD-lithology log -- claim: the log shows
# real class variation (not one flat class down the whole core) and real
# CCD-curve divergence, not asserted from the printed table alone.
# ---------------------------------------------------------------------------
ages = np.array([s["ageMa"] for s in log])
depths = np.array([s["oceanDepthKm"] for s in log])
ovel = np.array([s["ovelCmS"] for s in log])
pub_ccd = np.array([s.get("ccdPublishedKm", np.nan) if s.get("ccdPublishedKm") is not None else np.nan for s in log])
co2_ccd = np.array([s.get("ccdCo2LinkedKm", np.nan) if s.get("ccdCo2LinkedKm") is not None else np.nan for s in log])
primary = [s.get("classPrimary") for s in log]
divergent = np.array([s.get("divergent", False) for s in log])

CLASS_COLOR = {"clay": "#4477aa", "carbonate-ooze": "#ccbb44", "siliceous-ooze": "#228833"}

fig2, ax = plt.subplots(figsize=(10, 6))

# Shade the background by classPrimary in age bands between consecutive
# log steps, so the class sequence down-core is visible at a glance.
for i in range(len(ages) - 1):
    color = CLASS_COLOR.get(primary[i], "white")
    ax.axvspan(ages[i], ages[i + 1], color=color, alpha=0.25, lw=0)

# GDH1 depth curve, from the finer 1 Ma trajectory model (smooth), not the
# coarser OVEL-frame log -- this is pure age/depth geometry, no climate
# dependency, so it can be as fine as buildAgeDepthModel() computed it.
traj_depth = np.array([s["oceanDepthKm"] for s in traj])
ax.plot(traj_age, traj_depth, "-", color="black", lw=1.5, label="GDH1 depth (buildAgeDepthModel)")

ax.plot(ages, pub_ccd, "--", color="#aa3377", lw=1.3, label="Published CCD Curve")
ax.plot(ages, co2_ccd, ":", color="#aa3377", lw=1.3, label="CO2-Linked CCD Curve")

for cls, color in CLASS_COLOR.items():
    mask = [p == cls for p in primary]
    if any(mask):
        ax.scatter(ages[mask], depths[mask], color=color, s=45, zorder=5, edgecolor="black", linewidth=0.5,
                   label=f"classPrimary = {cls}")

ax.scatter(ages[divergent], depths[divergent], marker="x", color="red", s=140, zorder=6, linewidth=2.5,
           label="divergent (Published != CO2-Linked)")

ax.invert_yaxis()
ax.set_xlabel("Age (Ma before present)")
ax.set_ylabel("Depth (km)")
ax.set_title(f"Down-core Lithology Class log, ({pt['lon']}, {pt['lat']}), {basement_age:.1f} Ma Basement Age\n"
             "Shaded bands = classPrimary; red X = Published/CO2-Linked disagree")
ax.legend(fontsize=8, loc="lower left", ncol=2)
ax.grid(alpha=0.25)
fig2.tight_layout()
fig2.savefig(f"{HERE}/02-down-core-log.png", dpi=180)
print("wrote 02-down-core-log.png")

# ---------------------------------------------------------------------------
# Figure 3: OVEL through time at this point -- the productivity input
# driving the class transitions in figure 2, shown on its own so the
# "drifted out of the equatorial upwelling band" claim is checkable
# against the actual signal, not just inferred from the class colours.
# ---------------------------------------------------------------------------
fig3, ax3 = plt.subplots(figsize=(10, 3.5))
ax3.axhline(0, color="grey", lw=1)
ax3.plot(ages, ovel, "-o", color="#ee6677", markersize=4)
ax3.fill_between(ages, ovel, 0, where=(ovel > 0), color="#ee6677", alpha=0.3, label="upwelling (productive)")
ax3.fill_between(ages, ovel, 0, where=(ovel <= 0), color="#4477aa", alpha=0.3, label="downwelling (oligotrophic)")
ax3.set_xlabel("Age (Ma before present)")
ax3.set_ylabel("OVEL (cm/s)")
ax3.set_title("Productivity Signal (OVEL) through time at this point's own paleoposition")
ax3.legend(fontsize=8)
ax3.grid(alpha=0.25)
fig3.tight_layout()
fig3.savefig(f"{HERE}/03-ovel-through-time.png", dpi=180)
print("wrote 03-ovel-through-time.png")

print(f"\nsummary: {len(log)} log steps, {int(divergent.sum())} divergent, "
      f"classes present: {sorted(set(primary))}")
