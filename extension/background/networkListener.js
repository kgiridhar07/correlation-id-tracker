/**
 * @fileoverview Network listener — hooks into webRequest to intercept
 * relevant OrderUp/USOM traffic and extract correlation IDs from headers.
 *
 * Architecture:
 *  - onBeforeSendHeaders: captures request headers, stores partial event in pendingMap.
 *  - onHeadersReceived: captures response headers, merges with pending entry or creates new event.
 *  - pendingMap uses a bounded Map (ring-buffer eviction) to avoid memory leaks.
 */

import { SOURCE_TYPES, RING_BUFFER } from '../utils/constants.js';
import { getExtensionApi } from '../utils/browserApi.js';
import { getConfig } from '../utils/configManager.js';
import { extractCorrelationIds } from './correlationExtractor.js';
import { queueEvent } from './storageManager.js';
import { broadcastNewEvent } from './messageBus.js';
import { incrementBadge } from './badgeManager.js';
import * as log from '../utils/logger.js';

/**
 * Pending request map — keyed by browser requestId.
 * Stores partial metadata from onBeforeSendHeaders until the response arrives.
 * Bounded to RING_BUFFER.MAX_PENDING entries; oldest entries evicted when full.
 * @type {Map<string, Object>}
 */
const pendingMap = new Map();

/**
 * Evict the oldest entry from pendingMap when it exceeds the limit.
 */
function evictOldestPending() {
  if (pendingMap.size <= RING_BUFFER.MAX_PENDING) return;
  // Map iteration order is insertion order — first key is oldest
  const oldestKey = pendingMap.keys().next().value;
  pendingMap.delete(oldestKey);
}

/**
 * Build and persist a CorrelationEvent, broadcast to popup.
 * @param {Object} params
 */
async function emitEvent({ requestId, url, method, correlationId, sourceType, tabId, headerName }) {
  const event = {
    requestId,
    timestamp: Date.now(),
    url: url || '',
    method: method || '',
    correlationId,
    sourceType,
    headerName: headerName || '',
    tabId: tabId ?? -1,
  };

  try {
    await queueEvent(event);
    incrementBadge();
    broadcastNewEvent(event);
    log.debug('Emitted event', event.correlationId, event.sourceType);
  } catch (err) {
    log.error('Failed to persist emitted event', err);
  }
}

/**
 * Handler for webRequest.onBeforeSendHeaders.
 * @param {Object} details
 */
function onBeforeSendHeaders(details) {
  if (!shouldCaptureOrderFlowRequest(details.url)) return;

  const ids = extractCorrelationIds(details.requestHeaders);

  // Store partial metadata for response-phase correlation
  pendingMap.set(details.requestId, {
    url: details.url,
    method: details.method,
    tabId: details.tabId,
  });
  evictOldestPending();

  // Emit an event for each correlation ID found in request headers
  for (const { headerName, value } of ids) {
    void emitEvent({
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      correlationId: value,
      sourceType: SOURCE_TYPES.REQUEST_HEADER,
      headerName,
      tabId: details.tabId,
    });
  }
}

/**
 * Handler for webRequest.onHeadersReceived.
 * @param {Object} details
 */
function onHeadersReceived(details) {
  if (!shouldCaptureOrderFlowRequest(details.url)) return;

  const ids = extractCorrelationIds(details.responseHeaders);

  // Retrieve and clean up pending metadata
  const pending = pendingMap.get(details.requestId);
  pendingMap.delete(details.requestId);

  const url = details.url || (pending && pending.url) || '';
  const method = details.method || (pending && pending.method) || '';
  const tabId = details.tabId ?? (pending && pending.tabId) ?? -1;

  for (const { headerName, value } of ids) {
    void emitEvent({
      requestId: details.requestId,
      url,
      method,
      correlationId: value,
      sourceType: SOURCE_TYPES.RESPONSE_HEADER,
      headerName,
      tabId,
    });
  }
}

/**
 * Register the webRequest listeners.
 * Called once during background service worker initialisation.
 */
export function startNetworkListener() {
  const webRequest = getExtensionApi().webRequest;

  addWebRequestListener(
    webRequest.onBeforeSendHeaders,
    onBeforeSendHeaders,
    { urls: ['<all_urls>'] },
    ['requestHeaders', 'extraHeaders']
  );

  addWebRequestListener(
    webRequest.onHeadersReceived,
    onHeadersReceived,
    { urls: ['<all_urls>'] },
    ['responseHeaders', 'extraHeaders']
  );

  log.info('Network listeners registered');
}

/**
 * Deregister listeners (useful for testing / shutdown).
 */
export function stopNetworkListener() {
  const webRequest = getExtensionApi().webRequest;
  webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
  webRequest.onHeadersReceived.removeListener(onHeadersReceived);
  pendingMap.clear();
  log.info('Network listeners removed');
}

function addWebRequestListener(event, listener, filter, extraInfoSpec) {
  try {
    event.addListener(listener, filter, extraInfoSpec);
  } catch (err) {
    const fallbackSpec = extraInfoSpec.filter((item) => item !== 'extraHeaders');
    event.addListener(listener, filter, fallbackSpec);
    log.warn('Registered webRequest listener without extraHeaders fallback', err);
  }
}

function shouldCaptureOrderFlowRequest(url) {
  return isOrderFlowMilestoneUrl(url);
}

function isOrderFlowMilestoneUrl(url) {
  const lowerUrl = String(url || '').toLowerCase();
  if (!lowerUrl) return false;
  return getConfig().orderFlowMilestones.some((milestone) => {
    return milestone.patterns.some((pattern) => lowerUrl.includes(String(pattern).toLowerCase()));
  });
}
