/**
 * @fileoverview Order flow stitching helpers for SKU-to-delivery investigations.
 */

import { ORDER_FLOW_MILESTONES } from './constants.js';

/**
 * Build a stitched order flow report from captured events and manual context.
 * @param {Array<Object>} events newest-first
 * @param {Object} flowState
 * @param {number} [now]
 * @param {Array<Object>|Array<string>|string} [milestones]
 * @returns {{ subject: string, body: string, matchedEvents: Array<Object> }}
 */
export function buildOrderFlowReport(events, flowState = {}, now = Date.now(), milestones = ORDER_FLOW_MILESTONES) {
  const selectedEvents = filterEventsForFlow(events, flowState, now);
  const quoteId = findQuoteId(selectedEvents);
  const businessContext = buildBusinessContext(flowState, selectedEvents);
  const normalizedMilestones = normalizeOrderFlowMilestones(milestones);
  const milestoneMatches = assignMilestoneEvents(selectedEvents, normalizedMilestones);
  const subjectParts = ['Order Flow Report'];
  if (businessContext.sku) subjectParts.push(`SKU ${businessContext.sku}`);
  if (quoteId) subjectParts.push(`Quote ${quoteId}`);

  const lines = [];
  lines.push('Order Flow Report');
  lines.push('=================');
  lines.push(`Generated: ${formatTime(now)}`);
  lines.push(`Detection scope: ${formatWindow(flowState, now)}`);
  lines.push('');
  lines.push('Business Context');
  lines.push('----------------');
  lines.push(`SKU: ${businessContext.sku || '-'}`);
  lines.push(`Customer: ${businessContext.customer || '-'}`);
  lines.push(`Address: ${businessContext.address || '-'}`);
  lines.push(`Delivery Type: ${businessContext.deliveryType || '-'}`);
  lines.push(`Quote ID: ${quoteId || '-'}`);
  if (flowState.notes) lines.push(`Notes: ${flowState.notes}`);
  lines.push('');
  lines.push('Milestone Correlation IDs');
  lines.push('-------------------------');

  for (const milestone of milestoneMatches) {
    lines.push(`${milestone.label}:`);
    if (!milestone.events.length) {
      lines.push('  - Not captured yet');
      continue;
    }
    for (const event of milestone.events.slice(0, 1)) {
      lines.push(`  - ${event.correlationId}`);
      lines.push(`    Time: ${formatTime(event.timestamp)}`);
      lines.push(`    Source: ${event.sourceType || '-'}`);
      if (event.headerName) lines.push(`    Header: ${event.headerName}`);
      lines.push(`    URL: ${event.url || '-'}`);
    }
  }

  lines.push('');
  lines.push(`Matched events in window: ${selectedEvents.length}`);

  return {
    subject: subjectParts.join(' - '),
    body: lines.join('\n'),
    matchedEvents: selectedEvents,
  };
}

export function getOrderFlowMilestones() {
  return cloneMilestones(ORDER_FLOW_MILESTONES);
}

export function normalizeOrderFlowMilestones(value = ORDER_FLOW_MILESTONES) {
  const defaultsByKey = new Map(ORDER_FLOW_MILESTONES.map((milestone) => [milestone.key, milestone]));
  const nextByKey = new Map(ORDER_FLOW_MILESTONES.map((milestone) => [
    milestone.key,
    { ...milestone, patterns: [] },
  ]));
  const items = Array.isArray(value) ? value : String(value || '').split('\n');

  for (const item of items) {
    const parsed = parseMilestoneItem(item);
    if (!parsed) continue;
    const key = getMilestoneKey(parsed.label);
    if (!key || !nextByKey.has(key)) continue;
    const milestone = nextByKey.get(key);
    milestone.patterns.push(...parsed.patterns);
  }

  return Array.from(nextByKey.values()).map((milestone) => {
    const defaultMilestone = defaultsByKey.get(milestone.key);
    const patterns = Array.from(new Set([
      ...defaultMilestone.patterns,
      ...milestone.patterns,
    ].map((pattern) => pattern.trim().toLowerCase()).filter(Boolean)));
    return { ...milestone, patterns };
  });
}

export function formatOrderFlowMilestoneLines(milestones = ORDER_FLOW_MILESTONES) {
  return normalizeOrderFlowMilestones(milestones)
    .map((milestone) => `${milestone.label} | ${milestone.patterns.join('; ')}`)
    .join('\n');
}

