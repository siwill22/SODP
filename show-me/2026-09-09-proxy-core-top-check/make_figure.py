"""Model-vs-real scatter for delta18O and Mg/Ca core-top cross-check.
Reads the real numbers straight from check_delta18o.mjs / check_mgca.mjs
output (hardcoded here as the printed residual table -- rerun those
scripts against the live dev server to reproduce from scratch)."""
import matplotlib.pyplot as plt

d18o = [
    ("ELT48.022-PC", 0.90, 0.58), ("GeoB3827-2", -0.80, -2.00), ("GeoB1035-5", -0.79, -0.92),
    ("RC14-39", -2.64, -2.98), ("GIK16773-1", -1.31, -2.33), ("V19-183", -2.09, -2.77),
    ("M35024-6", -1.94, -2.66), ("EN32-PC6", -1.65, -2.22), ("V26-176", -1.35, -1.50),
    ("APNAP11", 0.02, 0.70),
]
mgca = [
    ("WIND-5B", 2.35, 3.22), ("WIND-33B", 3.52, 4.59), ("1BC3", 4.81, 5.29),
    ("3BC24", 4.28, 4.93), ("GeoB4406-2", 4.73, 4.48), ("GeoB4421-2", 4.33, 4.08),
    ("M35010-2", 5.53, 4.59),
]

fig, axes = plt.subplots(1, 2, figsize=(10, 5))

ax = axes[0]
real = [r[1] for r in d18o]; model = [r[2] for r in d18o]
lims = (min(real + model) - 0.3, max(real + model) + 0.3)
ax.plot(lims, lims, "--", color="gray", lw=1, label="1:1")
ax.scatter(real, model, color="#dd88bb", zorder=3)
ax.set_xlim(lims); ax.set_ylim(lims)
ax.set_xlabel("real published core-top δ18O, G. ruber (w), ‰ VPDB\n(Anderson & Mulitza 2001)")
ax.set_ylabel("this project's delta18OFromTemperature(OTEMP)\nat the same (lon, lat), present day")
ax.set_title("δ18O: model vs 10 real core-top sites\nr=0.93, MAE=0.58‰")
ax.legend()

ax = axes[1]
real = [r[1] for r in mgca]; model = [r[2] for r in mgca]
lims = (min(real + model) - 0.4, max(real + model) + 0.4)
ax.plot(lims, lims, "--", color="gray", lw=1, label="1:1")
ax.scatter(real, model, color="#55bb99", zorder=3)
ax.set_xlim(lims); ax.set_ylim(lims)
ax.set_xlabel("real published core-top Mg/Ca, G. ruber (w), mmol/mol\n(Johnstone et al. 2011)")
ax.set_ylabel("this project's mgCaFromTemperature(OTEMP)\nat the same (lon, lat), present day")
ax.set_title("Mg/Ca: model vs 7 real core-top sites\nr=0.71, MAE=0.64 mmol/mol")
ax.legend()

fig.suptitle("Real core-top proxy cross-check: this project's OTEMP-derived proxies vs published observations", fontsize=11)
fig.tight_layout()
fig.savefig("01-proxy-vs-real-coretop.png", dpi=150)
print("wrote 01-proxy-vs-real-coretop.png")
