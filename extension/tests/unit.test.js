import { extractCorrelationIds, getCaptureHeaderNames } from '../background/correlationExtractor.js';
import { normalizeConfig } from '../utils/configManager.js';
import { buildDuplicateCounts, collapseByCorrelationId, csvEscape, enrichDuplicateCounts } from '../utils/dataUtils.js';
import { isRelevantUrl } from '../utils/helpers.js';
import { buildOrderFlowReport, buildOrderFlowRows, normalizeOrderFlowMilestones } from '../utils/flowUtils.js';
import { normalizePageDataWatchers, parseDataPath, serializePageValue } from '../utils/pageDataUtils.js';
import { clearAllEvents, getAllEvents, queueEvent } from '../background/storageManager.js';

const results = document.getElementById('results');
const summary = document.getElementById('summary');
let passed = 0;
let failed = 0;
const testPromises = [];

test('extracts configured correlation headers case-insensitively', () => {
  const ids = extractCorrelationIds([
    { name: 'Order-Tracking-ID', value: 'order-track-123' },
    { name: 'USOM-CorrelationID', value: 'usom-corr-123' },
    { name: 'content-type', value: 'application/json' },
  ]);
  assertEqual(ids.length, 2);
  assertEqual(ids[0].headerName, 'order-tracking-id');
  assertEqual(ids[0].value, 'order-track-123');
  assertEqual(ids[1].headerName, 'usom-correlationid');
  assertEqual(ids[1].value, 'usom-corr-123');
});

test('always includes order-flow headers for capture', () => {
  assertDeepEqual(getCaptureHeaderNames(), ['order-tracking-id', 'usom-correlationid']);
});

test('starts with empty URL filters until configured', () => {
  assertEqual(isRelevantUrl('https://example.com/api/orders'), false);
  assertEqual(isRelevantUrl('https://example.com/static/logo.png'), false);
});

