#!/usr/bin/env python3
"""Figures testing claims made about the CCD Curve build (prep_ccd.py).

Reads only files that exist on disk under SODP/data/ and SODP/archive/ --
nothing here is a remembered number from the conversation. The "naive
unweighted mean" comparison in figure 3 is RE-DERIVED live from the same
source JSON the real-preferred method reads, not copied from an earlier run.

Usage:
    conda run -n pygmt17 python make_figures.py
"""
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

ROOT = Path("/Users/simon/GIT/SODP")
DATA = ROOT / "data"
ARCHIVE = ROOT / "archive"
OUT = Path(__file__).parent

REAL_COLOR = "#1b7837"
DIGITIZED_COLOR = "#b35806"
PUBLISHED_COLOR = "#1b1b1b"
CO2_COLOR = "#762a83"

BASIN_COLORS = {
    "indian": "#e08214",
    "atlantic_south": "#d6604d",
    "atlantic_north": "#4393c3",
    "pacific": "#7fbc41",
}


def load(path):
    return json.loads((ROOT / path).read_text())


# ---------------------------------------------------------------------------
# Load every source exactly as prep_ccd.py does
# ---------------------------------------------------------------------------

palike = load("data/ccd/palike_2012_equatorial_pacific.json")
p_ages = np.array([p["age_ma"] for p in palike["data"] if p["ccd_eq_m"] is not None])
p_ccd = np.array([p["ccd_eq_m"] / 1000.0 for p in palike["data"] if p["ccd_eq_m"] is not None])

dutkiewicz = load("data/ccd/dutkiewicz_muller_2021_south_atlantic.json")
d_pts = dutkiewicz["sheets"]["South Atlantic CCD"]
d_ages = np.array([p["age_ma"] for p in d_pts])
d_ccd = np.array([p["ccd_m"] / 1000.0 for p in d_pts])

van_andel = load("data/ccd/van_andel_1975_basins.json")
va_curves = {}
for basin, entry in van_andel["basins"].items():
    pts = entry["curve"]
    va_curves[basin] = (
        np.array([p["age_ma"] for p in pts]),
        np.array([p["ccd_km"] for p in pts]),
    )

published = load("archive/ccd/published_ccd_curve.json")["curve"]
pub_age = np.array([p["age_ma"] for p in published])
pub_ccd = np.array([p["ccd_km"] for p in published])
pub_tier = np.array([p["tier"] for p in published])
pub_spread = np.array([p["spread_km"] for p in published])

co2_linked = load("archive/ccd/co2_linked_ccd_curve.json")
co2_meta = co2_linked
co2_curve = co2_linked["curve"]
c_age = np.array([p["age_ma"] for p in co2_curve])
c_ccd = np.array([p["ccd_km"] for p in co2_curve])
c_co2 = np.array([p["co2_ppm"] for p in co2_curve])
fit = co2_meta["fit"]

AGE_MAX = 140.0

# ---------------------------------------------------------------------------
# Figure 1: regional source curves -- do they actually disagree?
# ---------------------------------------------------------------------------

fig, ax = plt.subplots(figsize=(8, 6))
ax.plot(p_ages, p_ccd, color=REAL_COLOR, lw=2.2, label="Pälike 2012 (eq. Pacific) -- real")
ax.plot(d_ages, d_ccd, color=REAL_COLOR, lw=2.2, ls="--", label="Dutkiewicz & Müller 2021 (S. Atlantic) -- real")
for basin, (a, v) in va_curves.items():
    ax.plot(a, v, color=BASIN_COLORS[basin], lw=1.4, ls=":",
             label=f"Van Andel 1975 {basin.replace('_', ' ')} -- digitized")
ax.set_xlim(0, AGE_MAX)
ax.invert_yaxis()
ax.set_xlabel("Age (Ma)")
ax.set_ylabel("CCD depth (km)")
ax.set_title("Claim: regional/basin CCD sources genuinely disagree\n(this is why ADR-0005 treats divergence as a signal, not noise)")
ax.legend(fontsize=8, loc="lower right")
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(OUT / "01-regional-sources-disagree.png", dpi=150)
plt.close(fig)

# ---------------------------------------------------------------------------
# Figure 2: Published Curve, tier-coded, with spread band
# ---------------------------------------------------------------------------

fig, ax = plt.subplots(figsize=(8, 6))
ax.fill_between(pub_age, pub_ccd - pub_spread / 2, pub_ccd + pub_spread / 2,
                 color="grey", alpha=0.25, label="spread across sources used at that age")
