/**
 * The Lithology Class rule -- CONTEXT.md, ADR-0006, ADR-0007. This is the
 * one piece of domain logic in this project with no literature source
 * behind its exact functional form; see ADR-0007 for the reasoning behind
 * every choice made here.
 */

export type LithologyClass = 'carbonate-ooze' | 'siliceous-ooze' | 'clay';

/**
 * Ocean depth (km) from Basement Age (Ma) via GDH1 (Stein & Stein 1992) --
 * see ADR-0007. GDH1 itself is defined in metres; converted to km to match
 * the CCD Curve's own units (data/ccd/*.json, archive/ccd/*.json).
 */
export function ageToDepthKm(ageMa: number): number {
  const depthM = ageMa <= 20
    ? 2600 + 365 * Math.sqrt(ageMa)
    : 5651 - 2473 * Math.exp(-0.0278 * ageMa);
  return depthM / 1000;
}

export interface LithologyInputs {
  /** Ocean depth at the query point, km. Present-day map: real bathymetry
   *  (ADR-0008), NOT ageToDepthKm() -- GDH1 has no dynamic topography,
   *  sediment loading, or hotspot-swell correction, so it systematically
   *  misrepresents real present-day depth. GDH1 remains correct for
   *  Phase 2's through-time query, where no observed depth exists. */
  oceanDepthKm: number;
  /** CCD Curve value at the query age, km. Present-Day Lithology Map
   *  (ADR-0006) always uses the age=0 value, regardless of the point's own
   *  Basement Age -- see ADR-0007. Prefer ccdKmForBasin() (ADR-0008) over
   *  the single global Published CCD Curve value where a basin label is
   *  available. */
  ccdKm: number;
  /** OVEL, cm/s, upwelling-positive (CONTEXT.md's Productivity Signal). */
  ovelCmS: number;
}

/** Ocean basins with a literature CCD estimate -- see ccdKmForBasin(). */
export type OceanBasin = 'atlantic' | 'pacific' | 'indian';

/**
 * Per-basin CCD (km), present-day, replacing the single global value for
 * the Present-Day Lithology Map -- ADR-0008. A single global CCD flattens
 * the real, large Atlantic/Pacific contrast the CCD Curve sources
 * (Van Andel 1975, Pälike 2012, Dutkiewicz & Müller 2021) already disagree
 * about by basin.
 *
 * These three values are literature-range estimates (Pacific ~4200-4500 m,
 * Atlantic ~5000 m, Indian ~4300 m) surfaced during that investigation, not
 * one single pinned source the way Pälike's Pacific value is -- treat to
 * roughly +/-0.2-0.3 km, the same confidence level ADR-0005 already assigns
 * Van Andel 1975's digitized curves. Basins outside this map (Southern
 * Ocean sectors, marginal seas, Arctic, etc.) have no entry; callers should
 * fall back to the single global Published CCD Curve value there.
 */
const CCD_KM_BY_BASIN: Record<OceanBasin, number> = {
  pacific: 4.35,
  atlantic: 5.00,
  indian: 4.30,
};

export function ccdKmForBasin(basin: OceanBasin): number {
  return CCD_KM_BY_BASIN[basin];
}

/**
 * The three-way rule itself -- see ADR-0007 for why each branch is where
 * it is. `ovelCmS <= 0` (downwelling or neutral) is checked FIRST: nothing
 * being produced overrides where the point sits relative to the CCD, since
 * the CCD only governs PRESERVATION of carbonate that was produced in the
 * first place, not production itself.
 *
 * Kept exactly as-is, not superseded -- some callers may still want a
 * zero-parameter, no-external-data-dependency rule. Both the present-day
 * map and Phase 2's through-time query now call
 * classifyLithologyProbabilistic() instead -- see ADR-0011.
 */
export function classifyLithology(inputs: LithologyInputs): LithologyClass {
  if (inputs.ovelCmS <= 0) return 'clay';
  if (inputs.oceanDepthKm < inputs.ccdKm) return 'carbonate-ooze';
  return 'siliceous-ooze';
}