function filterEventsForFlow(events, flowState, now) {
  const startTime = Number(flowState.startTime) || 0;
  const endTime = Number(flowState.endTime) || now;
  return (Array.isArray(events) ? events : [])
    .filter((event) => event.timestamp >= startTime && event.timestamp <= endTime)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function findQuoteId(events) {
  return findPageDataValue(events, ['quote'], ['order-number']);
}

function buildBusinessContext(flowState, events) {
  const skuValues = flowState.sku ? [flowState.sku] : findPageDataValues(events, ['sku'], ['sku-number']);
  return {
    sku: skuValues.join(', '),
    skus: skuValues,
    customer: flowState.customer || findPageDataValue(events, ['customer'], ['customer-card__name']),
    address: flowState.address || findPageDataValue(events, ['address'], ['delivery address']),
    deliveryType: flowState.deliveryType || findPageDataValue(events, ['delivery type', 'delivery options'], ['delivery options', 'delivery-type']),
    quoteId: findQuoteId(events),
    timestamp: findContextTimestamp(events),
  };
}

function findPageDataValues(events, labelMatches, pathMatches) {
  const values = [];
  const seen = new Set();
  for (const event of events) {
    if (!isMatchingPageData(event, labelMatches, pathMatches)) continue;
    const value = String(event.correlationId || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function findPageDataValue(events, labelMatches, pathMatches) {
  const event = [...events].reverse().find((item) => {
    return isMatchingPageData(item, labelMatches, pathMatches);
  });
  return event ? event.correlationId : '';
}

function isMatchingPageData(event, labelMatches, pathMatches) {
  const label = String(event.fieldLabel || '').toLowerCase();
  const path = String(event.fieldPath || '').toLowerCase();
  return event.sourceType === 'page-data' && (
    labelMatches.some((match) => label.includes(match)) ||
    pathMatches.some((match) => path.includes(match))
  );
}

function findContextTimestamp(events) {
  return events
    .filter((event) => event.sourceType === 'page-data')
    .reduce((latest, event) => Math.max(latest, event.timestamp || 0), 0);
}

function assignMilestoneEvents(events, milestones) {
  const matchesByKey = new Map(milestones.map((milestone) => [milestone.key, []]));
  for (const event of events) {
    if (event.sourceType === 'page-data') continue;
    const match = findBestMilestoneMatch(event, milestones);
    if (!match) continue;
    matchesByKey.get(match.key).push(event);
  }

  return milestones.map((milestone) => ({
    ...milestone,
    events: dedupeMilestoneEvents(matchesByKey.get(milestone.key) || []),
  }));
}

function findBestMilestoneMatch(event, milestones) {
  let bestMatch = null;
  for (const milestone of milestones) {
    const url = String(event.url || '').toLowerCase();
    const matchedPattern = milestone.patterns
      .filter((pattern) => url.includes(pattern))
      .sort((a, b) => b.length - a.length)[0];
    if (!matchedPattern) continue;
    if (!bestMatch || matchedPattern.length > bestMatch.pattern.length) {
      bestMatch = { key: milestone.key, pattern: matchedPattern };
    }
  }
  return bestMatch;
}

function dedupeMilestoneEvents(events) {
  const seen = new Set();
  const matches = [];
  for (const event of [...events].sort(compareMilestoneEvents)) {
    const key = `${event.correlationId}|${event.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(event);
  }
  return matches;
}

function compareMilestoneEvents(a, b) {
  const headerPreference = getHeaderPreference(b) - getHeaderPreference(a);
  if (headerPreference !== 0) return headerPreference;
  return b.timestamp - a.timestamp;
}

function getHeaderPreference(event) {
  return String(event.headerName || '').toLowerCase() === 'usom-correlationid' ? 1 : 0;
}

function formatWindow(flowState, now) {
  const startTime = Number(flowState.startTime) || null;
  const endTime = Number(flowState.endTime) || now;
  if (!startTime) return 'All captured events';
  return `${formatTime(startTime)} to ${flowState.active ? 'active' : formatTime(endTime)}`;
}

function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString('en-US', { hour12: false }) : '-';
}

function cloneMilestones(milestones) {
  return milestones.map((milestone) => ({ ...milestone, patterns: [...milestone.patterns] }));
}

function parseMilestoneItem(item) {
  if (item && typeof item === 'object') {
    const label = String(item.label || '').trim();
    const patterns = Array.isArray(item.patterns) ? item.patterns : String(item.patterns || '').split(/[;,\n]/);
    return label ? { label, patterns: patterns.map(String) } : null;
  }

  const line = String(item || '').trim();
  if (!line || !line.includes('|')) return null;
  const [labelPart, patternPart] = line.split('|');
  const label = labelPart.trim();
  const patterns = String(patternPart || '').split(/[;,]/).map((pattern) => pattern.trim());
  return label && patterns.length ? { label, patterns } : null;
}

function getMilestoneKey(label) {
  const normalized = String(label || '').toLowerCase();
  if (normalized.includes('sourcing') || normalized.includes('source')) return 'sourcingOptions';
  if (normalized.includes('capacity')) return 'capacity';
  if (normalized.includes('reserve')) return 'reserveDelivery';
  return '';
}

export function buildOrderFlowRows(events, flowState = {}, milestones = ORDER_FLOW_MILESTONES) {
  const selectedEvents = filterEventsForFlow(events, flowState, Date.now());
  const normalizedMilestones = normalizeOrderFlowMilestones(milestones);
  const globalContext = buildBusinessContext(flowState, selectedEvents);
  const rowsByTrackingId = new Map();
  const untrackedMilestoneRequests = [];

  for (const request of buildNetworkRequests(selectedEvents)) {
    const match = findBestMilestoneMatch(request, normalizedMilestones);
    if (!match) continue;

    const trackingEvent = request.events.find((event) => isHeader(event, 'order-tracking-id'));
    if (!trackingEvent || !trackingEvent.correlationId) {
      untrackedMilestoneRequests.push({ request, match });
      continue;
    }

    const correlationEvent = findMilestoneCorrelationEvent(request.events) || trackingEvent;
    const trackingId = trackingEvent.correlationId;
    const row = ensureFlowRow(rowsByTrackingId, trackingId, emptyBusinessContext(), request.tabId);
    row[match.key] = {
      correlationId: correlationEvent.correlationId,
      headerName: correlationEvent.headerName || '',
      url: request.url || '',
      timestamp: correlationEvent.timestamp || request.timestamp || 0,
    };
    row.firstSeen = Math.min(row.firstSeen || request.timestamp || correlationEvent.timestamp || 0, request.timestamp || correlationEvent.timestamp || 0);
    row.networkFirstSeen = Math.min(row.networkFirstSeen || request.timestamp || correlationEvent.timestamp || 0, request.timestamp || correlationEvent.timestamp || 0);
    row.networkLastUpdated = Math.max(row.networkLastUpdated || 0, correlationEvent.timestamp || request.timestamp || 0);
    row.lastUpdated = Math.max(row.lastUpdated, correlationEvent.timestamp || request.timestamp || 0);
  }

  attachUntrackedMilestones(Array.from(rowsByTrackingId.values()), untrackedMilestoneRequests);

  if (!rowsByTrackingId.size && hasBusinessContext(globalContext)) {
    ensureFlowRow(rowsByTrackingId, '', globalContext, -1);
  }

  const rows = Array.from(rowsByTrackingId.values()).sort((a, b) => a.firstSeen - b.firstSeen);
  applyScopedBusinessContext(rows, flowState, selectedEvents, globalContext);
  return rows.sort((a, b) => b.lastUpdated - a.lastUpdated);
}

function attachUntrackedMilestones(rows, untrackedMilestoneRequests) {
  if (!rows.length || !untrackedMilestoneRequests.length) return;

  for (const { request, match } of untrackedMilestoneRequests) {
    if (match.key !== 'reserveDelivery') continue;
    const correlationEvent = findMilestoneCorrelationEvent(request.events);
    if (!correlationEvent || !correlationEvent.correlationId) continue;

    const row = findBestRowForUntrackedMilestone(rows, request, correlationEvent);
    if (!row || row[match.key]) continue;

    row[match.key] = {
      correlationId: correlationEvent.correlationId,
      headerName: correlationEvent.headerName || '',
      url: request.url || '',
      timestamp: correlationEvent.timestamp || request.timestamp || 0,
    };
    row.networkLastUpdated = Math.max(row.networkLastUpdated || 0, correlationEvent.timestamp || request.timestamp || 0);
    row.lastUpdated = Math.max(row.lastUpdated || 0, correlationEvent.timestamp || request.timestamp || 0);
  }
}

function findBestRowForUntrackedMilestone(rows, request, correlationEvent) {
  const timestamp = correlationEvent.timestamp || request.timestamp || 0;
  const sameTabRows = rows.filter((row) => row.tabId < 0 || request.tabId < 0 || row.tabId === request.tabId);
  const candidates = sameTabRows.length ? sameTabRows : rows;
  if (candidates.length === 1) return candidates[0];

  return candidates
    .map((row) => ({ row, distance: getRowMilestoneDistance(row, timestamp) }))
    .sort((a, b) => a.distance - b.distance)[0].row;
}

function getRowMilestoneDistance(row, timestamp) {
  const anchors = [row.networkLastUpdated, row.lastUpdated, row.networkFirstSeen, row.firstSeen]
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!anchors.length) return Number.POSITIVE_INFINITY;
  return Math.min(...anchors.map((value) => Math.abs(timestamp - value)));
}

function applyScopedBusinessContext(rows, flowState, events, globalContext) {
  if (!rows.length) return;
  const pageEvents = events.filter((event) => event.sourceType === 'page-data');

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const previousRow = rows[index - 1];
    const nextRow = rows[index + 1];
    const windowStart = previousRow ? midpoint(previousRow.networkLastUpdated, row.networkFirstSeen) : Number.NEGATIVE_INFINITY;
    const windowEnd = nextRow ? midpoint(row.networkLastUpdated, nextRow.networkFirstSeen) : Number.POSITIVE_INFINITY;
    const scopedEvents = pageEvents.filter((event) => {
      const timestamp = event.timestamp || 0;
      const matchesTab = row.tabId < 0 || !Number.isFinite(event.tabId) || event.tabId === row.tabId;
      return matchesTab && timestamp >= windowStart && timestamp < windowEnd;
    });
    const scopedContext = buildBusinessContext({}, scopedEvents);
    const context = hasBusinessContext(scopedContext)
      ? buildBusinessContext(flowState, scopedEvents)
      : buildManualContext(flowState, globalContext);
    mergeFlowContext(row, context);
  }
}

function emptyBusinessContext() {
  return { sku: '', skus: [], customer: '', address: '', deliveryType: '', quoteId: '', timestamp: 0 };
}

function midpoint(left, right) {
  return left + ((right - left) / 2);
}

function buildManualContext(flowState, globalContext) {
  if (!flowState.sku && !flowState.customer && !flowState.address && !flowState.deliveryType) {
    return emptyBusinessContext();
  }
  return {
    sku: flowState.sku || '',
    skus: flowState.sku ? [flowState.sku] : [],
    customer: flowState.customer || '',
    address: flowState.address || '',
    deliveryType: flowState.deliveryType || '',
    quoteId: globalContext.quoteId || '',
    timestamp: 0,
  };
}

function hasBusinessContext(context) {
  return Boolean(context.sku || context.customer || context.address || context.deliveryType || context.quoteId);
}

function buildNetworkRequests(events) {
  const requests = new Map();
  for (const event of events) {
    if (event.sourceType === 'page-data') continue;
    const key = event.requestId || `${event.method}|${event.url}|${event.timestamp}`;
    if (!requests.has(key)) {
      requests.set(key, {
        requestId: event.requestId || '',
        url: event.url || '',
        method: event.method || '',
        tabId: Number.isFinite(event.tabId) ? event.tabId : -1,
        timestamp: event.timestamp || 0,
        events: [],
      });
    }
    const request = requests.get(key);
    request.events.push(event);
    request.timestamp = Math.max(request.timestamp, event.timestamp || 0);
  }
  return Array.from(requests.values());
}

function findMilestoneCorrelationEvent(events) {
  return events.find((event) => isHeader(event, 'usom-correlationid')) ||
    events.find((event) => !isHeader(event, 'order-tracking-id')) ||
    null;
}

function ensureFlowRow(rowsByTrackingId, trackingId, context, tabId) {
  const key = trackingId || `context-${tabId}`;
  if (!rowsByTrackingId.has(key)) {
    rowsByTrackingId.set(key, {
      orderTrackingId: trackingId,
      tabId,
      sku: context.sku || '',
      skus: [...(context.skus || [])],
      customer: context.customer || '',
      address: context.address || '',
      deliveryType: context.deliveryType || '',
      quoteId: context.quoteId || '',
      sourcingOptions: null,
      capacity: null,
      reserveDelivery: null,
      firstSeen: context.timestamp || 0,
      networkFirstSeen: 0,
      networkLastUpdated: 0,
      lastUpdated: context.timestamp || 0,
    });
  }
  const row = rowsByTrackingId.get(key);
  mergeFlowContext(row, context);
  return row;
}

function mergeFlowContext(row, context) {
  row.sku ||= context.sku || '';
  row.skus = mergeValues(row.skus || [], context.skus || []);
  row.sku = row.skus.length ? row.skus.join(', ') : row.sku;
  row.customer ||= context.customer || '';
  row.address ||= context.address || '';
  row.deliveryType ||= context.deliveryType || '';
  row.quoteId ||= context.quoteId || '';
  row.firstSeen = row.firstSeen || context.timestamp || 0;
  row.lastUpdated = Math.max(row.lastUpdated || 0, context.timestamp || 0);
  return row;
}

function mergeValues(left, right) {
  return Array.from(new Set([...left, ...right].filter(Boolean)));
}

function isHeader(event, headerName) {
  return String(event.headerName || '').toLowerCase() === headerName;
}