# Present-Day Lithology Map (2026-09-08, updated 2026-09-09 after ADR-0008 and the OVEL-threshold investigation)

Testing whether `src/lithology.ts`'s 3-class rule (ADR-0007) reproduces the
real-world present-day deep-sea sediment distribution — the actual Phase 1
deliverable (ADR-0006). Figures computed by `compute_lithology.mjs` calling
the real app logic (`classifyLithology`, `ccdKmForBasin`) against real data,
plotted by `make_figures.py` / `basin_diagnosis.py`.

**This version supersedes the original 2026-09-08 run.** That run found
proportions substantially wrong (carbonate under-represented ~3x) and
traced it, first, to a flat single-global CCD, then — after a sharper
question exposed the real driver — to depth itself: the original run used
GDH1-synthetic depth (`ageToDepthKm`) for a map that had real observed
bathymetry available the whole time. Both fixes are now implemented
(ADR-0008: real bathymetry via `prep/prep_bathymetry.py`, per-basin CCD via
`prep/prep_basin_mask.py` + `ccdKmForBasin()`) and this README reports the
result, including a correction to a claim the original version got wrong.

## What changed and what it did

| Depth source | CCD | Atlantic carb% | Pacific carb% | Indian carb% |
|---|---|---:|---:|---:|
| — | REAL WORLD (approx., literature) | 60 | 15 | 30 |
| GDH1 (original run) | single global (4.65 km) | 9.7 | 11.7 | 16.2 |
| GDH1 | per-basin CCD tried alone | up to 34.6 | 11.7–20.0 | wrong order |
| **Real bathymetry (this run)** | **per-basin (ADR-0008)** | **31.2** | **15.5** | **24.7** |

Global proportions: **carbonate ooze 32.1%, siliceous ooze 15.6%, clay
52.2%** of valid cells (was 17.4% / 30.4% / 52.2%). Against Diesing et al.
(2020)'s global figures (calcareous ~48%, siliceous ~9-10%, clay ~41%),
carbonate went from under-represented by ~3x to under-represented by
~1.5x; siliceous went from over-represented by ~3x to close to right;
clay is essentially unchanged (still somewhat high).

**Real bathymetry mattered more than basin-specific CCD.** Real bathymetry
alone, keeping the single global CCD, already fixed the Atlantic > Pacific
ordering that no CCD fix managed with GDH1 depth (27.2% vs 20.0%). GDH1 has
no dynamic topography, sediment loading, or hotspot-swell correction —
real, substantial effects it cannot produce by construction — and was a
bigger source of error here than the CCD's basin-blindness. See ADR-0008
for the full reasoning and the intermediate results that led there.

## Correction to the original write-up

The original version of this README claimed "a Pacific-sourced CCD applied
globally under-serves the Atlantic, where the real CCD sits deeper" as the
mechanism, and pointed at Dutkiewicz & Müller (2021)'s South Atlantic data
as support. Checked directly against that data before building further on
it: raw young-age Dutkiewicz values (~4400–4850 m) did **not** clearly show
a deeper Atlantic CCD — that specific dataset is narrowly focused on the
Walvis Ridge/Rio Grande Rise and doesn't represent a broad basin average. A
literature search separately confirmed the Atlantic CCD genuinely does sit
deeper than the Pacific (Pacific ~4200–4500 m, Atlantic ~5000 m, Indian
~4300 m — the values now in `ccdKmForBasin()`), so the original *direction*
was right, but the specific evidence cited for it was not solid, and the
CCD alone was not the dominant cause anyway (see above). This is recorded
here rather than silently edited out.

## Follow-up: is the pattern too dominated by upwelling/downwelling?

Eye-checking `01-lithology-map.png` against the real-world belts raised a
sharper question: does OVEL sign dominate the map more than it physically
should? Checked directly, not just by eye:

