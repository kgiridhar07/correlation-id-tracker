import { extractCorrelationIds } from '../background/correlationExtractor.js';
import { normalizeConfig } from '../utils/configManager.js';
import { buildDuplicateCounts, collapseByCorrelationId, csvEscape, enrichDuplicateCounts, summarizeEvents } from '../utils/dataUtils.js';
import { isRelevantUrl } from '../utils/helpers.js';

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
    maxEvents: '250000',
    retentionHours: '900',
  });
  assertDeepEqual(config.urlFilters, ['api']);
  assertDeepEqual(config.correlationHeaders, ['x-trace-id', 'request-id']);
  assertEqual(config.maxEvents, 100000);
  assertEqual(config.retentionHours, 720);
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
  ];
  const summary = summarizeEvents(events, now);
  assertEqual(summary.totalEvents, 3);
  assertEqual(summary.uniqueIds, 2);
  assertEqual(summary.duplicateRate, 33);
  assertEqual(summary.requestCount, 1);
  assertEqual(summary.responseCount, 2);
  assertEqual(summary.topDomains[0].label, 'api.example.com');
  assertEqual(summary.topMethods[0].label, 'GET');
  assertEqual(summary.topDuplicateIds[0].label, 'same');
  assertEqual(summary.recentActivity.reduce((sum, bucket) => sum + bucket.count, 0), 3);
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