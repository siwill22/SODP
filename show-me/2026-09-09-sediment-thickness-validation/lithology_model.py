"""
The physical model itself: GDH1 age-to-depth, CCD Curve lookup, the
probabilistic Lithology Class classifier (coefficients hand-copied from
src/lithology.ts's PROB_CLASSIFIER, ADR-0011/0012), the pyBacktrack-adopted
density/porosity/decay constants (ADR-0020), the Sedimentation Rate model
(ADR-0020, Rothwell 2005 / Hüneke & Mulder 2011), and the forward
compaction integral that turns a stack of decompacted layers into a
compacted depth-in-core.

Every numeric constant here is either copied verbatim from production TS
(flagged where) or cited to a real source (flagged where) -- nothing
invented for this script alone.
"""
import bisect
import json
import math

LithologyClass = str  # 'carbonate-ooze' | 'siliceous-ooze' | 'clay'

# ---------------------------------------------------------------------------
# GDH1 -- lithology.ts's ageToDepthKm(), Stein & Stein (1992)
# ---------------------------------------------------------------------------

def age_to_depth_km(age_ma: float) -> float:
    if age_ma <= 20:
        depth_m = 2600 + 365 * math.sqrt(age_ma)
    else:
        depth_m = 5651 - 2473 * math.exp(-0.0278 * age_ma)
    return depth_m / 1000


# ---------------------------------------------------------------------------
# CCD Curve lookup -- ccdCurve.ts's ccdKmAt(), same "never extrapolated" rule
# ---------------------------------------------------------------------------

class CcdCurve:
    def __init__(self, path: str):
        with open(path) as f:
            d = json.load(f)
        pts = d["curve"]
        self.ages = [p["age_ma"] for p in pts]
        self.ccds = [p["ccd_km"] for p in pts]

    def at(self, age_ma: float) -> float | None:
        if not self.ages:
            return None
        if age_ma < self.ages[0] or age_ma > self.ages[-1]:
            return None
        lo = bisect.bisect_right(self.ages, age_ma) - 1
        lo = max(0, min(lo, len(self.ages) - 2))
        a_age, b_age = self.ages[lo], self.ages[lo + 1]
        a_ccd, b_ccd = self.ccds[lo], self.ccds[lo + 1]
        if a_age == b_age:
            return a_ccd
        t = (age_ma - a_age) / (b_age - a_age)
        return a_ccd + t * (b_ccd - a_ccd)


# ---------------------------------------------------------------------------
# Probabilistic Lithology Class classifier -- lithology.ts's PROB_CLASSIFIER,
# coefficients copied verbatim (ADR-0011, OVEL dropped per ADR-0012).
# classes order matches lithology.ts exactly -- coef/intercept rows
# correspond to THIS order, not LithologyClass's declared union order.
# ---------------------------------------------------------------------------

CLASSES: list[LithologyClass] = ["carbonate-ooze", "clay", "siliceous-ooze"]
_COEF = [
    [-0.6468372653532644, 0.07674432783719803],
    [0.5402521969596821, 0.017426666913687723],
    [0.10658506839358145, -0.09417099475088585],
]
_INTERCEPT = [-1.165691839106127, 0.3167807565171921, 0.8489110825888322]


def classify_lithology_probabilistic(ocean_depth_km: float, ccd_km: float, otemp_c: float) -> dict[str, float]:
    x0 = ocean_depth_km - ccd_km
    x1 = otemp_c
    scores = [row[0] * x0 + row[1] * x1 + b for row, b in zip(_COEF, _INTERCEPT)]
    m = max(scores)
    exp_scores = [math.exp(s - m) for s in scores]
    total = sum(exp_scores)
    return {c: e / total for c, e in zip(CLASSES, exp_scores)}


# ---------------------------------------------------------------------------
# pyBacktrack lithology constants (ADR-0020) -- density.py's primary.txt,
# Sclater & Christie (1980) / Kominz et al. (2011), adopted verbatim.
# grain_density kg/m3, surface_porosity (0-1), decay_m (porosity e-folding
# depth, metres): porosity(z) = surface_porosity * exp(-z / decay_m).
# ---------------------------------------------------------------------------

COMPACTION = {
    "carbonate-ooze": {"grain_density": 2710.0, "phi0": 0.59, "decay_m": 1660.0},  # Coccolith_ooze
    "siliceous-ooze": {"grain_density": 2457.0, "phi0": 0.84, "decay_m": 436.0},  # Diatomite
    "clay": {"grain_density": 2735.0, "phi0": 0.76, "decay_m": 1252.0},  # Clay
}

# ---------------------------------------------------------------------------
# Sedimentation Rate (ADR-0020) -- range midpoints from Rothwell (2005),
# "Deep Ocean Pelagic Oozes", Encyclopedia of Geology, corroborated by
# Hüneke & Mulder (2011), Deep-Sea Sediments (Developments in Sedimentology
# 63): Carbonate Ooze 0.3-5 cm/kyr, Siliceous Ooze 0.2-1 cm/kyr, Clay
# 0.1-0.5 cm/kyr. Real accumulation rates vary far more than this "typical
# pelagic" baseline in specific settings -- e.g. Southern Ocean opal-belt
# diatom ooze measured at 6-80+ cm/kyr at some ODP sites -- so this is a
# first-pass baseline, not a hard ceiling; see this show-me folder's README
# for how that shows up in the validation result.
# ---------------------------------------------------------------------------

