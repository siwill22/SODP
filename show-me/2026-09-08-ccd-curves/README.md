# CCD curve figures (2026-09-08)

Five figures testing the claims made while building and reporting on
`prep_ccd.py`. **Figures 2, 3, and 5 contradict part of the earlier
summary** — see the lead finding below before the rest.

## Lead finding: a ~2 km discontinuity at the real/digitized tier boundary

`02-published-curve-tiers.png` and `03-bug-fix-before-after.png` both show
it: at the age where the Published Curve switches from real data
(Dutkiewicz's noisy South Atlantic tail, ending deep at ~5.2 km around
70-74 Ma) to Van Andel's digitized curves (starting at ~2.85 km at 75 Ma),
the curve **jumps by more than 2 km in a single 1 Ma step**. This was not
visible in the printed summary stats (mean spread 0.411 km, RMSE 0.554 km)
because those are averages over 141 age steps — they hide a single violent
discontinuity the same way a mean hides an outlier. `05-published-vs-
co2linked-divergence.png`'s residual panel shows this same spike reaching
-1.65 km right around 70 Ma, meaning part of the "0.554 km RMSE" reported
earlier is this artifact, not genuine CO2-vs-real-data disagreement.

This is a real problem with `prep_ccd.py` as it stands, not just a
visualization quirk: a hard real->digitized cutoff with no continuity
constraint will always risk this, and here it did. Two fixes worth
considering, not yet applied:
- taper between tiers over a transition window rather than a hard switch, or
- recalibrate Van Andel's digitized curves to match the real data's value at
  their shared boundary age (the same category of fix as the present-day
  asterisk correction already flagged as unapplied in
  `data/ccd/van_andel_1975_basins.json`).

## Figures

1. **`01-regional-sources-disagree.png`** — every regional/basin source
   plotted together, 0-140 Ma, CCD depth in km (shallow at top). Tests: do
   the sources actually disagree enough to justify ADR-0005's "surface
   divergence, don't average" stance? Yes — up to ~1.5 km apart at a given
   age. Also visible here for the first time: Dutkiewicz's South Atlantic
   curve is far noisier than Pälike's, swinging by >1 km within a few Myr
   in places (consistent with the large per-point uncertainties in that
   source, up to ~2000 m on some points) — "real" doesn't mean "smooth,"
   and the combination method doesn't currently account for that.

2. **`02-published-curve-tiers.png`** — the actual Published Curve output,
   colour-coded by which tier supplied it (real vs. digitized) with the
   per-age spread as a shaded band. Tests: does real data actually dominate
   wherever it's available? Yes, but see the lead finding — the tier
   boundary itself is the problem, not which tier wins within its range.

3. **`03-bug-fix-before-after.png`** — the naive unweighted-mean curve
   (re-derived live from the same source files, not the number quoted
   earlier) plotted against the real-preferred curve `prep_ccd.py` actually
   produces. Confirms the earlier claim at age=0 exactly (naive 5.040 km,
   real-preferred 4.650 km, matching Pälike's own 4.650 km point) — but also
   makes clear the real-preferred fix didn't touch the tier-boundary
   discontinuity, which is present in both curves.

4. **`04-co2-ccd-fit-quality.png`** — left: Pälike CCD vs. Foster CO2 with
   the fitted line (linear, R²=0.49, as reported). Right: residuals vs. age.
   The residuals are **not random noise** — they trace a smooth systematic
   swing from ~0 at 0 Ma up to +0.85 km around 30 Ma and back down to -1.1 km
   by 52 Ma. That's a stronger statement than "R²=0.49": the linear CO2-CCD
   relationship is missing real, age-structured behaviour, not just adding
   scatter. Worth knowing before trusting the CO2-Linked Curve's shape in
   the 60-420 Ma range it was never checked against.

5. **`05-published-vs-co2linked-divergence.png`** — both curves together
   (CO2-Linked Curve's full 0-420 Ma reach shown, shaded past 140 Ma where
   there's no Published Curve to check it against), plus the residual
   (Published - CO2-Linked) below. Confirms the 0.554 km RMSE figure
   reported earlier, but shows it's not uniform: driven by a few sharp
   spikes (the ~70 Ma tier-boundary artifact chief among them) rather than
   even disagreement across the whole range.

## What these figures do not show

None of this validates either curve against anything outside the sources
already in `data/` — there is no independent CCD estimate here to check
either curve against. The CO2-Linked Curve's 140-420 Ma extrapolation is
shown but not tested; nothing in `data/` covers that range to test it
against. Spherical-geometry concerns don't apply (no map, no distances/
areas) — this is entirely age-vs-depth curve data.

## Reproducing

`conda run -n pygmt17 python make_figures.py` from this directory. Reads
directly from `SODP/data/ccd/*.json`, `SODP/data/ccd/*.json` and
`SODP/archive/ccd/*.json` — re-run `prep_ccd.py` first if those have
changed.
