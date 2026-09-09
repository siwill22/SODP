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
 *     OTEMP only exists at those ages. Interpolating onto a finer grid
 *     would fabricate precision the climate model doesn't have. Classified
 *     via ADR-0011/ADR-0012's probabilistic classifier (depth-minus-CCD
 *     margin and the point's own real paleo-OTEMP at that step -- OVEL was
 *     dropped, ADR-0012: it carried no measurable weight once OTEMP was
 *     present), not the deterministic classifyLithology() this file used
 *     to call.
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
import type { Manifest, RotationTable, VariableInfo } from './core/types';
import {
  positionAt, createPlateFramePoint, type PlateFramePoint, type PlateAssignment,
} from './core/staticPolygons';
import { plateFrameAgeSeries, plateFrameAgeSeriesNearestLayer, type CellSample } from './core/queryPoint';
import type { FrameByteCache } from './core/frameByteCache';
import {
  ageToDepthKm, classifyLithologyProbabilistic, applyEquatorialRadiolarianBelt, argmaxLithologyClass,
  type LithologyClass, type LithologyProbabilities,
} from './lithology';
import { ccdKmAt, type CcdCurve } from './ccdCurve';
import { delta18OFromTemperature, mgCaFromTemperature } from './proxies';
import {
  depthLayerSearchOrder, currentErosionRiskFromSpeed, dissolutionRiskFromMargin, combineHiatusRisk,
} from './hiatusRisk';

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

/**
 * Fetch a BRIDGE-Valdes variable's real frames for a Plate-Frame Point,
 * bounded by Basement Age BEFORE fetching -- not after. Measured directly
 * (see the timing investigation this function is a response to): calling
 * plateFrameAgeSeries() with the raw manifest and an unbounded point
 * (createUnboundedPlateFramePoint()) fetches every frame the rotation
 * table covers -- 69 frames, 0-340 Ma -- for EVERY point regardless of its
 * own Basement Age. A 1.3 Ma ridge point was fetching the same 69 frames
 * over the network as a 161 Ma point, then buildLithologyLog() discarded
 * 68 of them. Cold-cache latency (~2.3-3.0s, entirely network-bound) was
 * therefore flat across every point rather than scaling with how much
 * history a point actually has. This bounds the frame list first, so a
 * young point's first click only pays for the frames it uses -- the
 * ridge-point case above would fetch 1 frame instead of 69.
 *
 * Generic over `variable` -- originally written for OVEL only (hence the
 * old name, fetchOvelSeriesForCore), then also used for OTEMP (ADR-0011).
 * ADR-0012 dropped OVEL from the classifier entirely, so this is now
 * called only for OTEMP, but stays generic since nothing about it is
 * OTEMP-specific.
 */
export async function fetchClimateSeriesForCore(
  cache: FrameByteCache, manifest: Manifest, variable: VariableInfo,
  point: PlateFramePoint, table: RotationTable, basementAgeMa: number,
  layerIndex?: number,
): Promise<(CellSample & { age: number })[]> {
  const boundedManifest: Manifest = { ...manifest, frames: manifest.frames.filter((f) => f.age_ma <= basementAgeMa) };
  return plateFrameAgeSeries(cache, boundedManifest, variable, point, table, undefined, layerIndex);
}

/**
 * Real bottom-current speed (`sqrt(OCURU^2 + OCURV^2)`, m/s) for Hiatus
 * Risk's Current Erosion Risk (ADR-0019), sampled at whichever of the
 * ocean-depth manifest's real depth layers is nearest each Frame's own
 * GDH1 depth at this point (`ageToDepthKm(basementAgeMa - ageMa)`) --
 * NOT a fixed layer, since a core's own seafloor depth ranges from ~2.6 km
 * at the ridge crest to ~5.65 km asymptotically over its lifetime. Falls
 * back through progressively-less-near layers (`depthLayerSearchOrder()`)
 * when the single nearest one is masked at this real column/Frame, rather
 * than reporting no data outright -- see plateFrameAgeSeriesNearestLayer()'s
 * doc for why (real, nearby data at no extra network cost over a fixed
 * layer).
 */
