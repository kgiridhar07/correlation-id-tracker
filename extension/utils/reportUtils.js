/**
 * @fileoverview Clean investigation report generation for captured events.
 */

import { summarizeEvents } from './dataUtils.js';

const LIMITS = Object.freeze({
  TOP_DOMAINS: 5,
  TOP_METHODS: 5,
  TOP_DUPLICATES: 10,
  PAGE_DATA: 10,
  RECENT_EVENTS: 20,
  EMAIL_BODY: 12000,
});

/**
 * Build a clean report from the currently selected events.
 * @param {Array<Object>} events newest-first
 * @param {Object} options
 * @returns {{ subject: string, body: string, truncatedBody: string }}
 */
export function buildInvestigationReport(events, options = {}) {
  const now = options.now || Date.now();
  const selectedEvents = Array.isArray(events) ? events : [];
  const summary = summarizeEvents(selectedEvents, now);
  const generatedAt = new Date(now).toLocaleString('en-US', { hour12: false });
  const primaryDomain = summary.topDomains[0] ? summary.topDomains[0].label : 'captured traffic';
  const subject = `Correlation Tracker Report - ${primaryDomain} - ${new Date(now).toLocaleDateString('en-US')}`;
  const lines = [];

  lines.push('Correlation Tracker Report');
  lines.push('==========================');
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Scope: ${options.scopeLabel || 'Current popup filters'}`);
  lines.push(`Total events: ${formatNumber(summary.totalEvents)}`);
  lines.push(`Unique values: ${formatNumber(summary.uniqueIds)}`);
  lines.push(`Duplicate rate: ${summary.duplicateRate}%`);
  lines.push(`Request headers: ${formatNumber(summary.requestCount)}`);
  lines.push(`Response headers: ${formatNumber(summary.responseCount)}`);
  lines.push(`Page data: ${formatNumber(summary.pageDataCount)}`);
  lines.push('');

  appendLatestSection(lines, selectedEvents);
  appendRankSection(lines, 'Top Domains', summary.topDomains.slice(0, LIMITS.TOP_DOMAINS));
  appendRankSection(lines, 'Top Methods', summary.topMethods.slice(0, LIMITS.TOP_METHODS));
  appendRankSection(lines, 'Most Repeated Values', summary.topDuplicateIds.slice(0, LIMITS.TOP_DUPLICATES));
  appendPageDataSection(lines, selectedEvents);
  appendRecentEvents(lines, selectedEvents);

  lines.push('');
  lines.push('Notes:');
  lines.push('- This report is a summary. Use JSON/CSV export for the full raw event set.');
  lines.push('- Review before sending. The extension opens an email draft and does not send automatically.');

  const body = lines.join('\n');
  return {
    subject,
    body,
    truncatedBody: truncateEmailBody(body),
  };
}

function appendLatestSection(lines, events) {
  lines.push('Latest Captures');
  lines.push('---------------');
  if (!events.length) {
    lines.push('- No events captured.');
    lines.push('');
    return;
  }

  for (const event of events.slice(0, 5)) {
    lines.push(`- ${describeEvent(event)}`);
  }
  lines.push('');
}

function appendRankSection(lines, title, items) {
  lines.push(title);
  lines.push('-'.repeat(title.length));
  if (!items.length) {
    lines.push('- No data.');
  } else {
    for (const item of items) {
      lines.push(`- ${item.label}: ${formatNumber(item.count)}`);
    }
  }
  lines.push('');
}

function appendPageDataSection(lines, events) {
  const seen = new Set();
  const pageItems = [];
  for (const event of events) {
    if (event.sourceType !== 'page-data') continue;
    const key = `${event.fieldLabel || event.fieldPath}|${event.correlationId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pageItems.push(event);
    if (pageItems.length >= LIMITS.PAGE_DATA) break;
  }

  lines.push('Page Data Values');
  lines.push('----------------');
  if (!pageItems.length) {
    lines.push('- No page-data values captured.');
  } else {
    for (const event of pageItems) {
      const label = event.fieldLabel || event.fieldPath || 'Page Data';
      lines.push(`- ${label}: ${event.correlationId}`);
    }
  }
  lines.push('');
}

function appendRecentEvents(lines, events) {
  lines.push(`Recent Event Sample (${Math.min(events.length, LIMITS.RECENT_EVENTS)} of ${formatNumber(events.length)})`);
  lines.push('-------------------');
  if (!events.length) {
    lines.push('- No recent events.');
  } else {
    for (const event of events.slice(0, LIMITS.RECENT_EVENTS)) {
      lines.push(`- ${describeEvent(event)}`);
    }
  }
}

function describeEvent(event) {
  const domain = safeHostname(event.url) || 'unknown-domain';
  const valueLabel = event.fieldLabel ? `${event.fieldLabel}: ` : '';
  return `${formatTime(event.timestamp)} | ${event.method || '-'} | ${domain} | ${event.sourceType || 'unknown'} | ${valueLabel}${event.correlationId}`;
}

function truncateEmailBody(body) {
  if (body.length <= LIMITS.EMAIL_BODY) return body;
  return `${body.slice(0, LIMITS.EMAIL_BODY)}\n\n[Report truncated for email draft size. Use JSON/CSV export for full details.]`;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (_err) {
    return '';
  }
}

function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString('en-US', { hour12: false }) : '-';
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}