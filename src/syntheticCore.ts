/**
 * Synthetic Core, Phase 2 -- CONTEXT.md, docs/plans/sediment-core-
 * simulator.md's build order step 2. Given a present-day click already
 * resolved to a Plate-Frame Point (Scotese assignment, ADR-0002) and its
 * Basement Age (Seton et al. 2020, present-day lookup, never rotated),
 * reconstruct the point's own paleoposition, GDH1 depth, and Lithology
 * Class across its entire lifetime, from formation at the ridge crest
 * (crustalAgeMa = 0) to today (ageMa = 0, crustalAgeMa = basementAgeMa).
 *
 * Two different time resolutions, deliberately not merged into one:
 *   - buildAgeDepthModel(): a smooth, arbitrary-resolution (default 1 Ma)
 *     trajectory + depth curve -- pure geometry, no climate dependency, so
 *     it can be as fine as wanted.
 *   - buildLithologyLog(): the actual down-core Lithology Class log, at
 *     BRIDGE-Valdes's own real Frame ages (irregular, ~4-8 Myr apart --
 *     confirmed by inspecting the live manifest, not assumed), because
 *     OVEL only exists at those ages. Interpolating OVEL onto a finer grid
 *     would fabricate precision the climate model doesn't have.
 *
 * The CCD-through-time design question (how ADR-0005's two cross-checked
 * curves, Published and CO2-Linked, should combine once they're queried at
 * ages where they actually diverge) is resolved here, not deferred:
 * BOTH curves are carried through every step (classPublished/
 * classCo2Linked), with a `divergent` flag when they disagree, rather than
 * silently collapsing to one number -- ADR-0005's own "a diagnostic
 * signal, not averaged away" principle, extended from a design intent at
 * age=0 (where Phase 1 lived and the two curves happened to agree closely)
 * to something actually load-bearing now that Phase 2 queries ages where
 * they don't. This was forced, not just principled: the Published CCD
 * Curve only covers 0-140 Ma; anything older has only the CO2-Linked
 * Curve to offer, so "pick one curve globally" was never really available
 * as a simpler option anyway.
 */

import type { LonLat } from './core/constants';
import type { RotationTable } from './core/types';
import {
  positionAt, createPlateFramePoint, type PlateFramePoint, type PlateAssignment,
} from './core/staticPolygons';
import type { CellSample } from './core/queryPoint';
import { ageToDepthKm, classifyLithology, type LithologyClass } from './lithology';
import { ccdKmAt, type CcdCurve } from './ccdCurve';

/**
 * SODP's rule for a Plate-Frame Point is different from Geode's own (ADR-
 * 0001: drift accepted, ADR-0002). Geode's assignPlate()/positionAt()
 * (ported verbatim) assume the static polygon's own beginAge is a real
 * geological formation age -- true for Muller et al. (2019)'s oceanic
 * isochron-zoned polygons, which is the dataset that logic was designed
 * against -- and use it to gate how far back a point can be rotated.
 *
 * SODP's Scotese/PALEOMAP polygons supply ONLY the present-day plate ID,
 * via spatial containment; their own age fields are never used. The real
 * age constraint is Basement Age (Seton et al. 2020) alone -- exactly what
 * buildAgeDepthModel()'s own loop bound (basementAgeMa) already enforces.
 * Confirmed directly, not assumed: PALEOMAP's FROMAGE/TOAGE shapefile
 * fields are a degenerate 0/0 for 39% of polygons, and even where
 * non-zero, don't mean "formation age" the way Muller 2019's do -- they're
 * the source shapefile's own digitizing/rendering-relevance window, a
 * different thing entirely. Using them to gate positionAt() made
 * buildAgeDepthModel() stop after a single step for any point landing on a
 * degenerate polygon, regardless of its real Basement Age.
 *
 * This builds a Plate-Frame Point whose `beginAge` cannot gate
 * positionAt() at all (set to the rotation table's own maximum age --
 * rotationAt() safely holds at the table's edge beyond that rather than
 * erroring, so this is a real bound, not Infinity masking a different
 * failure mode).
 */
export function createUnboundedPlateFramePoint(
  assignment: PlateAssignment, table: RotationTable, at: LonLat, referenceAge: number,
): PlateFramePoint {
  const point = createPlateFramePoint(assignment, table, at, referenceAge);
  const maxTableAge = table.ages[table.ages.length - 1];
  return { ...point, beginAge: Math.max(point.beginAge, maxTableAge) };
}

export interface CoreStep {
  /** Age of this step, Ma before present (0 = today, increasing into the past). */
  ageMa: number;
  /** This step's paleoposition -- null is never stored here; see buildAgeDepthModel(). */
  position: LonLat;
  /** Age of the CRUST ITSELF at this step: basementAgeMa - ageMa. 0 at
   *  formation (ageMa = basementAgeMa, the ridge crest), basementAgeMa
   *  today (ageMa = 0) -- the same quantity ageToDepthKm() expects. */
  crustalAgeMa: number;
  /** GDH1 thermal-subsidence depth at crustalAgeMa, km (ADR-0007). */
  oceanDepthKm: number;
}

