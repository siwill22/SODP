#!/usr/bin/env python3
"""Combine the raw CCD/CO2 sources in data/ into the two curves CONTEXT.md's
CCD Curve entry and ADR-0005 describe: the Published CCD Curve and the
CO2-Linked CCD Curve. Cross-checked against each other, never averaged into
one -- ADR-0005 is explicit that divergence between them is a diagnostic
signal, not something to resolve here.

Not a Volume/binary output like prep_basement_age.py -- there is no Geode
precedent for a scalar curve-vs-age dataset, so this just writes small JSON
the app fetches directly.

Published CCD Curve
--------------------
data/ccd/*.json holds four regional/basin curves that disagree with each
other and with ADR-0005's "one global curve" decision on what "global" even
means:
  - Pälike et al. (2012): equatorial Pacific, real data, 0-60 Ma
  - Dutkiewicz & Müller (2021): South Atlantic, real data, 0-74 Ma
  - Van Andel (1975): Indian / Atlantic-N / Atlantic-S / Pacific, hand-
    digitized (see data/README.md), 0-110/125/140 Ma depending on basin
Combined here with real data (Pälike, Dutkiewicz) preferred over digitized
(Van Andel) at every age where any real source has coverage -- digitized
values from that age are excluded from the mean entirely, not blended in.
Van Andel only contributes where no real source reaches (currently >55-74
Ma, depending on which real source). This was NOT the first cut: an
unweighted mean across all five sources everywhere pulled the age=0 value to
~5.0 km against Pälike's own real 4.65 km there, because Van Andel's raw
(uncorrected-to-present) basin curves sit systematically 0.3-0.8 km deeper --
confirmed by actually running this and comparing against Pälike's t=0 point,
not assumed. Real-preferred avoids exactly that failure mode. Spread is
still carried through per age step (now only across whichever tier was
used), not thrown away. No value is produced past 140 Ma: ADR-0005
says to flag absence of a cross-check, not fabricate one by extrapolating a
literature curve past where any source actually has data.

CO2-Linked CCD Curve
---------------------
Foster et al. (2017) supplies real CO2(age) across the whole 0-419.5 Ma
basement-age range, but no published CO2->CCD transfer function was found in
the literature -- Tyrrell & Zeebe's work runs the opposite direction (CCD as
an input, carbonate ion as the output). Instead: fit CCD ~ f(CO2) ourselves,
using ONLY Pälike's equatorial-Pacific CCD against Foster's CO2 on their
shared 0-52.25 Ma overlap (not the Van Andel/Dutkiewicz curves too -- mixing
basins into the regression would conflate real basin offsets with the CO2
signal we're actually trying to isolate). Both a linear and a log-linear fit
are tried; whichever has the higher R^2 is applied across the full Foster
CO2 range to produce the final curve. The fit's own R^2 and coefficients are
written into the output, not just the resulting curve -- so a future reader
can judge how much to trust extrapolation into the 60-419.5 Ma range the fit
was never validated against.

Usage:
    python prep_ccd.py
"""

import json
from pathlib import Path

import numpy as np

DATA_DIR = Path("data")
OUT_DIR = Path("archive/ccd")

VAN_ANDEL_MAX_COMBINE_AGE = 140.0
STEP_MA = 1.0


def load_json(path):
    return json.loads(Path(path).read_text())


def regional_series_from_sources():
    """[(source_name, is_real, age_ma[], ccd_km[]), ...] for every regional/basin curve."""
    series = []

    palike = load_json(DATA_DIR / "ccd/palike_2012_equatorial_pacific.json")
    ages, vals = [], []
    for p in palike["data"]:
        m = p["ccd_eq_m"] if p["ccd_eq_m"] is not None else p["ccd_offeq_m"]
        if m is None:
            continue
        ages.append(p["age_ma"]); vals.append(m / 1000.0)
    series.append(("palike_pacific", True, np.array(ages), np.array(vals)))

    dutkiewicz = load_json(DATA_DIR / "ccd/dutkiewicz_muller_2021_south_atlantic.json")
    pts = dutkiewicz["sheets"]["South Atlantic CCD"]
    ages = np.array([p["age_ma"] for p in pts])
    vals = np.array([p["ccd_m"] / 1000.0 for p in pts])
    series.append(("dutkiewicz_south_atlantic", True, ages, vals))

    van_andel = load_json(DATA_DIR / "ccd/van_andel_1975_basins.json")
    for basin, entry in van_andel["basins"].items():
        pts = entry["curve"]
        ages = np.array([p["age_ma"] for p in pts])
        vals = np.array([p["ccd_km"] for p in pts])
        series.append((f"van_andel_{basin}", False, ages, vals))

    return series


def build_published_curve(series):
    real = [(n, a, v) for n, is_real, a, v in series if is_real]
    digitized = [(n, a, v) for n, is_real, a, v in series if not is_real]

    common_ages = np.arange(0.0, VAN_ANDEL_MAX_COMBINE_AGE + STEP_MA, STEP_MA)
    out = []
    for age in common_ages:
        per_source = {}
        for name, ages, vals in real:
            if ages.min() <= age <= ages.max():
                per_source[name] = float(np.interp(age, ages, vals))
        tier = "real"
        if not per_source:
            tier = "digitized"
            for name, ages, vals in digitized:
                if ages.min() <= age <= ages.max():
                    per_source[name] = float(np.interp(age, ages, vals))
        if not per_source:
            continue
        values = np.array(list(per_source.values()))
        out.append({
            "age_ma": round(float(age), 2),
            "ccd_km": round(float(values.mean()), 4),
            "tier": tier,
            "spread_km": round(float(values.max() - values.min()), 4),
            "n_sources": len(per_source),
            "per_source_km": {k: round(v, 4) for k, v in per_source.items()},
        })
    return out


