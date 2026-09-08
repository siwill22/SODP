/**
 * Trimmed one-time copy of Geode's viewer/src/core/timeSeries.ts (ADR-0001).
 * Dropped computeTimeSeries()/weightedPercentile()/TimeSeriesPoint -- the
 * area-weighted global-mean chart, which SODP's UI has no equivalent of.
 * Kept only mapPool/CONCURRENCY, which core/queryPoint.ts's ageSeries needs
 * to fetch/reduce Frames a few at a time rather than one-at-a-time or all
 * at once.
 */

/** How many Frames to fetch/reduce at once. */
export const CONCURRENCY = 8;

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
