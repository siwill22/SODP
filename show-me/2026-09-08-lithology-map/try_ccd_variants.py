#!/usr/bin/env python3
"""Try several basin-specific CCD variants against the already-computed
ocean-depth/OVEL grids (lithology_grid.json), to see which -- if any --
actually resolves the flattened Atlantic/Pacific/Indian contrast diagnosed
in basin_diagnosis.py, before committing to one in src/lithology.ts.

classify() below mirrors src/lithology.ts's classifyLithology() exactly
(same 3-line rule, ADR-0007) -- reimplemented in Python here ONLY for this
multi-variant comparison, since re-running the real TS through tsx four
times just to swap one scalar per basin isn't worth the round-trip. Not a
permanent duplicate: once a variant is chosen, the actual fix goes into
src/lithology.ts + compute_lithology.mjs, not here.
"""
import json

import numpy as np

HERE = __file__.rsplit('/', 1)[0]
g = json.load(open(f"{HERE}/lithology_grid.json"))
nlon, nlat = g["nlon"], g["nlat"]
depth = np.array(g["oceanDepthKm"], dtype=np.float32).reshape(nlat, nlon)
ovel = np.array(g["ovelCmS"], dtype=np.float32).reshape(nlat, nlon)
basin = np.load(f"{HERE}/basin_grid.npy")

NAMES = {1: "Atlantic", 2: "Pacific", 3: "Indian"}
REAL_APPROX = {"Atlantic": 60, "Pacific": 15, "Indian": 30}  # Indian: rough

VARIANTS = {
    "baseline (single global, Palike 4.65)": {1: 4.65, 2: 4.65, 3: 4.65},
    "Van Andel per-basin (Pac 4.65 / Atl 5.45 / Ind 5.00)": {1: 5.45, 2: 4.65, 3: 5.00},
    "Dutkiewicz-smoothed Atl (4.55) + Palike Pac (4.65) + Van Andel Ind (5.00)": {1: 4.55, 2: 4.65, 3: 5.00},
    "literature reference (Pac 4.35 / Atl 5.00 / Ind 4.30)": {1: 5.00, 2: 4.35, 3: 4.30},
}


def classify(depth_km, ccd_km, ovel_cms):
    if ovel_cms <= 0:
        return 0  # clay
    if depth_km < ccd_km:
        return 1  # carbonate-ooze
    return 2  # siliceous-ooze


results = {}
for variant_name, ccd_by_basin in VARIANTS.items():
    row = {}
    for code, name in NAMES.items():
        mask = basin == code
        d = depth[mask]
        o = ovel[mask]
        valid = np.isfinite(d) & np.isfinite(o)
        ccd = ccd_by_basin[code]
        cls = np.array([classify(dv, ccd, ov) for dv, ov in zip(d[valid], o[valid])])
        row[name] = {
            "clay_pct": round(100 * np.mean(cls == 0), 1),
            "carbonate_pct": round(100 * np.mean(cls == 1), 1),
            "siliceous_pct": round(100 * np.mean(cls == 2), 1),
        }
    results[variant_name] = row

print(f"{'variant':<62s} {'Atl carb%':>10s} {'Pac carb%':>10s} {'Ind carb%':>10s}   Atl>Pac? (should be True)")
print(f"{'REAL WORLD (approx)':<62s} {REAL_APPROX['Atlantic']:>10d} {REAL_APPROX['Pacific']:>10d} {REAL_APPROX['Indian']:>10d}   True")
for name, row in results.items():
    a, p, i = row["Atlantic"]["carbonate_pct"], row["Pacific"]["carbonate_pct"], row["Indian"]["carbonate_pct"]
    print(f"{name:<62s} {a:>10.1f} {p:>10.1f} {i:>10.1f}   {a > p}")

json.dump(results, open(f"{HERE}/ccd_variant_results.json", "w"), indent=2)
print(f"\nwrote {HERE}/ccd_variant_results.json")
