/**
 * @fileoverview Message bus for background ↔ popup communication.
 * Centralises all chrome.runtime message handling in the background service worker.
 */

import { MSG } from '../utils/constants.js';
import { getEvents, getAllEvents, clearAllEvents } from './storageManager.js';
import * as log from '../utils/logger.js';

/**
 * Initialise the message listener.
 * Each message must have a `type` field matching a MSG constant.
 */
export function initMessageBus() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    switch (message.type) {
      case MSG.GET_EVENTS:
        handleGetEvents(message, sendResponse);
        return true; // keep channel open for async response

      case MSG.CLEAR_EVENTS:
        handleClearEvents(sendResponse);
        return true;

      case MSG.EXPORT_EVENTS:
        handleExportEvents(sendResponse);
        return true;

      default:
        return false;
    }
  });

  log.info('Message bus initialised');
}

/**
 * Handle GET_EVENTS — return recent events to popup.
 * @param {Object} message
 * @param {Function} sendResponse
 */
async function handleGetEvents(message, sendResponse) {
  try {
    const limit = message.limit || 200;
    const events = await getEvents(limit);
    sendResponse({ success: true, data: events });
  } catch (err) {
    log.error('GET_EVENTS failed', err);
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Handle CLEAR_EVENTS — wipe all stored events.
 * @param {Function} sendResponse
 */
async function handleClearEvents(sendResponse) {
  try {
    await clearAllEvents();
    // Broadcast to any open popup so it can refresh
    chrome.runtime.sendMessage({ type: MSG.EVENTS_CLEARED }).catch(() => {});
    sendResponse({ success: true });
  } catch (err) {
    log.error('CLEAR_EVENTS failed', err);
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Handle EXPORT_EVENTS — return all events for export.
 * @param {Function} sendResponse
 */
async function handleExportEvents(sendResponse) {
  try {
    const events = await getAllEvents();
    sendResponse({ success: true, data: events });
  } catch (err) {
    log.error('EXPORT_EVENTS failed', err);
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Broadcast a new event notification to the popup (if open).
 * @param {Object} event — CorrelationEvent
 */
export function broadcastNewEvent(event) {
  chrome.runtime.sendMessage({ type: MSG.NEW_EVENT, data: event }).catch(() => {
    // popup not open — safe to ignore
  });
}
