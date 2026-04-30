/**
 * @fileoverview Pure data helpers for duplicate detection and export escaping.
 */

/**
 * Count saved events per correlation ID.
 * @param {Array<Object>} events
 * @returns {Map<string, number>}
 */
export function buildDuplicateCounts(events) {
  const counts = new Map();
  for (const event of events) {
    counts.set(event.correlationId, (counts.get(event.correlationId) || 0) + 1);
  }
  return counts;
}

/**
 * Add duplicateCount to each event without mutating input objects.
 * @param {Array<Object>} events
 * @returns {Array<Object>}
 */
export function enrichDuplicateCounts(events) {
  const duplicateCounts = buildDuplicateCounts(events);
  return events.map((event) => ({
    ...event,
    duplicateCount: duplicateCounts.get(event.correlationId) || 1,
  }));
}

/**
 * Keep only the newest event for each correlation ID.
 * @param {Array<Object>} events newest-first
 * @returns {Array<Object>}
 */
export function collapseByCorrelationId(events) {
  const collapsed = new Map();
  for (const event of events) {
    if (!collapsed.has(event.correlationId)) {
      collapsed.set(event.correlationId, event);
    }
  }
  return Array.from(collapsed.values());
}

/**
 * Escape a value for CSV output.
 * @param {*} value
 * @returns {string}
 */
export function csvEscape(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}