export async function fetchCurrentSpeedSeriesForCore(
  cache: FrameByteCache, manifest: Manifest, ocuruVar: VariableInfo, ocurvVar: VariableInfo,
  point: PlateFramePoint, table: RotationTable, basementAgeMa: number,
): Promise<(CellSample & { age: number })[]> {
  const depthLabelsKm = manifest.depth_labels_km;
  if (!depthLabelsKm) throw new Error(`${manifest.id}: no depth_labels_km, cannot pick a bottom-current layer`);

  const boundedManifest: Manifest = { ...manifest, frames: manifest.frames.filter((f) => f.age_ma <= basementAgeMa) };
  const layerOrderForAge = (ageMa: number) => depthLayerSearchOrder(depthLabelsKm, ageToDepthKm(basementAgeMa - ageMa));

  const [uSeries, vSeries] = await Promise.all([
    plateFrameAgeSeriesNearestLayer(cache, boundedManifest, ocuruVar, point, table, layerOrderForAge),
    plateFrameAgeSeriesNearestLayer(cache, boundedManifest, ocurvVar, point, table, layerOrderForAge),
  ]);

  return uSeries.map((u, i) => {
    const v = vSeries[i];
    const value = Number.isNaN(u.value) || Number.isNaN(v.value) ? NaN : Math.hypot(u.value, v.value);
    return { age: u.age, cell: u.cell, value };
  });
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
  /** Ocean temperature at this step's age and paleoposition, degC
   *  (BRIDGE-Valdes OTEMP, layerIndex=0) -- ADR-0011's real, time-aware
   *  replacement for a present-day-latitude proxy. */
  otempC: number;
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
  /** delta18O, permil VPDB -- ADR-0014's first Proxy Tracer, computed from
   *  OTEMP alone (undefined only when OTEMP itself is missing/invalid).
   *  ADR-0016: NOT gated on classPrimary === 'carbonate-ooze' -- real
   *  cores routinely yield a carbonate isotope signal from minor/accessory
   *  calcite even in clay-dominated intervals, and this project's own
   *  `probsPrimary['carbonate-ooze']` is a classification confidence, not
   *  a validated volumetric composition, so a hard label gate would be
   *  false precision either way. Pair this value with
   *  `probsPrimary['carbonate-ooze']` (never this field alone) to judge
   *  how plausible actually recovering it would be. */
  delta18O: number | undefined;
  /** Mg/Ca, mmol/mol -- ADR-0018's second Proxy Tracer, computed from OTEMP
   *  alone via the same real, pooled multi-species calibration
   *  (mgCaFromTemperature()). Same gating as delta18O (ADR-0016): NOT tied
   *  to classPrimary, pair with probsPrimary['carbonate-ooze'] to judge
   *  plausibility. */
  mgCa: number | undefined;
  /** The full probability distribution behind classPublished/classCo2Linked
   *  -- ADR-0011's classifier is probabilistic throughout; argmax picks a
   *  single label but this project's own real point data is a mixture, not
   *  a pure end-member, at most real locations (ADR-0015). Kept per-curve,
   *  same as the class fields, since margin (and so the distribution)
   *  differs between the two CCD curves. */
  probsPublished: LithologyProbabilities | undefined;
  probsCo2Linked: LithologyProbabilities | undefined;
  /** Published where available, else CO2-Linked -- same tiering as
   *  classPrimary, for a caller that just wants one distribution. */
  probsPrimary: LithologyProbabilities | undefined;
  /** Hiatus Risk (ADR-0019) -- an ANNOTATION only, no effect on
   *  oceanDepthKm/position/any class or Proxy Tracer field above. Real
   *  bottom-current speed (OCURU/OCURV, nearest depth layer) against a
   *  literature critical-erosion-velocity threshold. undefined only when
   *  current speed itself is missing/invalid (e.g. no currentSpeedSeries
   *  passed to buildLithologyLog()). */
  currentErosionRisk: number | undefined;
  /** Hiatus Risk (ADR-0019) -- margin below classPrimary's CCD, boosted
   *  when `divergent`. undefined only when classPrimary/its margin is
   *  itself undefined (Published curve N/A this far back AND CO2-Linked
   *  N/A too -- shouldn't happen in practice but mirrors the other
   *  undefined-propagation fields above). */
  dissolutionRisk: number | undefined;
  /** Derived convenience field, ADR-0019: probability at least one of
   *  currentErosionRisk/dissolutionRisk applies, treating them as
   *  independent. Both underlying risks stay separately available -- see
   *  their own doc comments. undefined iff either is undefined. */
  hiatusRisk: number | undefined;
}