def fit_co2_to_ccd(palike_ages, palike_ccd_km, foster_ages, foster_co2):
    co2_at_palike = np.interp(palike_ages, foster_ages, foster_co2)

    # linear: ccd = a + b*co2
    b_lin, a_lin = np.polyfit(co2_at_palike, palike_ccd_km, 1)
    pred_lin = a_lin + b_lin * co2_at_palike
    r2_lin = 1 - np.sum((palike_ccd_km - pred_lin) ** 2) / np.sum((palike_ccd_km - palike_ccd_km.mean()) ** 2)

    # log-linear: ccd = a + b*ln(co2)
    ln_co2 = np.log(co2_at_palike)
    b_log, a_log = np.polyfit(ln_co2, palike_ccd_km, 1)
    pred_log = a_log + b_log * ln_co2
    r2_log = 1 - np.sum((palike_ccd_km - pred_log) ** 2) / np.sum((palike_ccd_km - palike_ccd_km.mean()) ** 2)

    if r2_log > r2_lin:
        return {"method": "log-linear", "a": float(a_log), "b": float(b_log), "r2": float(r2_log)}
    return {"method": "linear", "a": float(a_lin), "b": float(b_lin), "r2": float(r2_lin)}


def apply_fit(fit, co2):
    if fit["method"] == "log-linear":
        return fit["a"] + fit["b"] * np.log(co2)
    return fit["a"] + fit["b"] * co2


def build_co2_linked_curve(fit, foster_ages, foster_co2):
    ccd = apply_fit(fit, foster_co2)
    return [
        {"age_ma": round(float(a), 4), "ccd_km": round(float(c), 4), "co2_ppm": round(float(p), 2)}
        for a, c, p in zip(foster_ages, ccd, foster_co2)
    ]


def main():
    series = regional_series_from_sources()
    print("regional sources:")
    for name, is_real, ages, vals in series:
        tag = "real" if is_real else "digitized"
        print(f"  {name:28s} [{tag:9s}] {len(ages):4d} pts  {ages.min():6.2f}-{ages.max():6.2f} Ma"
              f"  ccd {vals.min():.2f}-{vals.max():.2f} km")

    published = build_published_curve(series)
    n_real_steps = sum(1 for p in published if p["tier"] == "real")
    print(f"\npublished curve: {len(published)} steps, 0-{published[-1]['age_ma']} Ma"
          f"  ({n_real_steps} real-tier, {len(published) - n_real_steps} digitized-tier)")
    print(f"  mean spread across sources: {np.mean([p['spread_km'] for p in published]):.3f} km")
    print(f"  age=0: {published[0]['ccd_km']:.3f} km (tier={published[0]['tier']},"
          f" sources={list(published[0]['per_source_km'].keys())})")

    palike = load_json(DATA_DIR / "ccd/palike_2012_equatorial_pacific.json")
    p_ages, p_ccd = [], []
    for p in palike["data"]:
        if p["ccd_eq_m"] is None:
            continue
        p_ages.append(p["age_ma"]); p_ccd.append(p["ccd_eq_m"] / 1000.0)
    p_ages, p_ccd = np.array(p_ages), np.array(p_ccd)

    foster = load_json(DATA_DIR / "co2/foster_royer_lunt_2017_loess.json")
    f_ages = np.array([p["age_ma"] for p in foster["data"]])
    f_co2 = np.array([p["co2_ppm"] for p in foster["data"]])

    fit = fit_co2_to_ccd(p_ages, p_ccd, f_ages, f_co2)
    print(f"\nCO2->CCD fit: {fit['method']}  a={fit['a']:.4f}  b={fit['b']:.6f}  R^2={fit['r2']:.3f}"
          f"  (fit on {len(p_ages)} points, {p_ages.min():.1f}-{p_ages.max():.1f} Ma)")

    co2_linked = build_co2_linked_curve(fit, f_ages, f_co2)

    overlap_age = np.array([p["age_ma"] for p in published])
    overlap_pub = np.array([p["ccd_km"] for p in published])
    co2_at_overlap = np.interp(overlap_age, [c["age_ma"] for c in co2_linked], [c["ccd_km"] for c in co2_linked])
    rmse = float(np.sqrt(np.mean((overlap_pub - co2_at_overlap) ** 2)))
    print(f"\nPublished vs CO2-Linked over their shared 0-{overlap_age.max():.0f} Ma range: RMSE {rmse:.3f} km")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "published_ccd_curve.json").write_text(json.dumps({
        "description": "Global Published CCD Curve: unweighted mean across regional/basin "
                        "sources at each age. See prep_ccd.py's module doc for method and caveats.",
        "sources": [name for name, _, _, _ in series],
        "age_range_ma": [0, VAN_ANDEL_MAX_COMBINE_AGE],
        "curve": published,
    }, indent=2))

    (OUT_DIR / "co2_linked_ccd_curve.json").write_text(json.dumps({
        "description": "CO2-Linked CCD Curve: Foster et al. (2017) CO2(age) run through a "
                        "CCD~f(CO2) regression fit to Pälike et al. (2012)'s 0-52.25 Ma "
                        "equatorial-Pacific overlap. Not validated beyond that range -- see fit.r2.",
        "fit": fit,
        "fit_age_range_ma": [float(p_ages.min()), float(p_ages.max())],
        "age_range_ma": [float(f_ages.min()), float(f_ages.max())],
        "curve": co2_linked,
    }, indent=2))
    print(f"\nwrote {OUT_DIR / 'published_ccd_curve.json'}")
    print(f"wrote {OUT_DIR / 'co2_linked_ccd_curve.json'}")


if __name__ == "__main__":
    main()