**The Clay class is *exactly* the `OVEL<=0` mask — zero depth information
enters it.** `classifyLithology()` checks `OVEL<=0 -> Clay` first and
unconditionally (ADR-0007's stated reasoning: "nothing being produced
overrides where the point sits relative to the CCD"). Confirmed on the
actual grid: the clay pixel mask and the `OVEL<=0` pixel mask are
pixel-for-pixel identical. Of those clay cells, **54% sit above the CCD**
(`06-clay-above-vs-below-ccd.png`) — water shallow enough that carbonate
should physically survive dissolution regardless of productivity, under
the standard pelagic-facies model (CCD as primary control; productivity
only decides siliceous-vs-clay *below* it).

Tried the obvious structural fix — flip the priority so the CCD decides
carbonate vs. not, and OVEL only breaks the tie below the CCD. It overcorrects:
Atlantic improves (31%→74% vs. real 60%) but Pacific — which the current
rule gets almost exactly right — blows out to 44% against a real 15%.

Tried the other obvious lever instead: sweep the OVEL cutoff itself away
from a bare sign test (`sweep_ovel_threshold.py`, `07-ovel-threshold-sweep.png`).
Finding: **no single global threshold reconciles Atlantic and Pacific.**
Atlantic's own best-fit threshold (-0.00005 cm/s, giving 64% vs. real 60%)
pushes Pacific to ~39% (real 15%) at that same setting. Pacific and Indian
are both already best-served by the current threshold (0, i.e. sign-only).
Worse: **Indian is capped, not mistuned** — even at Indian's own best-fit
threshold, carbonate tops out at 24.7%, short of the real ~30% no matter
where the cutoff is set, meaning the threshold isn't the limiting factor
there at all (candidates: the basin's CCD value, the depth data, or the
~30% reference figure itself, already flagged low-confidence).

**Conclusion: the user's read was right, and it's real, but it isn't a
single number to retune.** A global sign-only threshold is already close
to the best a *global* scalar can do — Atlantic and Pacific pull in
opposite directions on the same knob. Per-basin thresholds would resolve
that conflict but add free parameters with no independent physical
justification (exactly what ADR-0007's zero-parameter design was avoiding),
and wouldn't even fix Indian. **Not implemented** — left as a documented
open limitation rather than force a fit. `src/lithology.ts` is unchanged.

## Figures

1. **`01-lithology-map.png`** — the 3-class map, Robinson projection,
   categorical (blue=Clay, gold=Carbonate Ooze, green=Siliceous Ooze),
   land/no-data transparent. Placement is recognisable (equatorial
   carbonate belt, Southern Ocean siliceous band, clay-filled gyre
   centers); proportions are much closer to real than the original run,
   not exact — see the table above. Checked the underlying per-latitude
   no-data fraction directly (no row exceeds 15% no-data among ocean
   cells) to rule out a real data gap behind the faint banding visible at
   some latitudes in the rendered PNG — it's a display/rescaling artifact
   of viewing a 360×181 grid at high zoom, not a data defect.

2. **`02-depth-minus-ccd.png`** — real bathymetry minus the CCD actually
   used at each cell (per-basin where available, else the 4.65 km global
   fallback — `ccdKmUsed`), diverging colour scale centred on zero. Range:
   [-4.86, +2.46] km (was [-2.05, +1.00] km under GDH1 — real bathymetry
   has a much wider spread than GDH1's smooth age-only curve, part of why
   it changes the classification so much).

3. **`03-ovel-sign.png`** — OVEL sign only, unchanged from the original run
   (ADR-0007's rule component this investigation never found reason to
   doubt). 47.8% of valid cells read as productive.

4. **`04-basin-mask-used.png`** — the NOAA WOA13-derived basin mask
   (`archive/models/basin-mask`) actually driving the per-basin CCD in
   figure 2, so it's checkable against a real map rather than asserted.
   22,603 of 30,387 valid cells (74%) got a basin-specific CCD; the rest
   (Southern Ocean sectors, marginal seas, Arctic, Hudson Bay) fell back to
   the global value.

5. **`05-carbonate-fraction-by-basin.png`** — model (post-fix) vs.
   real-world carbonate-ooze fraction by basin, the same check that
   originally exposed the flat-basin-contrast problem, re-run after both
   fixes. Atlantic and Indian both still undershoot; Pacific is now close
   to exact.

6. **`06-clay-above-vs-below-ccd.png`** — every Clay pixel from figure 1,
   split by whether it sits above (orange, disputed) or below (blue,
   undisputed) the CCD. Tests the "54% of clay is above-CCD" claim
   spatially — shows it's concentrated in the subtropical gyre margins of
   the Atlantic and Indian oceans specifically, not scattered noise.

7. **`07-ovel-threshold-sweep.png`** — carbonate-ooze % per basin as the
   OVEL cutoff sweeps from -0.0003 to +0.0006 cm/s, with each basin's
   real-world value as a dashed line. Tests whether any single threshold
   value reconciles all three basins — it does not; Atlantic's curve
   crosses its target far to the left of where Pacific crosses its own.

## What these figures do not show

No comparison against real IODP/ODP/DSDP core data (deliberately
deprioritized per the plan doc). The remaining gap to real-world magnitudes
(Atlantic 31.2% vs. real ~60%, best case) is not explained by anything
checked here — candidates not yet investigated: the OVEL-sign
threshold's calibration, 1°-grid resolution hiding narrow real features,
and area-weighting (these percentages are still pixel counts on an
equirectangular grid, not `cos(latitude)` area-weighted — flagged in the
original write-up and still not fixed). `ccdKmForBasin()`'s three values
are literature-range estimates surfaced during this investigation, not
each pinned to one paper the way Pälike's Pacific value is — see ADR-0008
for the confidence caveat.

## Reproducing

```
cd show-me/2026-09-08-lithology-map
npx tsx compute_lithology.mjs                    # writes lithology_grid.json
conda run -n pygmt17 python make_figures.py             # figures 1-4
conda run -n pygmt17 python basin_diagnosis.py           # figure 5
conda run -n pygmt17 python sweep_ovel_threshold.py      # writes ovel_threshold_sweep.json
conda run -n pygmt17 python make_ovel_diagnosis_figures.py  # figures 6-7
```

Prerequisite (one-time, already run): `prep/prep_bathymetry.py` and
`prep/prep_basin_mask.py` must have populated `archive/models/bathymetry`
and `archive/models/basin-mask`.

`try_ccd_variants.py`/`ccd_variant_results.json` (led to ADR-0008) and
`sweep_ovel_threshold.py`/`ovel_threshold_sweep.json` (the OVEL-threshold
investigation above, no code change resulted) are kept as historical
experiment records — not part of the main reproduction path above.
