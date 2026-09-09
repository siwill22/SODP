# Testing the actual causal variable, not a proxy for it: real WOA23 silicate

Pulled World Ocean Atlas 2023 surface dissolved silicate (NOAA NCEI,
`data/woa23_silicate_annual_1deg.nc`, variable `i_an`, depth=0, 1x1
degree annual climatology, real measured/objectively-analysed data, not
a HadCM3 proxy) to test the hypothesis directly: is dissolved silicate
supply the missing variable behind the warm/equatorial siliceous-ooze
blind spot (OVEL+OTEMP get 0% recall there; OSAL, tried first because
it's free, only partially helps -- see
`../2026-09-09-present-day-validation/fit_balanced_with_osal.py`)?

## Data (not committed to git -- see repo .gitignore)

`data/woa23_silicate_annual_1deg.nc` (~48MB) is gitignored, not committed
-- too large for git history, and reproducible with one command:

```
curl -o data/woa23_silicate_annual_1deg.nc \
  https://www.ncei.noaa.gov/data/oceans/woa/WOA23/DATA/silicate/netcdf/all/1.00/woa23_all_i00_01.nc
```

## The causal hypothesis is directionally confirmed, strongly so in cold water

Joined to the same 8,445-point validation set by nearest 1-degree cell:

| | warm siliceous-ooze | warm carbonate-ooze | cold siliceous-ooze | cold carbonate-ooze |
|---|---|---|---|---|
| median silicate (umol/kg) | 2.30 (n=271) | 1.70 (n=3352) | 16.45 (n=943) | 4.33 (n=762) |

Warm-water gap: p=3.4e-10 (Mann-Whitney). Cold-water gap is far larger in
absolute terms (16.45 vs 4.33, ~3.8x) -- consistent with the real,
well-established Southern Ocean silica-belt mechanism, and a reassuring
sanity check that the WOA join and the join logic are doing something
real.

## But it does not fix the warm-water blind spot either -- a genuinely new finding, not just "OSAL again"

Single-variable AUC (warm carbonate vs warm siliceous, direction-corrected):
**OSAL 0.74, real silicate 0.61** -- OSAL, the free-standing BRIDGE-Valdes
proxy tested first, actually separates the two classes *better* than the
real, independently-measured causal variable does, on this point set at
this resolution. Combining OSAL+silicate lifts the isolated warm-only
binary AUC to 0.72 and recall to 13.4% -- barely different from OSAL alone
(15%). See `01-warm-water-osal-vs-silicate.png`: real, visible separation
in both histograms, but with heavy overlap in both.

In the full 3-class model (`fetch_and_join.py`'s companion test), adding
silicate on top of OVEL+margin+OTEMP moves overall CV accuracy from
68.0%->68.5% and warm-siliceous recall stays at **exactly 0.0%**, same as
without it, even with balanced class weights (which do lift cold-siliceous
recall to 88%). The reason isn't the reweighting granularity problem found
for OSAL -- it's that even in isolation, silicate alone only supports
~11% recall on this specific split (`fetch_and_join.py` output), so there
isn't a strong signal for reweighting to surface in the first place.

## What this settles, and what it doesn't

**Does settle:** the missing-variable hypothesis was directionally right
-- productivity/silicate-supply variables really do differ between the
two classes, and the effect is large and unambiguous in cold water. It
also settles that OSAL was a reasonable free first thing to try -- it
wasn't a worse choice than the real variable, it's actually a comparably
strong (or slightly stronger) single-variable separator here.

**Does not settle:** a working fix for the warm/equatorial split. Even
the real, direct silicate measurement -- not a model proxy, not something
we had to derive -- gives at best ~11-15% recall and AUC 0.61-0.74 on this
point set. Two honest explanations, not distinguished here: (1) genuine
population overlap at the point/1-degree scale -- the real world may just
not separate as cleanly as Diesing's map suggested, given Diesing's map's
own equatorial confidence traces back to a Random Forest generalising from
the same ~106-point sample we have (`../2026-09-09-diesing-validation/README.md`),
not independent dense ground truth; or (2) a resolution mismatch -- WOA's
1-degree climatology and BRIDGE-Valdes's coarse ocean grid may both smooth
out real small-scale (current-front, coastal-upwelling-filament) structure
that a point-level sediment sample actually records.

## Figures

1. **01-warm-water-osal-vs-silicate.png** -- histograms, warm-water (OTEMP>15C)
   carbonate-ooze vs siliceous-ooze, for OSAL and real WOA silicate side by
   side, with each variable's single-variable AUC annotated.

## Bottom line for the project

Chasing a better silicate/productivity proxy through BRIDGE-Valdes
(agewater, wind stress, new ETL) is very unlikely to fix this specific
blind spot -- the real, directly-measured variable already tested here
doesn't fix it either. The honest state of ADR-0011's classifier: it is a
real net improvement in aggregate (46.8% deployed accuracy vs 29.6%
deterministic) with one identified, now well-characterised, unresolved
weakness (warm/equatorial siliceous-ooze, ~1.9% of all real points) that
does not look solvable by adding another OVEL/OTEMP-like scalar predictor
-- fixing it for real would likely need either point-level covariates this
project doesn't have any accessible source for, or accepting it as a known
limitation and documenting it as such in ADR-0011.