real_mask = pub_tier == "real"
ax.plot(pub_age[real_mask], pub_ccd[real_mask], color=REAL_COLOR, lw=2.5, label="Published Curve -- real tier")
ax.plot(pub_age[~real_mask], pub_ccd[~real_mask], color=DIGITIZED_COLOR, lw=2.5, label="Published Curve -- digitized tier")
transition = pub_age[~real_mask].min() if (~real_mask).any() else None
if transition is not None:
    ax.axvline(transition, color="black", ls="--", lw=1, alpha=0.6)
    ax.annotate(f"real -> digitized\nat {transition:.0f} Ma", xy=(transition, ax.get_ylim()[0]),
                xytext=(transition + 3, 5.3), fontsize=8, ha="left")
ax.set_xlim(0, AGE_MAX)
ax.invert_yaxis()
ax.set_xlabel("Age (Ma)")
ax.set_ylabel("CCD depth (km)")
ax.set_title("Claim: real data drives the curve wherever it exists;\nVan Andel only fills in past real coverage")
ax.legend(fontsize=8, loc="lower right")
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(OUT / "02-published-curve-tiers.png", dpi=150)
plt.close(fig)

# ---------------------------------------------------------------------------
# Figure 3: the bug fix, re-derived live (not hard-coded) -- unweighted mean
# vs real-preferred, same source data
# ---------------------------------------------------------------------------

all_series = [
    ("palike_pacific", True, p_ages, p_ccd),
    ("dutkiewicz_south_atlantic", True, d_ages, d_ccd),
] + [(f"van_andel_{b}", False, a, v) for b, (a, v) in va_curves.items()]

common_ages = np.arange(0.0, AGE_MAX + 1.0, 1.0)


def unweighted_mean_curve():
    out_age, out_ccd = [], []
    for age in common_ages:
        vals = [np.interp(age, a, v) for _, _, a, v in all_series if a.min() <= age <= a.max()]
        if vals:
            out_age.append(age)
            out_ccd.append(np.mean(vals))
    return np.array(out_age), np.array(out_ccd)


def real_preferred_curve():
    out_age, out_ccd = [], []
    for age in common_ages:
        real_vals = [np.interp(age, a, v) for _, is_real, a, v in all_series if is_real and a.min() <= age <= a.max()]
        vals = real_vals if real_vals else [np.interp(age, a, v) for _, is_real, a, v in all_series if not is_real and a.min() <= age <= a.max()]
        if vals:
            out_age.append(age)
            out_ccd.append(np.mean(vals))
    return np.array(out_age), np.array(out_ccd)


naive_age, naive_ccd = unweighted_mean_curve()
fixed_age, fixed_ccd = real_preferred_curve()

fig, ax = plt.subplots(figsize=(8, 6))
ax.plot(naive_age, naive_ccd, color="#b2182b", lw=2, label="naive unweighted mean (all 6 sources, every age)")
ax.plot(fixed_age, fixed_ccd, color=REAL_COLOR, lw=2, label="real-preferred (what prep_ccd.py actually does)")
ax.scatter([0], [p_ccd[np.argmin(p_ages)]], color="black", zorder=5, s=40,
           label=f"Pälike's own age=0 point ({p_ccd[np.argmin(p_ages)]:.3f} km)")
ax.set_xlim(0, AGE_MAX)
ax.invert_yaxis()
ax.set_xlabel("Age (Ma)")
ax.set_ylabel("CCD depth (km)")
naive_0 = naive_ccd[np.argmin(naive_age)]
fixed_0 = fixed_ccd[np.argmin(fixed_age)]
ax.set_title(f"Claim: the real-preferred fix mattered\nage=0: naive mean {naive_0:.3f} km vs real-preferred {fixed_0:.3f} km "
             f"vs Pälike's real point {p_ccd[np.argmin(p_ages)]:.3f} km")
ax.legend(fontsize=8, loc="lower right")
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(OUT / "03-bug-fix-before-after.png", dpi=150)
plt.close(fig)

# ---------------------------------------------------------------------------
# Figure 4: CO2->CCD regression -- how good is the fit actually?
# ---------------------------------------------------------------------------

co2_at_palike = np.interp(p_ages, c_age, c_co2)
if fit["method"] == "log-linear":
    pred = fit["a"] + fit["b"] * np.log(co2_at_palike)