/**
 * Deliberately NOT `extends LithologyInputs` -- ADR-0012 dropped OVEL from
 * this classifier entirely (see below), so its inputs are a strict subset
 * of classifyLithology()'s: no `ovelCmS`.
 */
export interface ProbabilisticLithologyInputs {
  /** See LithologyInputs.oceanDepthKm. */
  oceanDepthKm: number;
  /** See LithologyInputs.ccdKm. */
  ccdKm: number;
  /** Ocean temperature at ~5m depth, degC (BRIDGE-Valdes's OTEMP,
   *  layerIndex=0). The actual physical driver of the carbonate/siliceous
   *  split this project's domain framing already names (calcifying
   *  plankton are temperature-limited; diatoms are not), which
   *  `oceanDepthKm`/`ccdKm` alone cannot express. Present-day query:
   *  today's OTEMP frame. Phase 2: the point's own real paleo-OTEMP at
   *  that step's age -- NOT present-day OTEMP reused across time, and not
   *  the |latitude| proxy ADR-0010 originally used, which ADR-0011
   *  replaced this with OTEMP specifically to avoid (a proxy this good at
   *  present day is not guaranteed good in a hothouse climate state with a
   *  much flatter equator-to-pole gradient; real simulated paleo-
   *  temperature does not have that problem by construction). See
   *  ADR-0011. */
  otempC: number;
}

/** A probability for each LithologyClass, always summing to 1. */
export type LithologyProbabilities = Record<LithologyClass, number>;

/**
 * Multinomial logistic regression classifier over
 * [oceanDepthKm - ccdKm, otempC], fitted against 8,445 real
 * seafloor-lithology point observations (Dutkiewicz-style compilation) --
 * see ADR-0011/ADR-0012 and show-me/2026-09-09-present-day-validation/
 * fit_probabilistic_classifier.py for the fit itself and its validation.
 *
 * Replaces classifyLithology() for both the present-day map and Phase 2's
 * through-time query (ADR-0011 -- an earlier version of this classifier,
 * ADR-0010, used |latitude| instead of OTEMP and was present-day-only for
 * that reason). Measured against the same real data classifyLithology()
 * was checked against: classifyLithology() scores 43.1% overall 3-way
 * accuracy (worse than the 48.8% you get by guessing "carbonate-ooze" for
 * every point); this scores 67.9% (5-fold cross-validated, not just
 * fit-then-graded-on-itself).
 *
 * ADR-0012: OVEL was DROPPED from this classifier -- checked directly
 * (show-me/2026-09-09-present-day-validation/fit_with_osal.py's ablation),
 * [margin, otemp] alone scores the identical 67.9% CV accuracy as
 * [ovel, margin, otemp], class-by-class, down to the same 0%/68.7%
 * warm/cold siliceous-ooze split (see ADR-0011's "Known limitation"
 * section) -- OVEL was carrying no measurable weight once OTEMP is
 * present. Dropping it removes a live data fetch from both the
 * present-day map and Phase 2 (one fewer external variable to fetch per
 * click) for no accuracy cost, real or per-class.
 *
 * Coefficients are in RAW feature units (not standardized) -- already
 * converted back from the fit's internal StandardScaler so no scaler
 * state needs to travel with this code; see the fit script's own comment
 * for the conversion. Order of `PROB_CLASSIFIER.classes` is the order
 * `coef`/`intercept` rows correspond to, not the order LithologyClass's
 * type union is declared in.
 */
const PROB_CLASSIFIER: { classes: LithologyClass[]; coef: number[][]; intercept: number[] } = {
  classes: ['carbonate-ooze', 'clay', 'siliceous-ooze'],
  coef: [
    [-0.6468372653532644, 0.07674432783719803],
    [0.5402521969596821, 0.017426666913687723],
    [0.10658506839358145, -0.09417099475088585],
  ],
  intercept: [-1.165691839106127, 0.3167807565171921, 0.8489110825888322],
};