RATE_CM_KYR = {
    "carbonate-ooze": 2.65,
    "siliceous-ooze": 0.6,
    "clay": 0.3,
}

# ---------------------------------------------------------------------------
# EXPERIMENTAL: a |latitude|-banded multiplicative correction to the flat
# rate above, fit directly against this folder's own GlobSed validation
# residual -- NOT a literature constant like everything above. Motivated by
# the difference map (04-log-ratio-difference-map.png): over-prediction
# concentrated in the subtropical gyre "clay deserts" (~15-30 deg), under-
# prediction at the equator and (strongly) at high latitude (Southern Ocean
# opal belt, Arctic margins) -- the classic wind-stress-curl-driven Ekman
# upwelling pattern (high productivity at the equator and at high latitude,
# low in the subtropical gyres between).
#
# Fit on a deterministic TRAIN half only (even-indexed points in
# predicted_thickness.json), evaluated on the held-out odd-indexed TEST half
# -- same "don't grade a fit on the data it was fit to" discipline ADR-0011
# used for the classifier itself (5-fold cross-validated, not fit-then-
# graded-on-itself). See fit_latitude_correction.py for the fit itself and
# README.md's "Latitude correction" section for the train/test result.
#
# Applied at each Synthetic Core step's own PALEO-latitude (not present-day)
# -- same convention as lithology.ts's applyEquatorialRadiolarianBelt().
# Piecewise-linear interpolation between bin centres, clamped at the edges.
# ---------------------------------------------------------------------------

_LAT_CORRECTION_CENTERS = [5.0, 15.0, 25.0, 35.0, 45.0, 55.0, 65.0, 75.0, 85.0]
_LAT_CORRECTION_LOG10 = [-0.2557, -0.5981, -0.7022, -0.4075, -0.1509, 0.1132, 0.3456, 0.8866, 1.052]


def latitude_rate_multiplier(abs_lat_deg: float) -> float:
    log10_mult = _interp(abs_lat_deg, _LAT_CORRECTION_CENTERS, _LAT_CORRECTION_LOG10)
    return 10 ** log10_mult


def _interp(x: float, xs: list[float], ys: list[float]) -> float:
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    lo = bisect.bisect_right(xs, x) - 1
    lo = max(0, min(lo, len(xs) - 2))
    t = (x - xs[lo]) / (xs[lo + 1] - xs[lo])
    return ys[lo] + t * (ys[lo + 1] - ys[lo])


# ---------------------------------------------------------------------------
# Forward compaction -- standard Sclater & Christie (1980)-style solve.
# Conservation of solid-grain volume: a layer whose DECOMPACTED (surface-
# porosity-reference) thickness is T, buried with its top at compacted depth
# z_top, has compacted thickness S solving
#   S - phi0*decay*(exp(-z_top/decay) - exp(-(z_top+S)/decay)) = T*(1-phi0)
# Solved layers top-down (youngest/shallowest first, matching deposition
# order): each layer's own z_top is the z_bottom of everything younger
# already placed above it.
# ---------------------------------------------------------------------------

def _compacted_thickness(decompacted_thickness_m: float, z_top_m: float, phi0: float, decay_m: float) -> float:
    if decompacted_thickness_m <= 0:
        return 0.0
    target = decompacted_thickness_m * (1 - phi0)

    def f(s: float) -> float:
        return s - phi0 * decay_m * (math.exp(-z_top_m / decay_m) - math.exp(-(z_top_m + s) / decay_m)) - target

    # Newton's method, starting from the uncompacted thickness itself (an
    # upper bound: compaction only ever shortens a layer).
    s = decompacted_thickness_m
    for _ in range(50):
        fs = f(s)
        # d/ds of the exp term: -phi0 * exp(-(z_top+s)/decay)
        dfs = 1 - phi0 * math.exp(-(z_top_m + s) / decay_m)
        step = fs / dfs if dfs != 0 else fs
        s_new = s - step
        if s_new <= 0:
            s_new = s / 2
        if abs(s_new - s) < 1e-6:
            s = s_new
            break
        s = s_new
    return max(0.0, s)


def compact_column(layers: list[tuple[float, float, float, float]]) -> float:
    """layers: list of (decompacted_thickness_m, phi0, decay_m, _unused_grain_density),
    youngest first (deposited most recently, sits at the top). Returns total
    compacted depth-in-core (m) at the base of the column -- the predicted
    present-day sediment thickness at this point."""
    z = 0.0
    for decompacted_m, phi0, decay_m, _grain in layers:
        s = _compacted_thickness(decompacted_m, z, phi0, decay_m)
        z += s
    return z
