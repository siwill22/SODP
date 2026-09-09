/**
 * Proxy Tracers -- CONTEXT.md's "later increment" over the v1
 * Lithology-Class-only Synthetic Core. First one: delta18O, ADR-0014.
 */

/**
 * Shackleton (1974)'s calcite paleotemperature equation, refining Epstein
 * et al. (1953)/Craig (1965) -- widely cited in this exact form (e.g.
 * Bemis et al. 1998, Table 1):
 *
 *   T (degC) = 16.9 - 4.38*(dc - dw) + 0.10*(dc - dw)^2
 *
 * where dc = calcite delta18O (permil VPDB), dw = seawater delta18O
 * converted to the VPDB-equivalent scale (dw_smow - 0.27, the standard
 * SMOW->PDB offset).
 *
 * This project has OTEMP (the known quantity) and needs dc -- the
 * inverse, solved via the quadratic formula. Two roots exist; the smaller
 * ("minus") one is the physically valid root across the entire real ocean
 * temperature range -- checked directly, not assumed (ADR-0014): the
 * discriminant is 12.4244 + 0.4*T, positive for every T > -31degC, and
 * the minus root reproduces real reference values at both ends of a
 * realistic range (T=0degC -> dc=+4.0 permil VPDB, matching cold benthic
 * calcite; T=25degC -> dc=-2.0 permil VPDB, matching warm planktic
 * calcite).
 *
 * `seawaterD18OSmow` defaults to 0 permil VSMOW (today's approximate
 * ice-free global mean) -- a fixed constant through all of geological
 * time, not scaled by an ice-volume curve (ADR-0014's explicit, flagged
 * simplification).
 */
export function delta18OFromTemperature(otempC: number, seawaterD18OSmow = 0): number {
  const seawaterD18OPdb = seawaterD18OSmow - 0.27;
  const a = 0.10;
  const b = -4.38;
  const c = 16.9 - otempC;
  const discriminant = b * b - 4 * a * c;
  const x = (-b - Math.sqrt(discriminant)) / (2 * a); // minus root -- see doc comment
  return x + seawaterD18OPdb;
}
