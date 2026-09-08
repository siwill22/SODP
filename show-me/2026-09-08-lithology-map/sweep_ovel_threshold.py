#!/usr/bin/env python3
"""Follow-up to the ADR-0008 fix: the user's eye-check of 01-lithology-map.png
flagged the pattern as "too dominated by upwelling/downwelling". Checked
directly: the Clay/non-Clay boundary in the map is EXACTLY the OVEL<=0
boundary (classifyLithology() checks it first, unconditionally -- see
ADR-0007's own reasoning), and 54% of clay cells sit ABOVE the CCD, where
carbonate should physically survive regardless of productivity.

Tried the obvious structural fix (CCD decides carbonate vs not; OVEL only
breaks the tie below CCD) -- it overcorrects badly in the Pacific (which
the current OVEL-first rule gets almost exactly right: 15.5% vs real 15%).

This script tries the other obvious lever instead of restructuring the
rule's priority: keep the existing OVEL-first structure (classifyLithology()
is NOT changed), but sweep the OVEL threshold itself away from a bare sign
test (`ovel <= threshold`, threshold swept across the real OVEL range
instead of fixed at 0). ADR-0007 explicitly named this as a real free
parameter it was avoiding by using a zero-parameter sign test -- this
sweep is what "revisit this ADR" (its own stated escape hatch) looks like
in practice, run BEFORE picking a value, not after.

classify() below mirrors classifyLithology()'s structure exactly, just
with the threshold parameterized -- reimplemented in Python only for this
multi-threshold sweep, same reasoning as try_ccd_variants.py's docstring.
"""
import json

import numpy as np

HERE = __file__.rsplit('/', 1)[0]
g = json.load(open(f"{HERE}/lithology_grid.json"))
nlon, nlat = g["nlon"], g["nlat"]
depth = np.array(g["oceanDepthKm"], dtype=np.float32).reshape(nlat, nlon)
ovel = np.array(g["ovelCmS"], dtype=np.float32).reshape(nlat, nlon)
ccd = np.array(g["ccdKmUsed"], dtype=np.float32).reshape(nlat, nlon)
basin = np.array(g["basinCode"], dtype=np.uint8).reshape(nlat, nlon)
classes_orig = np.array(g["classes"], dtype=np.uint8).reshape(nlat, nlon)
valid = classes_orig != 255

NAMES = {1: "Atlantic", 2: "Pacific", 3: "Indian"}
REAL_CARB = {"Atlantic": 60, "Pacific": 15, "Indian": 30}  # same figures as try_ccd_variants.py
REAL_GLOBAL = {"carb": 48, "silic": 9.5, "clay": 41}  # Diesing et al. 2020


def classify(threshold):
    cls = np.where(ovel <= threshold, 0, np.where(depth < ccd, 1, 2))
    return np.where(valid, cls, 255)


def props(cls, mask):
    c = cls[mask]
    v = c != 255
    n = v.sum()
    if n == 0:
        return {"carb": float("nan"), "silic": float("nan"), "clay": float("nan")}
    return {
        "carb": 100 * np.mean(c[v] == 1),
        "silic": 100 * np.mean(c[v] == 2),
        "clay": 100 * np.mean(c[v] == 0),
    }


# Sweep thresholds across the real OVEL range (see the percentile check that
# motivated these bounds: p1=-0.00015, p99=0.00034 cm/s).
thresholds = np.linspace(-0.00030, 0.00060, 19)

print(f"{'threshold':>10s} {'Atl carb':>9s} {'Pac carb':>9s} {'Ind carb':>9s} "
      f"{'glob carb':>9s} {'glob silic':>10s} {'glob clay':>9s} {'error':>8s}")
print(f"{'REAL':>10s} {REAL_CARB['Atlantic']:>9.1f} {REAL_CARB['Pacific']:>9.1f} "
      f"{REAL_CARB['Indian']:>9.1f} {REAL_GLOBAL['carb']:>9.1f} {REAL_GLOBAL['silic']:>10.1f} "
      f"{REAL_GLOBAL['clay']:>9.1f} {'--':>8s}")

results = []
for t in thresholds:
    cls = classify(t)
    g_props = props(cls, valid)
    basin_carb = {}
    for code, name in NAMES.items():
        basin_carb[name] = props(cls, valid & (basin == code))["carb"]

    # Simple combined error: sum of absolute errors across the 3 basin
    # carbonate fractions (the contrast the whole investigation started
    # from) plus the 3 global class fractions -- not a formal fit, just a
    # single number to rank candidate thresholds by.
    err = (sum(abs(basin_carb[n] - REAL_CARB[n]) for n in NAMES.values())
           + abs(g_props["carb"] - REAL_GLOBAL["carb"])
           + abs(g_props["silic"] - REAL_GLOBAL["silic"])
           + abs(g_props["clay"] - REAL_GLOBAL["clay"]))

    results.append((t, basin_carb, g_props, err))
    print(f"{t:>10.5f} {basin_carb['Atlantic']:>9.1f} {basin_carb['Pacific']:>9.1f} "
          f"{basin_carb['Indian']:>9.1f} {g_props['carb']:>9.1f} {g_props['silic']:>10.1f} "
          f"{g_props['clay']:>9.1f} {err:>8.1f}")

best = min(results, key=lambda r: r[3])
print(f"\nbest threshold by combined error: {best[0]:.5f} cm/s (error={best[3]:.1f}, "
      f"vs threshold=0 error={results[[r[0] for r in results].index(0.0) if 0.0 in [r[0] for r in results] else 6][3]:.1f})")

json.dump(
    {"thresholds": [float(t) for t, *_ in results],
     "basin_carb": [bc for _, bc, _, _ in results],
     "global": [gp for _, _, gp, _ in results],
     "error": [float(e) for *_, e in results]},
    open(f"{HERE}/ovel_threshold_sweep.json", "w"), indent=2)
print(f"wrote {HERE}/ovel_threshold_sweep.json")
