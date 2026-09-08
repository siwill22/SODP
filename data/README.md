# Source data

Raw literature/archive sources for the CCD Curve and CO2-Linked CCD Curve
(CONTEXT.md, ADR-0005). Nothing here is prep-processed yet -- these are the
inputs a future `prep_ccd.py`/`prep_co2.py` (mirroring Geode's own `prep/*.py`
convention) will read, cross-check, and combine into the actual served
curves. Kept as separate per-source files rather than merged up front so each
source's own provenance, license, and age coverage stays legible.

## ccd/

- **`palike_2012_equatorial_pacific.json`** -- Pälike et al. (2012, *Nature*)
  equatorial/off-equatorial Pacific CCD, 0-60 Ma, 241 points. Real data,
  fetched directly from PANGAEA (doi:10.1594/PANGAEA.789572), CC-BY-3.0. No
  digitizing.
- **`dutkiewicz_muller_2021_south_atlantic.json`** -- Dutkiewicz & Müller
  (2021, *Geology*) South Atlantic CCD, 0-74 Ma. Real data, fetched from
  EarthByte's own data collection. Regional (South Atlantic + a Walvis
  Ridge/Rio Grande Rise sub-region), not global -- using this for a v1
  "global" Published CCD Curve is a deliberate, flagged approximation against
  ADR-0005's own "no basin dependency" decision, not an oversight.
- **`van_andel_1975_basins.json`** -- Van Andel (1975, *EPSL*) Indian,
  Atlantic (North/South), Pacific basin CCD curves, ~0-140 Ma depending on
  basin. **Hand-digitized by eye from a rendered figure the user pasted
  in-conversation (2026-09-08), not pixel-traced** -- no source image file
  was available on disk for programmatic digitization. Treat age values as
  approximate to roughly +/-3 Ma and depth values to roughly +/-0.15-0.2 km,
  worse at inflection points. The reproducing paper (which added the
  present-day asterisk annotations after Broecker & Clark 2007) was not
  identified. Re-digitize from the original PDF if this ever needs to be
  more precise than that.

None of these three agree on region (equatorial Pacific vs. South Atlantic
vs. three separate basins) or on how "global" should be built from them --
that combination step (simple mean across basins? area-weighted? Pälike/
Dutkiewicz's real data preferred where it overlaps Van Andel's digitized
curves?) is a real methodological decision for the prep script, not yet made.

## co2/

- **`foster_royer_lunt_2017_loess.json`** -- Foster, Royer & Lunt (2017,
  *Nat. Comms.* 8:14845) Phanerozoic CO2 compilation, LOESS-smoothed fit
  (Supplementary Data 2), 0-419.5 Ma, 840 points, with 68%/95% confidence
  bounds. Real data, fetched directly from the article's own supplementary
  file links, CC-BY-4.0. No digitizing. Comfortably covers the full
  basement-age range (Seton et al. 2020 grid maxes out at 338.68 Ma).

**Still missing: the empirical CO2-to-CCD relationship itself** (ADR-0005's
CO2-Linked CCD Curve needs this to turn the Foster CO2 curve above into a
CCD curve). No published transfer function was found -- Tyrrell & Zeebe's
work runs the opposite direction (CCD as input, carbonate ion as output).
Decision: fit our own regression from the Foster/Pälike 0-60 Ma overlap
(real CO2 + real CCD, both above) and apply it across the full range, rather
than import an external formula. Not yet implemented.
