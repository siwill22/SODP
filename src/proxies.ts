/**
 * Proxy Tracers -- CONTEXT.md's "later increment" over the v1
 * Lithology-Class-only Synthetic Core. First: delta18O, ADR-0014. Second:
 * Mg/Ca, ADR-0018.
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

/**
 * Anand, Elderfield & Wilson (2003), Paleoceanography -- Mg/Ca thermometry
 * calibrated against a 6-year sediment trap time series (Sargasso Sea),
 * POOLED across multiple planktonic foraminifer species, not one specific
 * species (ADR-0018 -- deliberately: this project has no basis to assert
 * which real foraminifer would be present at a synthetic point, and a
 * pooled calibration doesn't pretend otherwise the way picking one named
 * species's calibration would):
 *
 *   Mg/Ca (mmol/mol) = 0.38 * exp(0.090 * T)
 *
 * Confirmed against the real published source, not assumed from memory
 * (https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2002PA000846).
 * Unlike delta18OFromTemperature(), this is already expressed directly as
 * Mg/Ca(T) -- no inversion needed. Sanity-checked across a realistic ocean
 * temperature range: 0degC -> 0.38 mmol/mol, 25degC -> 3.6 mmol/mol,
 * matching real published planktic foram ranges (cool ~0.4-1, warm
 * tropical ~3-6 mmol/mol).
 *
 * No dissolution correction (ADR-0018's explicit, flagged simplification,
 * matching delta18OFromTemperature()'s fixed-seawater-d18O simplification)
 * -- real Mg/Ca is also depressed by carbonate dissolution at depth (e.g.
 * Dekens et al. 2002), which this project could in principle add later
 * using the same depth-relative-to-CCD margin already computed everywhere
 * else, but that is a second, separately-sourced relationship, deliberately
 * not bundled into landing this proxy.
 */
export function mgCaFromTemperature(otempC: number): number {
  return 0.38 * Math.exp(0.090 * otempC);
}