test('normalizes config and clamps storage limits', () => {
  const config = normalizeConfig({
    urlFilters: ['API', '', 'api'],
    correlationHeaders: 'X-Trace-ID\n\nRequest-ID',
    pageDataWatchers: 'Cart ID | digitalData.cart.cartId',
    orderFlowMilestones: 'Sourcing Options | /v1/source/options\nCapacity | /v1/capacity/check\nReserve Delivery | /v1/delivery/reserve',
    orderAutomationSelectors: 'SKU Search Input | input[name="sku"]; [data-testid="sku-search"] | 1003236000\nCustomer Search Input | input[name="customerSearch"] | Rajesh Kumar M1\nAdd To Cart Button | [data-testid="add-to-cart"] |',
    pageDataPollMs: '50',
    pageDataDurationSeconds: '999',
    reportRecipients: 'SRE-Team@Example.com\nnot-email\nmanager@example.com',
    maxEvents: '250000',
    retentionHours: '900',
  });
  assertDeepEqual(config.urlFilters, ['api']);
  assertDeepEqual(config.correlationHeaders, ['x-trace-id', 'request-id']);
  assertDeepEqual(config.pageDataWatchers, [{ label: 'Cart ID', path: 'digitalData.cart.cartId' }]);
  assertEqual(config.orderFlowMilestones[0].patterns.includes('/v1/source/options'), true);
  assertEqual(config.orderFlowMilestones[1].patterns.includes('/v1/capacity/check'), true);
  assertEqual(config.orderFlowMilestones[2].patterns.includes('/v1/delivery/reserve'), true);
  assertEqual(config.orderFlowMilestones[2].patterns.includes('appointments/reservations'), true);
  assertDeepEqual(config.orderAutomationSelectors.find((item) => item.key === 'skuSearchInput').selectors, ['input[name="sku"]', '[data-testid="sku-search"]']);
  assertEqual(config.orderAutomationSelectors.find((item) => item.key === 'skuSearchInput').defaultValue, '1003236000');
  assertEqual(config.orderAutomationSelectors.find((item) => item.key === 'customerSearchInput').defaultValue, 'Rajesh Kumar M1');
  assertDeepEqual(config.orderAutomationSelectors.find((item) => item.key === 'addToCartButton').selectors, ['[data-testid="add-to-cart"]']);
  assertEqual(config.pageDataPollMs, 250);
  assertEqual(config.pageDataDurationSeconds, 300);
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

test('stitches an order flow report from manual fields and milestones', () => {
  const now = 1000000;
  const events = [
    { correlationId: 'reserve-corr', timestamp: now - 1000, sourceType: 'response-header', method: 'POST', url: 'https://api.example.com/reserveDelivery' },
    { correlationId: 'capacity-corr', timestamp: now - 2000, sourceType: 'response-header', method: 'POST', url: 'https://api.example.com/sourcingOptions?callType=capacity' },
    { correlationId: 'sourcing-corr', timestamp: now - 3000, sourceType: 'response-header', method: 'POST', url: 'https://api.example.com/sourcingOptions' },
    { correlationId: 'H9179-307073', timestamp: now - 4000, sourceType: 'page-data', fieldLabel: 'Quote ID', fieldPath: 'dom:[data-testid="order-number"]', method: 'PAGE', url: 'https://orderup.example.com/quote' },
  ];
  const report = buildOrderFlowReport(events, {
    sku: '123456',
    customer: 'Giridhar',
    address: '123 Main St',
    deliveryType: 'Scheduled Delivery',
    startTime: now - 5000,
    endTime: now,
  }, now);
  assertEqual(report.body.includes('SKU: 123456'), true);
  assertEqual(report.body.includes('Quote ID: H9179-307073'), true);
  assertEqual(report.body.includes('Sourcing Options:'), true);
  assertEqual(report.body.includes('sourcing-corr'), true);
  assertEqual(report.body.includes('capacity-corr'), true);
  assertEqual(report.body.includes('reserve-corr'), true);
});

test('stitches an order flow report with configured milestone paths', () => {
  const now = 1000000;
  const milestones = normalizeOrderFlowMilestones([
    'Sourcing Options | /commerce/source-options',
    'Capacity | /delivery-capacity/check',
    'Reserve Delivery | /appointments/reservations',
  ]);
  const events = [
    { correlationId: 'custom-reserve', timestamp: now - 1000, sourceType: 'response-header', method: 'POST', url: 'https://api.example.com/appointments/reservations' },
    { correlationId: 'custom-capacity', timestamp: now - 2000, sourceType: 'response-header', method: 'POST', url: 'https://api.example.com/delivery-capacity/check' },
    { correlationId: 'custom-sourcing', timestamp: now - 3000, sourceType: 'response-header', method: 'POST', url: 'https://api.example.com/commerce/source-options' },
  ];
  const report = buildOrderFlowReport(events, { startTime: now - 5000, endTime: now }, now, milestones);
  assertEqual(report.body.includes('custom-sourcing'), true);
  assertEqual(report.body.includes('custom-capacity'), true);
  assertEqual(report.body.includes('custom-reserve'), true);
});

test('auto-detects order flow from all captured events without start stop', () => {
  const now = 1000000;
  const milestones = normalizeOrderFlowMilestones([
    'Sourcing Options | sourcingOptions',
    'Capacity | sourcingOptions?callType=capacity',
    'Reserve Delivery | reserveDelivery',
  ]);
  const events = [
    { correlationId: 'auto-capacity', timestamp: now - 1000, sourceType: 'response-header', method: 'GET', url: 'https://api.example.com/sourcingOptions?callType=capacity' },
    { correlationId: 'auto-sourcing', timestamp: now - 2000, sourceType: 'response-header', method: 'GET', url: 'https://api.example.com/sourcingOptions' },
    { correlationId: 'H9179-307080', timestamp: now - 3000, sourceType: 'page-data', fieldLabel: 'Quote ID', fieldPath: 'dom:[data-testid="order-number"]', method: 'PAGE', url: 'https://orderup.example.com/quote' },
  ];
  const report = buildOrderFlowReport(events, {}, now, milestones);
  assertEqual(report.body.includes('Detection scope: All captured events'), true);
  assertEqual(report.body.includes('Quote ID: H9179-307080'), true);
  assertEqual(report.body.includes('auto-sourcing'), true);
  assertEqual(report.body.includes('auto-capacity'), true);
});

test('uses the most specific milestone pattern for overlapping URLs', () => {
  const now = 1000000;
  const milestones = normalizeOrderFlowMilestones([
    'Sourcing Options | sourcingoptions',
    'Capacity | sourcingoptions?calltype=capacity',
    'Reserve Delivery | reserve-delivery',
  ]);
  const events = [
    { correlationId: 'capacity-only', timestamp: now - 1000, sourceType: 'response-header', method: 'GET', url: 'https://api.example.com/sourcingOptions?callType=capacity' },
    { correlationId: 'sourcing-only', timestamp: now - 2000, sourceType: 'response-header', method: 'GET', url: 'https://api.example.com/sourcingOptions' },
  ];
  const report = buildOrderFlowReport(events, { startTime: now - 5000, endTime: now }, now, milestones);
  const sourcingIndex = report.body.indexOf('Sourcing Options:');
  const capacityIndex = report.body.indexOf('Capacity:');
  const reserveIndex = report.body.indexOf('Reserve Delivery:');
  const sourcingSection = report.body.slice(sourcingIndex, capacityIndex);
  const capacitySection = report.body.slice(capacityIndex, reserveIndex);
  assertEqual(sourcingSection.includes('sourcing-only'), true);
  assertEqual(sourcingSection.includes('capacity-only'), false);
  assertEqual(capacitySection.includes('capacity-only'), true);
});

test('prefers usom correlation ID for stitched milestone events', () => {
  const now = 1000000;
  const milestones = normalizeOrderFlowMilestones([
    'Sourcing Options | sourcingOptions',
    'Capacity | sourcingOptions?callType=capacity',
    'Reserve Delivery | reserveDelivery',
  ]);
  const events = [
    { correlationId: 'per-call-correlation', headerName: 'usom-correlationid', timestamp: now - 1000, sourceType: 'request-header', method: 'GET', url: 'https://api.example.com/sourcingOptions' },
    { correlationId: 'shared-order-tracking', headerName: 'order-tracking-id', timestamp: now - 2000, sourceType: 'request-header', method: 'GET', url: 'https://api.example.com/sourcingOptions' },
  ];
  const report = buildOrderFlowReport(events, {}, now, milestones);
  const sourcingIndex = report.body.indexOf('Sourcing Options:');
  const capacityIndex = report.body.indexOf('Capacity:');
  const sourcingSection = report.body.slice(sourcingIndex, capacityIndex);
  assertEqual(sourcingSection.includes('per-call-correlation'), true);
  assertEqual(sourcingSection.includes('Header: usom-correlationid'), true);
  assertEqual(sourcingSection.includes('shared-order-tracking'), false);
});

test('builds one order flow row from page values and network milestones', () => {
  const now = 1000000;
  const milestones = normalizeOrderFlowMilestones([
    'Sourcing Options | sourcingOptions',
    'Capacity | callType=capacity',
    'Reserve Delivery | reserveDelivery',
  ]);
  const events = [
    { requestId: 'r1', correlationId: 'TRACK-1', headerName: 'order-tracking-id', timestamp: now - 1000, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'r1', correlationId: 'SRC-CORR', headerName: 'usom-correlationid', timestamp: now - 999, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'r2', correlationId: 'TRACK-1', headerName: 'order-tracking-id', timestamp: now - 900, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions?callType=capacity' },
    { requestId: 'r2', correlationId: 'CAP-CORR', headerName: 'usom-correlationid', timestamp: now - 899, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions?callType=capacity' },
    { requestId: 'r3', correlationId: 'TRACK-1', headerName: 'order-tracking-id', timestamp: now - 800, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/reserveDelivery' },
    { requestId: 'r3', correlationId: 'RES-CORR', headerName: 'usom-correlationid', timestamp: now - 799, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/reserveDelivery' },
    { correlationId: '1003236000', timestamp: now - 700, sourceType: 'page-data', fieldLabel: 'SKU', fieldPath: 'dom:[data-testid="product-description__sku-number"]', method: 'PAGE', tabId: 7, url: 'https://orderup.example.com/product' },
    { correlationId: '1003236001', timestamp: now - 695, sourceType: 'page-data', fieldLabel: 'SKU', fieldPath: 'dom:[data-testid="product-description__sku-number"]', method: 'PAGE', tabId: 7, url: 'https://orderup.example.com/product' },
    { correlationId: 'Rajesh Kumar M1', timestamp: now - 690, sourceType: 'page-data', fieldLabel: 'Customer', fieldPath: 'dom:.customer-card__name .pal--type-style-05', method: 'PAGE', tabId: 7, url: 'https://orderup.example.com/customer' },
    { correlationId: 'H9179-307080', timestamp: now - 680, sourceType: 'page-data', fieldLabel: 'Quote ID', fieldPath: 'dom:[data-testid="order-number"]', method: 'PAGE', tabId: 7, url: 'https://orderup.example.com/quote' },
  ];
  const rows = buildOrderFlowRows(events, {}, milestones);
  assertEqual(rows.length, 1);
  assertEqual(rows[0].orderTrackingId, 'TRACK-1');
  assertEqual(rows[0].sku, '1003236000, 1003236001');
  assertDeepEqual(rows[0].skus, ['1003236000', '1003236001']);
  assertEqual(rows[0].customer, 'Rajesh Kumar M1');
  assertEqual(rows[0].quoteId, 'H9179-307080');
  assertEqual(rows[0].lastUpdated, now - 680);
  assertEqual(rows[0].sourcingOptions.correlationId, 'SRC-CORR');
  assertEqual(rows[0].capacity.correlationId, 'CAP-CORR');
  assertEqual(rows[0].reserveDelivery.correlationId, 'RES-CORR');
});

test('matches reserve delivery URL variants for order flow rows', () => {
  const now = 1000000;
  const events = [
    { requestId: 'reserve-variant', correlationId: 'TRACK-1', headerName: 'order-tracking-id', timestamp: now - 200, sourceType: 'request-header', method: 'POST', tabId: 7, url: 'https://api.example.com/appointments/reservations' },
    { requestId: 'reserve-variant', correlationId: 'RES-CORR', headerName: 'usom-correlationid', timestamp: now - 199, sourceType: 'request-header', method: 'POST', tabId: 7, url: 'https://api.example.com/appointments/reservations' },
  ];
  const rows = buildOrderFlowRows(events, {}, normalizeOrderFlowMilestones([
    'Sourcing Options | sourcingOptions',
    'Capacity | callType=capacity',
    'Reserve Delivery | reserveDelivery',
  ]));
  assertEqual(rows.length, 1);
  assertEqual(rows[0].reserveDelivery.correlationId, 'RES-CORR');
});

test('attaches untracked reserve correlation to a two SKU order row', () => {
  const now = 1000000;
  const milestones = normalizeOrderFlowMilestones([
    'Sourcing Options | sourcingOptions',
    'Capacity | callType=capacity',
    'Reserve Delivery | reserveDelivery',
  ]);
  const events = [
    { requestId: 'src-1', correlationId: 'TRACK-1', headerName: 'order-tracking-id', timestamp: now - 1000, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'src-1', correlationId: 'SRC-CORR', headerName: 'usom-correlationid', timestamp: now - 999, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'cap-1', correlationId: 'TRACK-1', headerName: 'order-tracking-id', timestamp: now - 900, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions?callType=capacity' },
    { requestId: 'cap-1', correlationId: 'CAP-CORR', headerName: 'usom-correlationid', timestamp: now - 899, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions?callType=capacity' },
    { requestId: 'reserve-cart', correlationId: 'RES-CORR', headerName: 'usom-correlationid', timestamp: now - 800, sourceType: 'request-header', method: 'POST', tabId: 7, url: 'https://api.example.com/reserveDelivery' },
    { correlationId: 'SKU-1', timestamp: now - 700, sourceType: 'page-data', fieldLabel: 'SKU', fieldPath: 'dom:[data-testid="product-description__sku-number"]', method: 'PAGE', tabId: 7, url: 'https://orderup.example.com/product' },
    { correlationId: 'SKU-2', timestamp: now - 695, sourceType: 'page-data', fieldLabel: 'SKU', fieldPath: 'dom:[data-testid="product-description__sku-number"]', method: 'PAGE', tabId: 7, url: 'https://orderup.example.com/product' },
    { correlationId: 'QUOTE-1', timestamp: now - 680, sourceType: 'page-data', fieldLabel: 'Quote ID', fieldPath: 'dom:[data-testid="order-number"]', method: 'PAGE', tabId: 7, url: 'https://orderup.example.com/quote' },
  ];

  const rows = buildOrderFlowRows(events, {}, milestones);
  assertEqual(rows.length, 1);
  assertEqual(rows[0].sku, 'SKU-1, SKU-2');
  assertEqual(rows[0].sourcingOptions.correlationId, 'SRC-CORR');
  assertEqual(rows[0].capacity.correlationId, 'CAP-CORR');
  assertEqual(rows[0].reserveDelivery.correlationId, 'RES-CORR');
});

test('keeps previous order flow rows when another flow is captured', () => {
  const milestones = normalizeOrderFlowMilestones([
    'Sourcing Options | sourcingOptions',
    'Capacity | callType=capacity',
    'Reserve Delivery | reserveDelivery',
  ]);
  const events = [
    { requestId: 'a1', correlationId: 'TRACK-1', headerName: 'order-tracking-id', timestamp: 1000, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'a1', correlationId: 'SRC-1', headerName: 'usom-correlationid', timestamp: 1001, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'a2', correlationId: 'TRACK-1', headerName: 'order-tracking-id', timestamp: 1100, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions?callType=capacity' },
    { requestId: 'a2', correlationId: 'CAP-1', headerName: 'usom-correlationid', timestamp: 1101, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions?callType=capacity' },
    { correlationId: 'SKU-1', timestamp: 1200, sourceType: 'page-data', fieldLabel: 'SKU', fieldPath: 'dom:[data-testid="product-description__sku-number"]', method: 'PAGE', tabId: 7, url: 'https://orderup.example.com/product/1' },
    { correlationId: 'QUOTE-1', timestamp: 1210, sourceType: 'page-data', fieldLabel: 'Quote ID', fieldPath: 'dom:[data-testid="order-number"]', method: 'PAGE', tabId: 7, url: 'https://orderup.example.com/quote/1' },
    { requestId: 'b1', correlationId: 'TRACK-2', headerName: 'order-tracking-id', timestamp: 2000, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'b1', correlationId: 'SRC-2', headerName: 'usom-correlationid', timestamp: 2001, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'b2', correlationId: 'TRACK-2', headerName: 'order-tracking-id', timestamp: 2100, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/reserveDelivery' },
    { requestId: 'b2', correlationId: 'RES-2', headerName: 'usom-correlationid', timestamp: 2101, sourceType: 'request-header', method: 'GET', tabId: 7, url: 'https://api.example.com/reserveDelivery' },
    { correlationId: 'SKU-2', timestamp: 2200, sourceType: 'page-data', fieldLabel: 'SKU', fieldPath: 'dom:[data-testid="product-description__sku-number"]', method: 'PAGE', tabId: 7, url: 'https://orderup.example.com/product/2' },
    { correlationId: 'QUOTE-2', timestamp: 2210, sourceType: 'page-data', fieldLabel: 'Quote ID', fieldPath: 'dom:[data-testid="order-number"]', method: 'PAGE', tabId: 7, url: 'https://orderup.example.com/quote/2' },
  ];
  const rows = buildOrderFlowRows(events, {}, milestones);
  assertEqual(rows.length, 2);
  assertEqual(rows[0].orderTrackingId, 'TRACK-2');
  assertEqual(rows[0].sku, 'SKU-2');
  assertEqual(rows[0].quoteId, 'QUOTE-2');
  assertEqual(rows[0].sourcingOptions.correlationId, 'SRC-2');
  assertEqual(rows[0].reserveDelivery.correlationId, 'RES-2');
  assertEqual(rows[1].orderTrackingId, 'TRACK-1');
  assertEqual(rows[1].sku, 'SKU-1');
  assertEqual(rows[1].quoteId, 'QUOTE-1');
  assertEqual(rows[1].sourcingOptions.correlationId, 'SRC-1');
  assertEqual(rows[1].capacity.correlationId, 'CAP-1');
});

test('persists captured order flow events without dropping previous rows', async () => {
  await clearAllEvents();
  const milestones = normalizeOrderFlowMilestones([
    'Sourcing Options | sourcingOptions',
    'Capacity | callType=capacity',
    'Reserve Delivery | reserveDelivery',
  ]);
  const events = [
    { requestId: 'stored-a1', correlationId: 'TRACK-STORED-1', headerName: 'order-tracking-id', timestamp: 10000, sourceType: 'request-header', method: 'GET', tabId: 12, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'stored-a1', correlationId: 'SRC-STORED-1', headerName: 'usom-correlationid', timestamp: 10001, sourceType: 'request-header', method: 'GET', tabId: 12, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'stored-a2', correlationId: 'TRACK-STORED-1', headerName: 'order-tracking-id', timestamp: 10100, sourceType: 'request-header', method: 'GET', tabId: 12, url: 'https://api.example.com/sourcingOptions?callType=capacity' },
    { requestId: 'stored-a2', correlationId: 'CAP-STORED-1', headerName: 'usom-correlationid', timestamp: 10101, sourceType: 'request-header', method: 'GET', tabId: 12, url: 'https://api.example.com/sourcingOptions?callType=capacity' },
    { requestId: 'stored-page-a1', correlationId: 'SKU-STORED-1', timestamp: 10200, sourceType: 'page-data', fieldLabel: 'SKU', fieldPath: 'dom:[data-testid="product-description__sku-number"]', method: 'PAGE', tabId: 12, url: 'https://orderup.example.com/product/1' },
    { requestId: 'stored-page-a2', correlationId: 'QUOTE-STORED-1', timestamp: 10210, sourceType: 'page-data', fieldLabel: 'Quote ID', fieldPath: 'dom:[data-testid="order-number"]', method: 'PAGE', tabId: 12, url: 'https://orderup.example.com/quote/1' },
    { requestId: 'stored-b1', correlationId: 'TRACK-STORED-2', headerName: 'order-tracking-id', timestamp: 20000, sourceType: 'request-header', method: 'GET', tabId: 12, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'stored-b1', correlationId: 'SRC-STORED-2', headerName: 'usom-correlationid', timestamp: 20001, sourceType: 'request-header', method: 'GET', tabId: 12, url: 'https://api.example.com/sourcingOptions' },
    { requestId: 'stored-b2', correlationId: 'TRACK-STORED-2', headerName: 'order-tracking-id', timestamp: 20100, sourceType: 'request-header', method: 'GET', tabId: 12, url: 'https://api.example.com/reserveDelivery' },
    { requestId: 'stored-b2', correlationId: 'RES-STORED-2', headerName: 'usom-correlationid', timestamp: 20101, sourceType: 'request-header', method: 'GET', tabId: 12, url: 'https://api.example.com/reserveDelivery' },
    { requestId: 'stored-page-b1', correlationId: 'SKU-STORED-2', timestamp: 20200, sourceType: 'page-data', fieldLabel: 'SKU', fieldPath: 'dom:[data-testid="product-description__sku-number"]', method: 'PAGE', tabId: 12, url: 'https://orderup.example.com/product/2' },
    { requestId: 'stored-page-b2', correlationId: 'QUOTE-STORED-2', timestamp: 20210, sourceType: 'page-data', fieldLabel: 'Quote ID', fieldPath: 'dom:[data-testid="order-number"]', method: 'PAGE', tabId: 12, url: 'https://orderup.example.com/quote/2' },
  ];

  for (const event of events) {
    await queueEvent(event);
  }

  const storedEvents = await getAllEvents();
  const rows = buildOrderFlowRows(storedEvents, {}, milestones);
  assertEqual(storedEvents.length, events.length);
  assertEqual(rows.length, 2);
  assertEqual(rows[0].orderTrackingId, 'TRACK-STORED-2');
  assertEqual(rows[0].sku, 'SKU-STORED-2');
  assertEqual(rows[0].quoteId, 'QUOTE-STORED-2');
  assertEqual(rows[0].sourcingOptions.correlationId, 'SRC-STORED-2');
  assertEqual(rows[0].reserveDelivery.correlationId, 'RES-STORED-2');
  assertEqual(rows[1].orderTrackingId, 'TRACK-STORED-1');
  assertEqual(rows[1].sku, 'SKU-STORED-1');
  assertEqual(rows[1].quoteId, 'QUOTE-STORED-1');
  assertEqual(rows[1].sourcingOptions.correlationId, 'SRC-STORED-1');
  assertEqual(rows[1].capacity.correlationId, 'CAP-STORED-1');
});

test('fills order flow business context from captured page data', () => {
  const now = 1000000;
  const events = [
    { correlationId: '1003236000', timestamp: now - 1000, sourceType: 'page-data', fieldLabel: 'SKU', fieldPath: 'dom:[data-testid="product-description__sku-number"]', method: 'PAGE', url: 'https://orderup.example.com/product' },
    { correlationId: 'Rajesh Kumar M1', timestamp: now - 2000, sourceType: 'page-data', fieldLabel: 'Customer', fieldPath: 'dom:.customer-card__name .pal--type-style-05', method: 'PAGE', url: 'https://orderup.example.com/customer' },
    { correlationId: '2422 Cumberland SE unit 555 Atlanta, GA 30339 (475) 239-8111', timestamp: now - 3000, sourceType: 'page-data', fieldLabel: 'Address', fieldPath: 'dom:[data-testid="fulfillment-steps"]|label:delivery address|value:.description', method: 'PAGE', url: 'https://orderup.example.com/fulfillment' },
    { correlationId: 'Threshold Flat 1 Pallets', timestamp: now - 4000, sourceType: 'page-data', fieldLabel: 'Delivery Type', fieldPath: 'dom:[data-testid="fulfillment-steps"]|label:delivery options|value:.description', method: 'PAGE', url: 'https://orderup.example.com/fulfillment' },
  ];
  const report = buildOrderFlowReport(events, { startTime: now - 5000, endTime: now }, now);
  assertEqual(report.body.includes('SKU: 1003236000'), true);
  assertEqual(report.body.includes('Customer: Rajesh Kumar M1'), true);
  assertEqual(report.body.includes('Address: 2422 Cumberland SE unit 555 Atlanta, GA 30339 (475) 239-8111'), true);
  assertEqual(report.body.includes('Delivery Type: Threshold Flat 1 Pallets'), true);
});

function test(name, fn) {
  const promise = Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      appendResult(name, true);
    })
    .catch((err) => {
      failed++;
      appendResult(`${name}: ${err.message}`, false);
    })
    .finally(updateSummary);
  testPromises.push(promise);
}

Promise.allSettled(testPromises).then(() => {
  updateSummary();
  document.body.dataset.testsDone = 'true';
  window.__correlationTrackerTests = { passed, failed };
});

function updateSummary() {
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