#!/usr/bin/env python3
"""Follow-up diagnosis, now re-run AFTER the ADR-0008 fix (real bathymetry +
per-basin CCD, see compute_lithology.mjs) to confirm how much of the
original carbonate-ooze under-representation/flat-basin-contrast finding
that fix actually closes, against a REAL ocean-basin mask (NOAA WOA13
basinmask_01.msk, not a crude longitude-band guess).
"""
import json

import matplotlib.pyplot as plt
import numpy as np

HERE = __file__.rsplit('/', 1)[0]
g = json.load(open(f"{HERE}/lithology_grid.json"))
nlon, nlat = g["nlon"], g["nlat"]
classes = np.array(g["classes"], dtype=np.uint8).reshape(nlat, nlon)
basin = np.array(g["basinCode"], dtype=np.uint8).reshape(nlat, nlon)

# The basin mask itself is shown in 04-basin-mask-used.png (make_figures.py)
# -- not re-plotted here to avoid a duplicate figure.
names = {1: "Atlantic", 2: "Pacific", 3: "Indian"}

# --- model (post ADR-0008 fix) vs real-world carbonate-ooze fraction, by basin ---
model_carbonate = {}
for code, name in names.items():
    c = classes[basin == code]
    valid = c != 255
    model_carbonate[name] = 100 * np.mean(c[valid] == 1)

# Real-world figures cited in the conversation's own web checks (Diesing et
# al. 2020 for the global calcareous figure; the Atlantic~60%/Pacific~15%
# calcareous contrast is a commonly cited approximate figure, not from a
# single pinned source the way Diesing's global number is -- flagged as
# such, not presented with false precision).
real_carbonate_approx = {"Atlantic": 60, "Pacific": 15, "Indian": 30}  # Indian: rough, low-confidence

fig2, ax = plt.subplots(figsize=(7, 5))
xpos = np.arange(3)
w = 0.35
names_order = ["Atlantic", "Pacific", "Indian"]
ax.bar(xpos - w / 2, [real_carbonate_approx[n] for n in names_order], w,
       label="Real world (approx., literature)", color="#4477aa")
ax.bar(xpos + w / 2, [model_carbonate[n] for n in names_order], w,
       label="This model (real bathymetry + per-basin CCD, ADR-0008)", color="#ee6677")
ax.set_xticks(xpos)
ax.set_xticklabels(names_order)
ax.set_ylabel("% of basin area classified as Carbonate Ooze")
ax.set_title("Post-fix (ADR-0008): real bathymetry + per-basin CCD vs real world\n(Indian real value is a rough approximate, low-confidence)")
ax.legend()
ax.grid(axis="y", alpha=0.3)
fig2.tight_layout()
fig2.savefig(f"{HERE}/05-carbonate-fraction-by-basin.png", dpi=150)

print("model carbonate-ooze % by basin:", {k: round(v, 1) for k, v in model_carbonate.items()})
print("wrote 05-carbonate-fraction-by-basin.png")
