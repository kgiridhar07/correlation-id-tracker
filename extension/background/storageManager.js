/**
 * @fileoverview IndexedDB storage manager with batched writes.
 * Provides an async interface over IndexedDB for persisting CorrelationEvent records.
 * Writes are batched and flushed periodically to reduce I/O overhead.
 */

import { DB_CONFIG, STORAGE_LIMITS } from '../utils/constants.js';
import { getMaxEvents } from '../utils/configManager.js';
import { isValidCorrelationEvent } from '../utils/validators.js';
import * as log from '../utils/logger.js';

/** @type {IDBDatabase|null} */
let db = null;

/** @type {Array<Object>} pending write queue */
const writeQueue = [];

/** @type {number|null} flush timer ID */
let flushTimerId = null;

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (db) { resolve(db); return; }

    const request = indexedDB.open(DB_CONFIG.NAME, DB_CONFIG.VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(DB_CONFIG.STORE_NAME)) {
        const store = database.createObjectStore(DB_CONFIG.STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('correlationId', 'correlationId', { unique: false });
        store.createIndex('url', 'url', { unique: false });
        store.createIndex('requestId', 'requestId', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      db.onclose = () => { db = null; };
      resolve(db);
    };

    request.onerror = (event) => {
      log.error('IndexedDB open failed', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Ensure the database connection is ready.
 * @returns {Promise<IDBDatabase>}
 */
async function getDb() {
  if (!db) return openDatabase();
  return db;
}

/**
 * Queue an event for batched storage.
 * @param {Object} event — CorrelationEvent
 */
export function queueEvent(event) {
  if (!isValidCorrelationEvent(event)) {
    log.warn('Dropped invalid event', event);
    return;
  }
  writeQueue.push(event);

  // Force flush if batch limit reached
  if (writeQueue.length >= STORAGE_LIMITS.BATCH_MAX_SIZE) {
    flushQueue();
  }
}

/**
 * Flush the write queue to IndexedDB in a single transaction.
 */
export async function flushQueue() {
  if (writeQueue.length === 0) return;

  const batch = writeQueue.splice(0, writeQueue.length);
  try {
    const database = await getDb();
    const tx = database.transaction(DB_CONFIG.STORE_NAME, 'readwrite');
    const store = tx.objectStore(DB_CONFIG.STORE_NAME);

    for (const event of batch) {
      store.add(event);
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    log.debug(`Flushed ${batch.length} events to IndexedDB`);
    await trimToMaxEvents();
  } catch (err) {
    log.error('Batch write failed, re-queuing events', err);
    // Re-queue failed events at the front
    writeQueue.unshift(...batch);
  }
}

/**
 * Start the periodic flush timer.
 */
export function startBatchTimer() {
  if (flushTimerId !== null) return;
  flushTimerId = setInterval(flushQueue, STORAGE_LIMITS.BATCH_INTERVAL_MS);
}

/**
 * Stop the periodic flush timer.
 */
export function stopBatchTimer() {
  if (flushTimerId !== null) {
    clearInterval(flushTimerId);
    flushTimerId = null;
  }
}

/**
 * Retrieve events from IndexedDB, newest first.
 * @param {number} [limit=200]
 * @returns {Promise<Array<Object>>}
 */
export async function getEvents(limit = 200) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(DB_CONFIG.STORE_NAME, 'readonly');
    const store = tx.objectStore(DB_CONFIG.STORE_NAME);
    const index = store.index('timestamp');
    const results = [];

    const request = index.openCursor(null, 'prev'); // newest first
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && results.length < limit) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve all events (for export).
 * @returns {Promise<Array<Object>>}
 */
export async function getAllEvents() {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(DB_CONFIG.STORE_NAME, 'readonly');
    const store = tx.objectStore(DB_CONFIG.STORE_NAME);
    const index = store.index('timestamp');
    const results = [];
    const request = index.openCursor(null, 'prev');
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Return aggregate storage stats for the popup.
 * @returns {Promise<Object>}
 */
export async function getStats() {
  const events = await getAllEvents();
  const uniqueIds = new Set(events.map((event) => event.correlationId)).size;
  return {
    totalEvents: events.length,
    uniqueIds,
    maxEvents: getMaxEvents(),
    newestTimestamp: events[0] ? events[0].timestamp : null,
  };
}

/**
 * Delete all stored events.
 * @returns {Promise<void>}
 */
export async function clearAllEvents() {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(DB_CONFIG.STORE_NAME, 'readwrite');
    const store = tx.objectStore(DB_CONFIG.STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => { log.info('All events cleared'); resolve(); };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete events older than a given timestamp.
 * @param {number} cutoffTimestamp — epoch ms
 * @returns {Promise<number>} number of deleted records
 */
export async function deleteEventsBefore(cutoffTimestamp) {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(DB_CONFIG.STORE_NAME, 'readwrite');
    const store = tx.objectStore(DB_CONFIG.STORE_NAME);
    const index = store.index('timestamp');
    const range = IDBKeyRange.upperBound(cutoffTimestamp);
    let count = 0;

    const request = index.openCursor(range);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        count++;
        cursor.continue();
      } else {
        log.info(`Cleanup: deleted ${count} old events`);
        resolve(count);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete oldest records when stored events exceed configured maximum.
 * @returns {Promise<number>}
 */
export async function trimToMaxEvents() {
  const maxEvents = getMaxEvents();
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(DB_CONFIG.STORE_NAME, 'readwrite');
    const store = tx.objectStore(DB_CONFIG.STORE_NAME);
    const index = store.index('timestamp');
    let total = 0;
    let deleted = 0;
    const request = index.openCursor(null, 'prev');

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        if (deleted > 0) log.info(`Cleanup: trimmed ${deleted} surplus events`);
        resolve(deleted);
        return;
      }

      total++;
      if (total > maxEvents) {
        cursor.delete();
        deleted++;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
