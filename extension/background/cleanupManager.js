/**
 * @fileoverview Scheduled cleanup manager for IndexedDB retention enforcement.
 * Runs on a configurable interval, purging events that exceed the retention window
 * and enforcing the maximum event count (ring-buffer style eviction).
 */

import { STORAGE_LIMITS } from '../utils/constants.js';
import { getRetentionMs } from '../utils/configManager.js';
import { deleteEventsBefore, trimToMaxEvents } from './storageManager.js';
import * as log from '../utils/logger.js';

/** @type {number|null} */
let cleanupTimerId = null;

/**
 * Run a single cleanup pass:
 * 1. Delete events older than RETENTION_MS.
 * 2. If total count still exceeds MAX_EVENTS, trim the oldest surplus.
 */
async function runCleanup() {
  try {
    const configuredCutoff = Date.now() - getRetentionMs();
    await deleteEventsBefore(configuredCutoff);
    await trimToMaxEvents();
  } catch (err) {
    log.error('Cleanup pass failed', err);
  }
}

/**
 * Start the periodic cleanup scheduler.
 */
export function startCleanupScheduler() {
  if (cleanupTimerId !== null) return;
  // Run once immediately, then on interval
  runCleanup();
  cleanupTimerId = setInterval(runCleanup, STORAGE_LIMITS.CLEANUP_INTERVAL_MS);
  log.info('Cleanup scheduler started');
}

/**
 * Stop the cleanup scheduler.
 */
export function stopCleanupScheduler() {
  if (cleanupTimerId !== null) {
    clearInterval(cleanupTimerId);
    cleanupTimerId = null;
    log.info('Cleanup scheduler stopped');
  }
}