/**
 * The down-core Lithology Class log for a Plate-Frame Point, at OTEMP's
 * own real Frame ages (`otempSeries`, from fetchClimateSeriesForCore()
 * against BRIDGE-Valdes's ocean-depth manifest, layerIndex=0 -- see
 * core/queryPoint.ts's module doc). Steps older than `basementAgeMa`
 * (crust that didn't exist yet) are dropped here rather than expected to
 * be pre-filtered, since plateFrameAgeSeries() has no reason to know about
 * Basement Age itself (a different data source entirely, ADR-0002).
 *
 * Classification is ADR-0011/ADR-0012's probabilistic classifier
 * (classifyLithologyProbabilistic() + argmaxLithologyClass()), using each
 * step's own real paleo-OTEMP -- not classifyLithology() and not
 * present-day OTEMP/latitude reused across time. OVEL is no longer fetched
 * or passed in here at all (ADR-0012: dropped, no measurable weight once
 * OTEMP was present).
 *
 * `applyBelt` (ADR-0013): Option A vs Option B -- see
 * presentDayMap.ts::buildPresentDayGrid()'s doc for the full explanation;
 * the same two equal, parallel options apply here, using each step's own
 * real paleo-latitude (`position.lat`) rather than a present-day one.
 * Callers wanting both should call this twice.
 *
 * `currentSpeedSeries` (ADR-0019, optional): real bottom-current speed at
 * OTEMP's own Frame ages (fetchCurrentSpeedSeriesForCore()), matched to
 * each step by age. Omitted entirely -> currentErosionRisk/hiatusRisk are
 * undefined for every step, same "no live fetch, no derived value" shape
 * the rest of this file already uses for missing inputs.
 */
export function buildLithologyLog(
  point: PlateFramePoint,
  table: RotationTable,
  basementAgeMa: number,
  otempSeries: (CellSample & { age: number })[],
  publishedCurve: CcdCurve,
  co2LinkedCurve: CcdCurve,
  applyBelt = false,
  currentSpeedSeries?: (CellSample & { age: number })[],
): LithologyLogStep[] {
  const steps: LithologyLogStep[] = [];
  const speedByAge = new Map((currentSpeedSeries ?? []).map((s) => [s.age, s.value]));

  for (let i = 0; i < otempSeries.length; i++) {
    const sample = otempSeries[i];
    if (sample.age > basementAgeMa) continue;
    const position = positionAt(point, table, sample.age);
    if (!position) continue; // same rotation-table-edge case as buildAgeDepthModel()

    const crustalAgeMa = basementAgeMa - sample.age;
    const oceanDepthKm = ageToDepthKm(crustalAgeMa);
    const otempC = sample.value;

    const ccdPublishedKm = ccdKmAt(publishedCurve, sample.age);
    const ccdCo2LinkedKm = ccdKmAt(co2LinkedCurve, sample.age);
    const validInputs = !Number.isNaN(otempC);
    const classify = (ccdKm: number): LithologyProbabilities => {
      let probs = classifyLithologyProbabilistic({ oceanDepthKm, ccdKm, otempC });
      if (applyBelt) probs = applyEquatorialRadiolarianBelt(probs, position.lat);
      return probs;
    };
    const probsPublished = ccdPublishedKm === undefined || !validInputs
      ? undefined : classify(ccdPublishedKm);
    const probsCo2Linked = ccdCo2LinkedKm === undefined || !validInputs
      ? undefined : classify(ccdCo2LinkedKm);
    const classPublished = probsPublished === undefined ? undefined : argmaxLithologyClass(probsPublished);
    const classCo2Linked = probsCo2Linked === undefined ? undefined : argmaxLithologyClass(probsCo2Linked);
    const divergent = classPublished !== undefined && classCo2Linked !== undefined
      && classPublished !== classCo2Linked;
    const classPrimary = classPublished ?? classCo2Linked;
    const probsPrimary = probsPublished ?? probsCo2Linked;
    const delta18O = validInputs ? delta18OFromTemperature(otempC) : undefined;
    const mgCa = validInputs ? mgCaFromTemperature(otempC) : undefined;

    const speedMs = speedByAge.get(sample.age);
    const currentErosionRisk = speedMs === undefined || Number.isNaN(speedMs)
      ? undefined : currentErosionRiskFromSpeed(speedMs);
    const ccdPrimaryKm = ccdPublishedKm ?? ccdCo2LinkedKm;
    const dissolutionRisk = ccdPrimaryKm === undefined
      ? undefined : dissolutionRiskFromMargin(oceanDepthKm - ccdPrimaryKm, divergent);
    const hiatusRisk = currentErosionRisk === undefined || dissolutionRisk === undefined
      ? undefined : combineHiatusRisk(currentErosionRisk, dissolutionRisk);

    steps.push({
      ageMa: sample.age, position, crustalAgeMa, oceanDepthKm, otempC,
      ccdPublishedKm, ccdCo2LinkedKm, classPublished, classCo2Linked, divergent,
      classPrimary, delta18O, mgCa, probsPublished, probsCo2Linked, probsPrimary,
      currentErosionRisk, dissolutionRisk, hiatusRisk,
    });
  }

  return steps;
}
