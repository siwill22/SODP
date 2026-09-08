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
 */
export function classifyLithology(inputs: LithologyInputs): LithologyClass {
  if (inputs.ovelCmS <= 0) return 'clay';
  if (inputs.oceanDepthKm < inputs.ccdKm) return 'carbonate-ooze';
  return 'siliceous-ooze';
}