else:
    pred = fit["a"] + fit["b"] * co2_at_palike

fig, axes = plt.subplots(1, 2, figsize=(11, 5))
ax = axes[0]
order = np.argsort(co2_at_palike)
ax.scatter(co2_at_palike, p_ccd, s=18, color=REAL_COLOR, alpha=0.7, label="Pälike CCD vs Foster CO2 (0-52.2 Ma)")
ax.plot(co2_at_palike[order], pred[order], color=CO2_COLOR, lw=2, label=f"{fit['method']} fit, R²={fit['r2']:.2f}")
ax.invert_yaxis()
ax.set_xlabel("CO2 (ppm, Foster et al. 2017)")
ax.set_ylabel("CCD depth (km, Pälike 2012)")
ax.set_title("Fit used for the CO2-Linked Curve")
ax.legend(fontsize=8)
ax.grid(alpha=0.3)

ax = axes[1]
residual = p_ccd - pred
ax.axhline(0, color="black", lw=1)
ax.scatter(p_ages, residual, s=18, color=CO2_COLOR, alpha=0.7)
ax.set_xlabel("Age (Ma)")
ax.set_ylabel("residual: real CCD - fit prediction (km)")
ax.set_title(f"Claim: R²={fit['r2']:.2f} means CO2 alone leaves real structure unexplained")
ax.grid(alpha=0.3)
fig.suptitle("CO2->CCD regression quality (the fit the CO2-Linked Curve is built from)")
fig.tight_layout()
fig.savefig(OUT / "04-co2-ccd-fit-quality.png", dpi=150)
plt.close(fig)

# ---------------------------------------------------------------------------
# Figure 5: Published vs CO2-Linked -- the claimed divergence, plus the
# CO2-Linked curve's much longer reach
# ---------------------------------------------------------------------------

c_at_pub_age = np.interp(pub_age, c_age, c_ccd)
residual_pub_co2 = pub_ccd - c_at_pub_age
rmse = float(np.sqrt(np.mean(residual_pub_co2 ** 2)))

fig, axes = plt.subplots(2, 1, figsize=(9, 8), height_ratios=[2, 1], sharex=False)

ax = axes[0]
ax.plot(c_age, c_ccd, color=CO2_COLOR, lw=1.6, label=f"CO2-Linked Curve (fit applied to Foster CO2, 0-{c_age.max():.0f} Ma)")
ax.plot(pub_age, pub_ccd, color=PUBLISHED_COLOR, lw=2.2, label=f"Published Curve (real+digitized, 0-{AGE_MAX:.0f} Ma)")
ax.axvspan(AGE_MAX, c_age.max(), color=CO2_COLOR, alpha=0.06)
ax.annotate("CO2-Linked Curve only\n(no Published Curve to cross-check against)",
            xy=(AGE_MAX + 20, ax.get_ylim()[0] if ax.get_ylim()[0] else 3.0),
            fontsize=8, color=CO2_COLOR, va="top")
ax.invert_yaxis()
ax.set_ylabel("CCD depth (km)")
ax.set_title(f"Claim: the two curves diverge by RMSE={rmse:.3f} km over their shared 0-{AGE_MAX:.0f} Ma range\n"
             f"(CO2-Linked Curve extrapolates to {c_age.max():.0f} Ma with no independent check past {AGE_MAX:.0f} Ma)")
ax.legend(fontsize=8, loc="lower right")
ax.grid(alpha=0.3)

ax = axes[1]
ax.axhline(0, color="black", lw=1)
ax.fill_between(pub_age, 0, residual_pub_co2, color="#762a83", alpha=0.4)
ax.plot(pub_age, residual_pub_co2, color="#762a83", lw=1.5)
ax.set_xlabel("Age (Ma)")
ax.set_ylabel("Published - CO2-Linked (km)")
ax.set_title("residual (positive = Published Curve reads deeper)")
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(OUT / "05-published-vs-co2linked-divergence.png", dpi=150)
plt.close(fig)

print("wrote 5 figures to", OUT)
print(f"naive mean age=0: {naive_0:.4f} km | real-preferred age=0: {fixed_0:.4f} km "
      f"| Pälike real age=0: {p_ccd[np.argmin(p_ages)]:.4f} km")
print(f"CO2->CCD fit: {fit['method']} R^2={fit['r2']:.4f}")
print(f"Published vs CO2-Linked RMSE (re-derived here): {rmse:.4f} km")
