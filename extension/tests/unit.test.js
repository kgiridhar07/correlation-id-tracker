import { extractCorrelationIds } from '../background/correlationExtractor.js';
import { normalizeConfig } from '../utils/configManager.js';
import { buildDuplicateCounts, collapseByCorrelationId, csvEscape, enrichDuplicateCounts, summarizeEvents } from '../utils/dataUtils.js';
import { isRelevantUrl } from '../utils/helpers.js';
import { normalizePageDataWatchers, parseDataPath, serializePageValue } from '../utils/pageDataUtils.js';
import { buildInvestigationReport } from '../utils/reportUtils.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
let passed = 0;
let failed = 0;

test('extracts configured correlation headers case-insensitively', () => {
  const ids = extractCorrelationIds([
    { name: 'X-Correlation-ID', value: 'abc-123' },
    { name: 'content-type', value: 'application/json' },
  ]);
  assertEqual(ids.length, 1);
  assertEqual(ids[0].value, 'abc-123');
});

test('matches default URL filters', () => {
  assertEqual(isRelevantUrl('https://example.com/api/orders'), true);
  assertEqual(isRelevantUrl('https://example.com/static/logo.png'), false);
});

test('normalizes config and clamps storage limits', () => {
  const config = normalizeConfig({
    urlFilters: ['API', '', 'api'],
    correlationHeaders: 'X-Trace-ID\n\nRequest-ID',
    pageDataWatchers: 'Cart ID | digitalData.cart.cartId',
    pageDataPollMs: '50',
    pageDataDurationSeconds: '999',
    reportRecipients: 'SRE-Team@Example.com\nnot-email\nmanager@example.com',
    maxEvents: '250000',
    retentionHours: '900',
  });
  assertDeepEqual(config.urlFilters, ['api']);
  assertDeepEqual(config.correlationHeaders, ['x-trace-id', 'request-id']);
  assertDeepEqual(config.pageDataWatchers, [{ label: 'Cart ID', path: 'digitalData.cart.cartId' }]);
  assertEqual(config.pageDataPollMs, 250);
  assertEqual(config.pageDataDurationSeconds, 120);
  assertDeepEqual(config.reportRecipients, ['sre-team@example.com', 'manager@example.com']);
  assertEqual(config.maxEvents, 100000);
  assertEqual(config.retentionHours, 720);
});

test('parses configurable page data watcher paths', () => {
  const watchers = normalizePageDataWatchers([
    'Cart ID | digitalData.cart.cartId',
    'Event | dataLayer[0].event',
    'Bad | dataLayer[]',
  ]);
  assertEqual(watchers.length, 2);
  assertDeepEqual(parseDataPath('dataLayer[0].event'), ['dataLayer', '0', 'event']);
  assertEqual(serializePageValue({ id: 'cart-123' }).value, '{"id":"cart-123"}');
});

test('counts and enriches duplicate IDs', () => {
  const events = [
    { correlationId: 'same', timestamp: 3 },
    { correlationId: 'same', timestamp: 2 },
    { correlationId: 'other', timestamp: 1 },
  ];
  const counts = buildDuplicateCounts(events);
  const enriched = enrichDuplicateCounts(events);
  assertEqual(counts.get('same'), 2);
  assertEqual(enriched[0].duplicateCount, 2);
  assertEqual(enriched[2].duplicateCount, 1);
});

test('collapses duplicate IDs to newest visible row', () => {
  const events = [
    { correlationId: 'same', timestamp: 3 },
    { correlationId: 'same', timestamp: 2 },
    { correlationId: 'other', timestamp: 1 },
  ];
  const collapsed = collapseByCorrelationId(events);
  assertEqual(collapsed.length, 2);
  assertEqual(collapsed[0].timestamp, 3);
});

test('escapes CSV values containing quotes and commas', () => {
  assertEqual(csvEscape('https://example.com/a,"b"'), '"https://example.com/a,""b"""');
});

test('summarizes dashboard metrics and top lists', () => {
  const now = 1000000;
  const events = [
    { correlationId: 'same', timestamp: now - 60000, sourceType: 'request-header', method: 'GET', url: 'https://api.example.com/orders' },
    { correlationId: 'same', timestamp: now - 120000, sourceType: 'response-header', method: 'GET', url: 'https://api.example.com/orders' },
    { correlationId: 'other', timestamp: now - 3000000, sourceType: 'response-header', method: 'POST', url: 'https://shop.example.com/api' },
    { correlationId: 'cart-123', timestamp: now - 180000, sourceType: 'page-data', method: 'PAGE', url: 'https://shop.example.com/cart' },
  ];
  const summary = summarizeEvents(events, now);
  assertEqual(summary.totalEvents, 4);
  assertEqual(summary.uniqueIds, 3);
  assertEqual(summary.duplicateRate, 25);
  assertEqual(summary.requestCount, 1);
  assertEqual(summary.responseCount, 2);
  assertEqual(summary.pageDataCount, 1);
  assertEqual(summary.topDomains[0].label, 'api.example.com');
  assertEqual(summary.topMethods[0].label, 'GET');
  assertEqual(summary.topDuplicateIds[0].label, 'same');
  assertEqual(summary.recentActivity.reduce((sum, bucket) => sum + bucket.count, 0), 4);
});

test('builds a bounded investigation report', () => {
  const now = 1000000;
  const events = [
    { correlationId: 'cart-123', timestamp: now - 60000, sourceType: 'page-data', fieldLabel: 'Cart ID', fieldPath: 'digitalData.cart.cartId', method: 'PAGE', url: 'https://shop.example.com/cart' },
    { correlationId: 'same', timestamp: now - 120000, sourceType: 'response-header', method: 'GET', url: 'https://api.example.com/orders' },
    { correlationId: 'same', timestamp: now - 180000, sourceType: 'request-header', method: 'GET', url: 'https://api.example.com/orders' },
  ];
  const report = buildInvestigationReport(events, { now, scopeLabel: 'Last 15 minutes' });
  assertEqual(report.subject.includes('api.example.com') || report.subject.includes('shop.example.com'), true);
  assertEqual(report.body.includes('Correlation Tracker Report'), true);
  assertEqual(report.body.includes('Cart ID: cart-123'), true);
  assertEqual(report.body.includes('Recent Event Sample (3 of 3)'), true);
  assertEqual(report.truncatedBody.length <= report.body.length, true);
});

function test(name, fn) {
  try {
    fn();
    passed++;
    appendResult(name, true);
  } catch (err) {
    failed++;
    appendResult(`${name}: ${err.message}`, false);
  }
  summary.textContent = `${passed} passed, ${failed} failed`;
}

function appendResult(text, ok) {
  const item = document.createElement('li');
  item.className = ok ? 'pass' : 'fail';
  item.textContent = `${ok ? 'PASS' : 'FAIL'} - ${text}`;
  results.appendChild(item);
}

function assertEqual(actual, expected) {
  if (actual !== expected) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`expected ${expectedJson}, got ${actualJson}`);
  }
}