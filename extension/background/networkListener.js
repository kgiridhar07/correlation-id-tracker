/**
 * @fileoverview Network listener — hooks into chrome.webRequest to intercept
 * relevant OrderUp/USOM traffic and extract correlation IDs from headers.
 *
 * Architecture:
 *  - onBeforeSendHeaders: captures request headers, stores partial event in pendingMap.
 *  - onHeadersReceived: captures response headers, merges with pending entry or creates new event.
 *  - pendingMap uses a bounded Map (ring-buffer eviction) to avoid memory leaks.
 */

import { SOURCE_TYPES, RING_BUFFER } from '../utils/constants.js';
import { isRelevantUrl } from '../utils/helpers.js';
import { extractCorrelationIds } from './correlationExtractor.js';
import { queueEvent } from './storageManager.js';
import { broadcastNewEvent } from './messageBus.js';
import * as log from '../utils/logger.js';

/**
 * Pending request map — keyed by chrome requestId.
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
function emitEvent({ requestId, url, method, correlationId, sourceType, tabId }) {
  const event = {
    requestId,
    timestamp: Date.now(),
    url: url || '',
    method: method || '',
    correlationId,
    sourceType,
    tabId: tabId ?? -1,
  };

  queueEvent(event);
  broadcastNewEvent(event);
  log.debug('Emitted event', event.correlationId, event.sourceType);
}

/**
 * Handler for chrome.webRequest.onBeforeSendHeaders.
 * @param {Object} details
 */
function onBeforeSendHeaders(details) {
  if (!isRelevantUrl(details.url)) return;

  const ids = extractCorrelationIds(details.requestHeaders);

  // Store partial metadata for response-phase correlation
  pendingMap.set(details.requestId, {
    url: details.url,
    method: details.method,
    tabId: details.tabId,
  });
  evictOldestPending();

  // Emit an event for each correlation ID found in request headers
  for (const { value } of ids) {
    emitEvent({
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      correlationId: value,
      sourceType: SOURCE_TYPES.REQUEST_HEADER,
      tabId: details.tabId,
    });
  }
}

/**
 * Handler for chrome.webRequest.onHeadersReceived.
 * @param {Object} details
 */
function onHeadersReceived(details) {
  if (!isRelevantUrl(details.url)) return;

  const ids = extractCorrelationIds(details.responseHeaders);

  // Retrieve and clean up pending metadata
  const pending = pendingMap.get(details.requestId);
  pendingMap.delete(details.requestId);

  const url = details.url || (pending && pending.url) || '';
  const method = details.method || (pending && pending.method) || '';
  const tabId = details.tabId ?? (pending && pending.tabId) ?? -1;

  for (const { value } of ids) {
    emitEvent({
      requestId: details.requestId,
      url,
      method,
      correlationId: value,
      sourceType: SOURCE_TYPES.RESPONSE_HEADER,
      tabId,
    });
  }
}

/**
 * Register the webRequest listeners.
 * Called once during background service worker initialisation.
 */
export function startNetworkListener() {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    onBeforeSendHeaders,
    { urls: ['<all_urls>'] },
    ['requestHeaders', 'extraHeaders']
  );

  chrome.webRequest.onHeadersReceived.addListener(
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
  chrome.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
  chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
  pendingMap.clear();
  log.info('Network listeners removed');
}
