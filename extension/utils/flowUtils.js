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
  const normalizedMilestones = normalizeOrderFlowMilestones(milestones);
  const milestoneMatches = normalizedMilestones.map((milestone) => ({
    ...milestone,
    events: findMilestoneEvents(selectedEvents, milestone.patterns),
  }));
  const subjectParts = ['Order Flow Report'];
  if (flowState.sku) subjectParts.push(`SKU ${flowState.sku}`);
  if (quoteId) subjectParts.push(`Quote ${quoteId}`);

  const lines = [];
  lines.push('Order Flow Report');
  lines.push('=================');
  lines.push(`Generated: ${formatTime(now)}`);
  lines.push(`Capture window: ${formatWindow(flowState, now)}`);
  lines.push('');
  lines.push('Business Context');
  lines.push('----------------');
  lines.push(`SKU: ${flowState.sku || '-'}`);
  lines.push(`Customer: ${flowState.customer || '-'}`);
  lines.push(`Address: ${flowState.address || '-'}`);
  lines.push(`Delivery Type: ${flowState.deliveryType || '-'}`);
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
    for (const event of milestone.events.slice(0, 3)) {
      lines.push(`  - ${event.correlationId}`);
      lines.push(`    Time: ${formatTime(event.timestamp)}`);
      lines.push(`    Source: ${event.sourceType || '-'}`);
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
  const quoteEvent = events.find((event) => {
    const label = String(event.fieldLabel || '').toLowerCase();
    const path = String(event.fieldPath || '').toLowerCase();
    return event.sourceType === 'page-data' && (label.includes('quote') || path.includes('order-number'));
  });
  return quoteEvent ? quoteEvent.correlationId : '';
}

function findMilestoneEvents(events, patterns) {
  const seen = new Set();
  const matches = [];
  for (const event of events) {
    const url = String(event.url || '').toLowerCase();
    if (!patterns.some((pattern) => url.includes(pattern))) continue;
    if (event.sourceType === 'page-data') continue;
    const key = `${event.correlationId}|${event.sourceType}|${event.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(event);
  }
  return matches;
}

function formatWindow(flowState, now) {
  const startTime = Number(flowState.startTime) || null;
  const endTime = Number(flowState.endTime) || now;
  if (!startTime) return 'Not started';
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