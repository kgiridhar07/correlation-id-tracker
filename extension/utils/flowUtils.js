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
    const patterns = Array.from(new Set(milestone.patterns.map((pattern) => pattern.trim().toLowerCase()).filter(Boolean)));
    return patterns.length
      ? { ...milestone, patterns }
      : { ...defaultsByKey.get(milestone.key), patterns: [...defaultsByKey.get(milestone.key).patterns] };
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
  return {
    sku: flowState.sku || findPageDataValue(events, ['sku'], ['sku-number']),
    customer: flowState.customer || findPageDataValue(events, ['customer'], ['customer-card__name']),
    address: flowState.address || findPageDataValue(events, ['address'], ['delivery address']),
    deliveryType: flowState.deliveryType || findPageDataValue(events, ['delivery type', 'delivery options'], ['delivery options', 'delivery-type']),
    quoteId: findQuoteId(events),
  };
}

function findPageDataValue(events, labelMatches, pathMatches) {
  const event = [...events].reverse().find((item) => {
    const label = String(item.fieldLabel || '').toLowerCase();
    const path = String(item.fieldPath || '').toLowerCase();
    return item.sourceType === 'page-data' && (
      labelMatches.some((match) => label.includes(match)) ||
      pathMatches.some((match) => path.includes(match))
    );
  });
  return event ? event.correlationId : '';
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
  return String(event.headerName || '').toLowerCase() === 'order-tracking-id' ? 1 : 0;
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
  const contextByTab = buildBusinessContextByTab(flowState, selectedEvents);
  const globalContext = buildBusinessContext(flowState, selectedEvents);
  const rowsByTrackingId = new Map();

  for (const request of buildNetworkRequests(selectedEvents)) {
    const match = findBestMilestoneMatch(request, normalizedMilestones);
    if (!match) continue;

    const trackingEvent = request.events.find((event) => isHeader(event, 'order-tracking-id'));
    if (!trackingEvent || !trackingEvent.correlationId) continue;

    const correlationEvent = findMilestoneCorrelationEvent(request.events) || trackingEvent;
    const trackingId = trackingEvent.correlationId;
    const context = contextByTab.get(request.tabId) || globalContext;
    const row = ensureFlowRow(rowsByTrackingId, trackingId, context, request.tabId);
    row[match.key] = {
      correlationId: correlationEvent.correlationId,
      headerName: correlationEvent.headerName || '',
      url: request.url || '',
      timestamp: correlationEvent.timestamp || request.timestamp || 0,
    };
    row.lastUpdated = Math.max(row.lastUpdated, correlationEvent.timestamp || request.timestamp || 0);
  }

  if (!rowsByTrackingId.size && hasBusinessContext(globalContext)) {
    ensureFlowRow(rowsByTrackingId, '', globalContext, -1);
  }

  return Array.from(rowsByTrackingId.values()).sort((a, b) => b.lastUpdated - a.lastUpdated);
}

function buildBusinessContextByTab(flowState, events) {
  const tabIds = Array.from(new Set(events.map((event) => event.tabId).filter((tabId) => Number.isFinite(tabId) && tabId >= 0)));
  const contextByTab = new Map();
  for (const tabId of tabIds) {
    contextByTab.set(tabId, buildBusinessContext(flowState, events.filter((event) => event.tabId === tabId)));
  }
  return contextByTab;
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
      customer: context.customer || '',
      address: context.address || '',
      deliveryType: context.deliveryType || '',
      quoteId: context.quoteId || '',
      sourcingOptions: null,
      capacity: null,
      reserveDelivery: null,
      lastUpdated: 0,
    });
  }
  const row = rowsByTrackingId.get(key);
  row.sku ||= context.sku || '';
  row.customer ||= context.customer || '';
  row.address ||= context.address || '';
  row.deliveryType ||= context.deliveryType || '';
  row.quoteId ||= context.quoteId || '';
  return row;
}

function isHeader(event, headerName) {
  return String(event.headerName || '').toLowerCase() === headerName;
}