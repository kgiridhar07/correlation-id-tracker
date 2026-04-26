/**
 * @fileoverview Message bus for background ↔ popup communication.
 * Centralises all runtime message handling in the background service worker.
 */

import { MSG } from '../utils/constants.js';
import { addRuntimeMessageListener, sendRuntimeMessage } from '../utils/browserApi.js';
import { loadConfig, saveConfig } from '../utils/configManager.js';
import { getEvents, getAllEvents, getStats, clearAllEvents, trimToMaxEvents } from './storageManager.js';
import { clearBadge } from './badgeManager.js';
import * as log from '../utils/logger.js';

/**
 * Initialise the message listener.
 * Each message must have a `type` field matching a MSG constant.
 */
export function initMessageBus() {
  addRuntimeMessageListener(handleMessage);
  log.info('Message bus initialised');
}

async function handleMessage(message) {
  if (!message || !message.type) return undefined;

  switch (message.type) {
    case MSG.GET_EVENTS:
      return handleGetEvents(message);

    case MSG.CLEAR_EVENTS:
      return handleClearEvents();

    case MSG.EXPORT_EVENTS:
      return handleExportEvents();

    case MSG.GET_CONFIG:
      return handleGetConfig();

    case MSG.SAVE_CONFIG:
      return handleSaveConfig(message);

    case MSG.GET_STATS:
      return handleGetStats();

    default:
      return undefined;
  }
}

/**
 * Handle GET_EVENTS — return recent events to popup.
 * @param {Object} message
 */
async function handleGetEvents(message) {
  try {
    const limit = message.limit || 200;
    const events = await getEvents(limit);
    return { success: true, data: events };
  } catch (err) {
    log.error('GET_EVENTS failed', err);
    return { success: false, error: err.message };
  }
}

/**
 * Handle CLEAR_EVENTS — wipe all stored events.
 */
async function handleClearEvents() {
  try {
    await clearAllEvents();
    clearBadge();
    // Broadcast to any open popup so it can refresh
    sendRuntimeMessage({ type: MSG.EVENTS_CLEARED }).catch(() => {});
    return { success: true };
  } catch (err) {
    log.error('CLEAR_EVENTS failed', err);
    return { success: false, error: err.message };
  }
}

async function handleGetConfig() {
  try {
    const config = await loadConfig();
    return { success: true, data: config };
  } catch (err) {
    log.error('GET_CONFIG failed', err);
    return { success: false, error: err.message };
  }
}

async function handleSaveConfig(message) {
  try {
    const config = await saveConfig(message.config || {});
    await trimToMaxEvents();
    sendRuntimeMessage({ type: MSG.CONFIG_UPDATED, data: config }).catch(() => {});
    return { success: true, data: config };
  } catch (err) {
    log.error('SAVE_CONFIG failed', err);
    return { success: false, error: err.message };
  }
}

async function handleGetStats() {
  try {
    const stats = await getStats();
    return { success: true, data: stats };
  } catch (err) {
    log.error('GET_STATS failed', err);
    return { success: false, error: err.message };
  }
}

/**
 * Handle EXPORT_EVENTS — return all events for export.
 */
async function handleExportEvents() {
  try {
    const events = await getAllEvents();
    return { success: true, data: events };
  } catch (err) {
    log.error('EXPORT_EVENTS failed', err);
    return { success: false, error: err.message };
  }
}

/**
 * Broadcast a new event notification to the popup (if open).
 * @param {Object} event — CorrelationEvent
 */
export function broadcastNewEvent(event) {
  sendRuntimeMessage({ type: MSG.NEW_EVENT, data: event }).catch(() => {
    // popup not open — safe to ignore
  });
}
