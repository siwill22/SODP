# Present-Day Lithology Map uses real bathymetry (not GDH1) and basin-specific CCD (not the single global value)

The Present-Day Lithology Map's eye-validation (ADR-0006) found carbonate
ooze under-represented by roughly a factor of 3 against Diesing et al.
(2020), and essentially flat between ocean basins where the real world is
not (~60% of the Atlantic floor is carbonate-covered vs. ~15% of the
Pacific). Diagnosed and partially fixed in two independent steps, both
folded into this one ADR because the second finding changed how much the
first one mattered.

## Step 1: basin-specific CCD helps, but only partly

ADR-0005 already named "no basin differentiation" as a known v1 limitation,
using Pälike's equatorial-Pacific value (4.65 km) as the one global CCD.
Swapping in basin-specific values (`show-me/2026-09-08-lithology-map/
try_ccd_variants.py`, tested against the real NOAA WOA13 basin mask, not a
longitude-band guess) restored the correct Atlantic > Pacific ordering, but
only reached Atlantic 26–35% against the real ~60%, still with GDH1 driving
depth.

## Step 2: the bigger error was GDH1 itself, not the CCD

A direct question — is the present-day map assuming today's bathymetry
equals GDH1's output, or using the real observed depth? — exposed that it
was doing pure forward synthesis: GDH1 applied to Basement Age, completely
ignoring the real observed bathymetry that was already available. GDH1
(ADR-0007) is a synthetic thermal-subsidence curve with **no dynamic
topography, sediment loading, or hotspot/LIP-swell correction** — real and
substantial effects it cannot produce by construction. It exists to answer
"what was the depth at a past age," a question with no directly observed
answer — genuinely needed for Phase 2's through-time reconstruction. For
the *present-day* map specifically, that question doesn't need to be asked
at all: real depth is directly observable.

Substituting real bathymetry (SRTM15 via PyGMT's `earth_relief` dataset,
see `prep/prep_bathymetry.py`) for GDH1-derived depth, keeping everything
else fixed, moved the numbers further than the basin-CCD fix alone:

| Depth source | CCD | Atlantic carb% | Pacific carb% | Indian carb% |
|---|---|---:|---:|---:|
| — | REAL WORLD (approx.) | 60 | 15 | 30 |
| GDH1 | single global (4.65) | 9.7 | 11.7 | 16.2 |
| GDH1 | basin-specific (best variant) | 34.6 | 20.0 | 35.2 (wrong order) |
| **Real bathymetry** | single global (4.65) | 27.2 | 20.0 | 29.9 |
| **Real bathymetry** | basin-specific (literature ref.) | 31.4 | **15.5** | 24.6 |

Real bathymetry *alone*, with the same single global CCD, already gets the
Atlantic/Pacific ordering right — something no CCD fix managed with GDH1
depth. Combined with basin-specific CCD, Pacific lands almost exactly on
the literature figure (15.5 vs. 15); Atlantic and Indian both improve
substantially but still undershoot the real magnitude. The gap is not
closed, and is not claimed to be — see Consequences.

## Decision

**For the Present-Day Lithology Map only** (Phase 1 / ADR-0006):

1. **Ocean depth comes from real bathymetry**, not `ageToDepthKm()`/GDH1.
   `prep/prep_bathymetry.py` resamples SRTM15 (Tozer et al. 2019, via
   `pygmt.datasets.load_earth_relief`) onto the same 360×181 grid as
   Basement Age, served as `archive/models/bathymetry`. GDH1 is **not**
   removed from `src/lithology.ts` — it remains the depth model for Phase
   2's through-time reconstruction, the one place a real observed depth
   genuinely cannot exist (no one can observe the depth of 50 Ma seafloor
   today at the seafloor's 50-Ma location).

2. **CCD is looked up per-basin**, not from the single global Published CCD
   Curve value. `prep/prep_basin_mask.py` resamples the NOAA WOA13 basin
   mask (real objective-analysis classification, not a longitude-band
   heuristic) onto the same grid, served as `archive/models/basin-mask`,
   keeping only Atlantic/Pacific/Indian (the three basins with a literature
   CCD estimate) and treating everything else (Southern Ocean sectors,
   marginal seas, Arctic, Hudson Bay) as no-basin, which falls back to the
   single global value. `ccdKmForBasin()` in `src/lithology.ts` holds the
   three literature-reference values (Pacific 4.35 km / Atlantic 5.00 km /
   Indian 4.30 km) — sourced from general literature ranges surfaced during
   this investigation (Pacific ~4200–4500 m, Atlantic ~5000 m, Indian
   ~4300 m), not one single pinned paper the way Pälike's Pacific value is;
   flagged at the same confidence level ADR-0005 already uses for Van Andel
   1975's digitized curves, i.e. treat to roughly ±0.2–0.3 km. This
   partially supersedes ADR-0005's "no basin differentiation" scope note —
   still true for the through-time CCD Curve (unchanged, deferred), no
   longer true for the present-day lookup.

`classifyLithology()` itself (ADR-0007's 3-line rule) is unchanged — both
fixes are to its *inputs*, not the rule.

## Consequences

- **This is a partial fix, stated as such.** Best case (real bathymetry +
  basin CCD) reaches Atlantic 31.4% against a real ~60% — a large
  improvement over the pre-fix 9.7%, not a resolution. Remaining gap is
  unexplained beyond "real bathymetry and basin CCD were the two largest
  identified levers"; candidates not yet investigated: the OVEL-sign
  threshold's calibration (ADR-0007's own flagged risk), 1°-grid resolution
  hiding narrow real features, and area-weighting (percentages here are
  still pixel counts on an equirectangular grid, not `cos(latitude)`
  area-weighted — the same caveat ADR-0006's original write-up already
  flagged and never fixed).
- **Phase 2 still uses GDH1.** This ADR does not change how depth is
  computed for the through-time Synthetic Core — only the present-day
  validation map. If Phase 2 eventually wants a present-day *anchor* point
  for its own reconstruction (e.g. backtracking from today's real depth
  rather than forward-synthesizing from age at every step), that is a new
  design question, not decided here.
- **Two new archive models**, `bathymetry` and `basin-mask`, join
  `basement-age` as SODP-hosted static grids (ADR-0004's convention) rather
  than Geode live-fetches, since Geode has neither.