export function classifyLithologyProbabilistic(inputs: ProbabilisticLithologyInputs): LithologyProbabilities {
  const x = [inputs.oceanDepthKm - inputs.ccdKm, inputs.otempC];
  const scores = PROB_CLASSIFIER.coef.map(
    (row, i) => row[0] * x[0] + row[1] * x[1] + PROB_CLASSIFIER.intercept[i],
  );
  const maxScore = Math.max(...scores);
  const expScores = scores.map((s) => Math.exp(s - maxScore)); // shift for numerical stability
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  const probs = {} as LithologyProbabilities;
  PROB_CLASSIFIER.classes.forEach((cls, i) => { probs[cls] = expScores[i] / sumExp; });
  return probs;
}

/**
 * ADR-0013, Option A of two EQUAL, parallel options for the warm/equatorial
 * siliceous-ooze blind spot ADR-0011 documents and accepts (Option B is
 * doing nothing further -- classifyLithologyProbabilistic() as-is). Not a
 * replacement for it; both are meant to stay available side by side, since
 * neither is simply better -- see the ADR for the honest tradeoff.
 *
 * Reassigns some of a cell's `clay` probability mass to `siliceous-ooze`
 * as a smooth (NOT a hard cutoff), monotonically-decreasing function of
 * |latitude| -- a gradational equatorial belt, not a step function at some
 * arbitrary degree boundary. `carbonate-ooze` is left untouched: this is
 * only about the clay/siliceous split, which is where the real disagreement
 * with Diesing (2020) lives (checked directly,
 * show-me/2026-09-09-simplified-classifier-map/radiolarian_belt_check.py):
 * among cells THIS classifier calls clay, the fraction Diesing's map calls
 * Radiolarian ooze falls smoothly from ~73% at the equator to ~1% by 25-30
 * degrees, then stays near zero out to the poles (a separate, already-
 * correctly-handled high-latitude bump exists in the raw data, ADR-0011 --
 * fitting only |lat|<40 here avoids the two mechanisms interfering).
 *
 * `pShift` is a single-feature logistic fit (`abslat` only) of "does
 * Diesing call this cell Radiolarian ooze" against the same real,
 * clay-predicted cells above -- a smooth sigmoid, not hand-drawn, but
 * still fundamentally an external belief being imported, not new data:
 * Diesing's own equatorial confidence traces back to a Random Forest
 * generalizing from the SAME ~106-point sparse sample already in this
 * project's own dataset (ADR-0011's Diesing cross-check), using a richer
 * covariate set (real productivity, real silicate) this project does not
 * have access to. Applying this function is a deliberate choice to trust
 * that richer-covariate extrapolation over this project's own point-data
 * fit, in exchange for matching an independent, published map far more
 * closely in the one place they disagree sharply. That's the honest
 * tradeoff Option A makes and Option B doesn't.
 */
export function applyEquatorialRadiolarianBelt(
  probs: LithologyProbabilities, latDeg: number,
): LithologyProbabilities {
  const absLat = Math.abs(latDeg);
  const pShift = 1 / (1 + Math.exp(-(1.82293092 - 0.19335818 * absLat)));
  const shifted = probs.clay * pShift;
  return {
    ...probs,
    clay: probs.clay - shifted,
    'siliceous-ooze': probs['siliceous-ooze'] + shifted,
  };
}

/** The single most likely class -- for callers that want a map to draw or
 *  a label to show, with the full distribution still available from
 *  classifyLithologyProbabilistic() for callers that want it (e.g. to
 *  sample a synthetic realization instead of always taking the mode). */
export function argmaxLithologyClass(probs: LithologyProbabilities): LithologyClass {
  return (Object.keys(probs) as LithologyClass[]).reduce((a, b) => (probs[a] >= probs[b] ? a : b));
}
