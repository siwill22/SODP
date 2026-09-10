# Magnetic Susceptibility: a second Physical Property Log, reusing Density's compaction/mixture engine

Requested alongside ADR-0020 as "magnetic properties, magnetostratigraphy"
-- split into two on inspection, since they turned out to be unrelated
features wearing the same word. **Magnetic Susceptibility (MS)** is a
composition-driven physical property, the same kind of thing as Bulk
Density/Porosity. **Magnetostratigraphy** (geomagnetic polarity reversals,
looked up against the real published GPTS by age alone, with a possible
tie-in to visualizing Hiatus Risk as a missing/thinned chron) is a
different, age-driven signal with no lithology or compaction dependency at
all. Asked directly which to design now: MS, because it follows on
naturally from ADR-0020's density/porosity work; magnetostratigraphy is
deliberately deferred to its own future session, not designed here at all.

## Decision

`magSusceptibility(z) = (1 - porosity(z)) * (Σ_c probsPrimary[c] * GRAIN_MS[c])`
-- the exact same compaction/mixture engine ADR-0020 built for
`bulkDensity(z)`, substituting grain magnetic susceptibility for grain
density as the per-Lithology-Class end-member property. Physically
grounded, not just reused for convenience: pore water is magnetically
negligible next to typical detrital (paramagnetic/ferrimagnetic) or
biogenic (near-zero/diamagnetic) grain susceptibilities, so bulk MS scales
with solid fraction `(1 - porosity(z))` the same way bulk density does.

The alternative considered and rejected: a composition-only mixture with no
porosity/depth term (`Σ_c probsPrimary[c] * BULK_MS[c]`, flat with depth for
a fixed lithology mixture). Rejected because it discards the physical link
to the compaction model this whole increment is built on, for no
simplification that actually matters -- the porosity term was already being
computed for density.

`GRAIN_MS` per Lithology Class is **not sourced yet** -- same open-TODO
treatment as ADR-0020's `RATE_CM_KYR`, follow-up work before this field
means anything beyond a shape check.

## Consequences

- Every physical property this project adds from here follows the same
  pattern established across ADR-0020 and this ADR: one compaction/mixture
  engine, a new per-class end-member table per property. A future property
  (e.g. P-wave velocity, ADR-0020's deferred item) should default to this
  shape unless there's a specific physical reason it doesn't fit.
- **Magnetostratigraphy is explicitly not designed by this ADR.** It is a
  real, distinct future increment: age-driven (GPTS chron lookup, not
  lithology-driven), and its natural tie-in to Hiatus Risk (a missing or
  foreshortened chron as a visual hiatus signature) is a genuinely
  different kind of interaction than anything decided in ADR-0020 or here.
  Flagged so a future reader doesn't assume MS's landing covers it.
