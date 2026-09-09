# Two equal, parallel options for the equatorial siliceous-ooze blind spot -- not one replacing the other

ADR-0011 documented and accepted a known limitation: the fitted classifier
gets 0% recall on real warm/equatorial siliceous-ooze points. Comparing
against Diesing (2020)'s independent map suggested Radiolarian ooze should
often replace our "clay" prediction near the equator specifically --
checked directly, not assumed, before building anything
(`show-me/2026-09-09-simplified-classifier-map/radiolarian_belt_check.py`).

## What the real comparison actually shows

Among cells THIS classifier calls clay, the fraction Diesing's map calls
Radiolarian ooze, by |latitude| (all effectively below-CCD already, so
margin adds little independent information here):

| \|lat\| | our-clay cells (n) | % Diesing calls Radiolarian ooze |
|---|---:|---:|
| 0-5 | 684 | 72.7% |
| 5-15 | 1,821 | 55.7% |
| 15-25 | 2,040 | 9.8% |
| 25-40 | 3,118 | 1.6% |
| 40-90 | 2,566 | 15.7% (already handled -- see below) |

The real pattern is a smooth decay centered on the equator (0-15deg,
peaking AT the equator, not avoiding it), not a hard band. There's a
second, separate bump at 40-90deg (the Southern Ocean ring), but our
model already calls 70.9% of Diesing's high-latitude Radiolarian-ooze
cells "siliceous-ooze" correctly at the bucket level -- that bump is
already handled, not a gap. Even a perfect equatorial fix only touches
~20% of Diesing's total Radiolarian-ooze area globally; most of the rest
is the high-latitude ring already working.

The standing caveat (ADR-0011's Diesing cross-check) still applies in
full: Diesing's own equatorial confidence traces back to a Random Forest
generalizing from the SAME ~106-point sparse sample already in this
project's dataset, using a richer covariate set (real productivity, real
silicate) this project has no access to -- not independent dense ground
truth.

## Decision: build it, but as an equal alternative, not a replacement -- and make it gradational, not a cutoff

Explicitly requested: keep both as equal options, and make the equatorial
effect a smooth, gradational function of latitude, not a hard degree
cutoff.

1. **`applyEquatorialRadiolarianBelt(probs, latDeg)`** (`src/lithology.ts`)
   -- a single-feature logistic fit (`abslat` only, fit on the real
   clay-cell comparison above, restricted to \|lat\|<40 to avoid
   contaminating the fit with the separate high-latitude mechanism)
   reassigns some of a cell's `clay` probability mass to `siliceous-ooze`,
   smoothly decreasing from ~86% at the equator to ~0% by ~40deg.
   `carbonate-ooze` is untouched -- this is only about the clay/siliceous
   split, which is where the real disagreement with Diesing lives.
2. **Option A = `classifyLithologyProbabilistic()` + this function. Option
   B = `classifyLithologyProbabilistic()` alone (unchanged).** Neither
   supersedes the other. `buildPresentDayGrid()` and `buildLithologyLog()`
   both take an `applyBelt` boolean (default `false` = Option B); callers
   wanting both call each function twice.
3. **UI**: both the present-day grid and the last-built Synthetic Core log
   are computed for BOTH options up front and held in memory
   (`src/main.ts`); a checkbox ("Option A: equatorial Radiolarian belt")
   switches which is drawn, instantly -- no refetch, since only the
   classification step (cheap, local) differs between them.

## Verified against the real deployed code before calling this done

`show-me/2026-09-09-simplified-classifier-map/verify_belt_toggle.mjs`,
computed from `buildPresentDayGrid()` itself (not a re-derivation): 2,066
of 30,387 mapped cells change class between the two options, concentrated
exactly where expected and nowhere else --

| \|lat\| | % cells changed |
|---|---:|
| 0-5 | 32.2% |
| 5-15 | 25.9% |
| 15-25 | 4.3% |
| 25-40 | 0.5% |
| 40-90 | 0.0% |

-- confirming the belt is gradational (no sharp jump at a cutoff degree)
and confined to the equatorial band, with zero effect on the already-
correct high-latitude ring. See
`02-option-a-vs-option-b-diff.png` for the geographic pattern (a clean
equatorial band, not scattered noise).

## Consequences

- **The honest tradeoff is real and unresolved by design, not swept
  under either option.** Option A trusts Diesing's richer-covariate
  extrapolation from the same thin sample this project already has, in
  exchange for matching an independent published map far more closely
  right where the two disagree most. Option B stays strictly faithful to
  this project's own point-data fit, and is honestly wrong across the
  same real, now precisely-bounded equatorial band. Neither is "more
  correct" in any sense this project can currently verify -- there is no
  denser independent ground truth to adjudicate between them.
- Some cells flip clay->carbonate-ooze rather than clay->siliceous-ooze
  under Option A (not a bug: draining clay's probability mass can let an
  already-close carbonate-ooze probability become the new argmax instead,
  when carbonate was competitive to begin with -- a genuine three-way
  consequence of redistributing probability mass, not a two-way
  clay-vs-siliceous swap).
- Both options are now a permanent, equally-weighted part of the
  production code and UI, not a one-off experiment -- future recalibration
  of `classifyLithologyProbabilistic()` (Option B's base) automatically
  changes Option A's starting point too, since Option A is defined as a
  transformation on top of it, not an independent fit.
