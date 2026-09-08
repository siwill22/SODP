# CCD Curve is computed two independent ways and cross-checked, not averaged

None of Geode's climate Models simulate ocean carbonate chemistry (checked
directly against every climate Model's variable list — no DIC, alkalinity,
pH, or saturation state anywhere in the archive), so CCD cannot be diagnosed
from model output. It has to come from outside data.

**Decision: source it two ways, run both, and treat disagreement as a
diagnostic rather than resolving it automatically.**

1. **Published CCD Curve** — a digitized literature compilation, sourced
   independently of anything else in this system.
2. **CO2-Linked CCD Curve** — the Foster et al. (2017) CO2 reconstruction
   (the same forcing behind the BRIDGE-Valdes Climate Driver, see ADR-0003)
   run through an empirical CO2-to-CCD relationship from the literature.

Neither is treated as ground truth. If the two diverge significantly at a
given age, that is surfaced, not silently averaged away or picked between —
divergence is itself informative (it says the empirical CO2-CCD
relationship and the independent literature compilation disagree about that
period, which is worth knowing before trusting either).

**No basin differentiation in v1** — one global curve, not
`CCD(t, basin)`. A per-basin curve needs a time-dependent "which ocean
basin is this point in" classification, which is itself a coarse version of
the same gateway/circulation problem the (deferred) Nd basin-mixing proxy
needs. Building that machinery once, for both, later, was preferred over
building a one-off version of it just for CCD now.

## Consequences

- v1's lithology synthesis reads two CCD values per age step, not one — the
  divergence check is a first-class part of the output, not a debugging
  side channel.
- Adding basin-specific CCD later is expected to arrive alongside Nd
  basin-mixing work, sharing one basin-membership-through-time scheme
  rather than two independent ones.
