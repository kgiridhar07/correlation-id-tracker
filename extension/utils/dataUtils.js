/**
 * @fileoverview Pure data helpers for duplicate detection, export escaping, and summaries.
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

/**
 * Build dashboard metrics and insight lists from captured events.
 * @param {Array<Object>} events newest-first
 * @param {number} [now=Date.now()]
 * @returns {Object}
 */
export function summarizeEvents(events, now = Date.now()) {
  const duplicateCounts = buildDuplicateCounts(events);
  const uniqueIds = duplicateCounts.size;
  const duplicateIds = Array.from(duplicateCounts.entries()).filter(([, count]) => count > 1);
  const sourceCounts = countBy(events, (event) => event.sourceType || 'unknown');
  const methodCounts = countBy(events, (event) => event.method || 'UNKNOWN');
  const domainCounts = countBy(events, (event) => safeHostname(event.url) || 'unknown');
  const recentEvents = events.filter((event) => now - event.timestamp <= 60 * 60 * 1000);

  return {
    totalEvents: events.length,
    uniqueIds,
    duplicateIds: duplicateIds.length,
    duplicateEvents: events.length - uniqueIds,
    duplicateRate: events.length ? Math.round(((events.length - uniqueIds) / events.length) * 100) : 0,
    requestCount: sourceCounts.get('request-header') || 0,
    responseCount: sourceCounts.get('response-header') || 0,
    activeDomains: domainCounts.size,
    latestEvent: events[0] || null,
    latestAgeMinutes: events[0] ? Math.max(0, Math.floor((now - events[0].timestamp) / 60000)) : null,
    topDomains: topEntries(domainCounts, 5),
    topMethods: topEntries(methodCounts, 5),
    topDuplicateIds: duplicateIds
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count })),
    recentActivity: buildActivityBuckets(recentEvents, now),
    insight: buildInsight(events.length, recentEvents.length, duplicateIds.length, topEntries(domainCounts, 1)[0]),
  };
}

function countBy(events, mapper) {
  const counts = new Map();
  for (const event of events) {
    const key = mapper(event);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function topEntries(counts, limit) {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function buildActivityBuckets(events, now) {
  const bucketMinutes = 5;
  const bucketCount = 12;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    label: `${(bucketCount - index) * bucketMinutes}m`,
    count: 0,
  }));

  for (const event of events) {
    const ageMinutes = Math.floor((now - event.timestamp) / 60000);
    const bucketIndex = bucketCount - 1 - Math.floor(ageMinutes / bucketMinutes);
    if (bucketIndex >= 0 && bucketIndex < bucketCount) {
      buckets[bucketIndex].count++;
    }
  }

  return buckets;
}

function buildInsight(totalEvents, recentCount, duplicateIdCount, topDomain) {
  if (totalEvents === 0) return 'No captured traffic yet. Send a matching request to start the dashboard.';
  if (duplicateIdCount > 0) return `${duplicateIdCount} correlation IDs appeared more than once. Duplicate mode can help trace repeated flows.`;
  if (recentCount > 0) return `${recentCount} events arrived in the last hour. Recent activity is healthy.`;
  if (topDomain) return `${topDomain.label} is the busiest captured domain with ${topDomain.count} events.`;
  return 'Captured traffic is available for filtering, copy, and export.';
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (_err) {
    return '';
  }
}