/**
 * Walk a Plate-Frame Point's own lifetime from today back to its formation
 * age, in `ageStepMa` increments, always including both endpoints exactly
 * (today and formation) regardless of whether `ageStepMa` divides evenly.
 *
 * `point` MUST come from createUnboundedPlateFramePoint(), not
 * createPlateFramePoint() directly -- see that function's doc comment for
 * why the static polygon's own age must not gate this walk. With an
 * unbounded point, the `if (!position) break` below is no longer a routine
 * occurrence; it's a real safety net for the one case that can still make
 * positionAt() return null: `basementAgeMa` (Seton 2020) exceeding the
 * rotation table's own actual age coverage. When that happens the model
 * just stops -- there is no rotation to offer past that point, not a
 * fabricated one.
 */
export function buildAgeDepthModel(
  point: PlateFramePoint,
  table: RotationTable,
  basementAgeMa: number,
  ageStepMa: number = 1,
): CoreStep[] {
  const steps: CoreStep[] = [];

  for (let ageMa = 0; ageMa <= basementAgeMa; ageMa += ageStepMa) {
    const position = positionAt(point, table, ageMa);
    if (!position) break; // older than this point's own plate assignment (ADR-0002 mismatch)
    const crustalAgeMa = basementAgeMa - ageMa;
    steps.push({ ageMa, position, crustalAgeMa, oceanDepthKm: ageToDepthKm(crustalAgeMa) });
  }

  const last = steps[steps.length - 1];
  if (last && last.ageMa < basementAgeMa) {
    const position = positionAt(point, table, basementAgeMa);
    if (position) {
      steps.push({ ageMa: basementAgeMa, position, crustalAgeMa: 0, oceanDepthKm: ageToDepthKm(0) });
    }
  }

  return steps;
}

export interface LithologyLogStep {
  ageMa: number;
  position: LonLat;
  crustalAgeMa: number;
  oceanDepthKm: number;
  ovelCmS: number;
  /** undefined past 140 Ma -- the Published CCD Curve's own coverage limit. */
  ccdPublishedKm: number | undefined;
  ccdCo2LinkedKm: number | undefined;
  classPublished: LithologyClass | undefined;
  classCo2Linked: LithologyClass | undefined;
  /** Both curves have a value at this step AND disagree on the resulting
   *  class -- ADR-0005's cross-check surfacing a real disagreement, not an
   *  error. Never true when either curve is undefined here (can't diverge
   *  from nothing to compare against). */
  divergent: boolean;
  /** Published where available, else CO2-Linked (the same "real data
   *  preferred over modeled" tiering prep_ccd.py already uses for the
   *  Published Curve's own construction) -- a single answer for a caller
   *  that just wants one, with `divergent` still there for one that wants
   *  the full picture. */
  classPrimary: LithologyClass | undefined;
}

/**
 * The down-core Lithology Class log for a Plate-Frame Point, at OVEL's own
 * real Frame ages (`ovelSeries`, from plateFrameAgeSeries() against
 * BRIDGE-Valdes's ocean-depth manifest, layerIndex=0 -- see
 * core/queryPoint.ts's module doc). `ovelSeries` should already be
 * filtered/fetched for this point; steps older than `basementAgeMa` (crust
 * that didn't exist yet) are dropped here rather than expected to be
 * pre-filtered, since plateFrameAgeSeries() has no reason to know about
 * Basement Age itself (a different data source entirely, ADR-0002).
 */
export function buildLithologyLog(
  point: PlateFramePoint,
  table: RotationTable,
  basementAgeMa: number,
  ovelSeries: (CellSample & { age: number })[],
  publishedCurve: CcdCurve,
  co2LinkedCurve: CcdCurve,
): LithologyLogStep[] {
  const steps: LithologyLogStep[] = [];

  for (const sample of ovelSeries) {
    if (sample.age > basementAgeMa) continue;
    const position = positionAt(point, table, sample.age);
    if (!position) continue; // same rotation-table-edge case as buildAgeDepthModel()

    const crustalAgeMa = basementAgeMa - sample.age;
    const oceanDepthKm = ageToDepthKm(crustalAgeMa);
    const ovelCmS = sample.value;

    const ccdPublishedKm = ccdKmAt(publishedCurve, sample.age);
    const ccdCo2LinkedKm = ccdKmAt(co2LinkedCurve, sample.age);
    const classPublished = ccdPublishedKm === undefined || Number.isNaN(ovelCmS)
      ? undefined : classifyLithology({ oceanDepthKm, ccdKm: ccdPublishedKm, ovelCmS });
    const classCo2Linked = ccdCo2LinkedKm === undefined || Number.isNaN(ovelCmS)
      ? undefined : classifyLithology({ oceanDepthKm, ccdKm: ccdCo2LinkedKm, ovelCmS });
    const divergent = classPublished !== undefined && classCo2Linked !== undefined
      && classPublished !== classCo2Linked;

    steps.push({
      ageMa: sample.age, position, crustalAgeMa, oceanDepthKm, ovelCmS,
      ccdPublishedKm, ccdCo2LinkedKm, classPublished, classCo2Linked, divergent,
      classPrimary: classPublished ?? classCo2Linked,
    });
  }

  return steps;
}
