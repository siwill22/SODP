/**
 * Age-indexed lookup into a CCD Curve (ADR-0005) -- pure, no I/O. Both
 * archive/ccd/published_ccd_curve.json and co2_linked_ccd_curve.json share
 * this shape (an ascending array of {age_ma, ccd_km, ...}); only those two
 * fields are read here.
 */

export interface CcdCurvePoint {
  age_ma: number;
  ccd_km: number;
}

export interface CcdCurve {
  curve: CcdCurvePoint[];
}

/**
 * Linearly interpolate CCD (km) at `ageMa`. Returns undefined outside the
 * curve's own covered range -- NEVER extrapolated. This matters concretely:
 * the Published CCD Curve only covers 0-140 Ma (archive/ccd/
 * published_ccd_curve.json), while the CO2-Linked Curve covers 0-419.5 Ma
 * (the Foster et al. 2017 compilation's own range, comfortably past Seton
 * 2020's ~338.68 Ma max Basement Age). Past 140 Ma there is no real choice
 * between the two curves to make -- only CO2-Linked has anything to offer,
 * and callers must handle `undefined` rather than treat this as an error.
 */
export function ccdKmAt(curve: CcdCurve, ageMa: number): number | undefined {
  const pts = curve.curve;
  if (pts.length === 0) return undefined;
  if (ageMa < pts[0].age_ma || ageMa > pts[pts.length - 1].age_ma) return undefined;

  let lo = 0;
  while (lo < pts.length - 2 && pts[lo + 1].age_ma < ageMa) lo++;
  const a = pts[lo];
  const b = pts[Math.min(lo + 1, pts.length - 1)];
  if (a.age_ma === b.age_ma) return a.ccd_km;
  const t = (ageMa - a.age_ma) / (b.age_ma - a.age_ma);
  return a.ccd_km + t * (b.ccd_km - a.ccd_km);
}
