/**
 * @fileoverview Application-wide constants for the Correlation ID Tracker extension.
 * Centralizes all magic values, configuration defaults, and enumerations.
 */

/** Header names to scan for correlation IDs (lowercase for case-insensitive matching) */
export const CORRELATION_HEADERS = Object.freeze([
  'order-tracking-id',
  'usom-correlationid',
]);

/** Headers required by order-flow stitching/display regardless of editable capture headers. */
export const ORDER_FLOW_CAPTURE_HEADERS = Object.freeze([
  'order-tracking-id',
  'usom-correlationid',
]);

/** URL patterns to filter relevant traffic. Only requests matching at least one pattern are captured. */
export const URL_FILTERS = Object.freeze([
]);

/** Default URL patterns used to stitch order-flow milestone correlation IDs. */
export const ORDER_FLOW_MILESTONES = Object.freeze([
  {
    key: 'sourcingOptions',
    label: 'Sourcing Options',
    patterns: ['sourcingoptions', 'sourcing-options', 'source/options', 'source-options'],
  },
  {
    key: 'capacity',
    label: 'Capacity',
    patterns: ['sourcingoptions?calltype=capacity', 'calltype=capacity', 'delivery-capacity', 'capacity'],
  },
  {
    key: 'reserveDelivery',
    label: 'Reserve Delivery',
    patterns: ['reservedelivery', 'reserve-delivery', 'reserve_delivery', 'reserve/delivery', 'delivery/reserve', 'appointments/reservations', 'reservation', 'reservations'],
  },
]);

/** Persisted user configuration */
export const CONFIG = Object.freeze({
  STORAGE_KEY: 'correlationTrackerConfig',
});

/** IndexedDB configuration */
export const DB_CONFIG = Object.freeze({
  NAME: 'CorrelationTrackerDB',
  VERSION: 1,
  STORE_NAME: 'correlationEvents',
});

/** Storage and retention limits */
export const STORAGE_LIMITS = Object.freeze({
  /** Maximum number of events to keep in IndexedDB */
  MAX_EVENTS: 10_000,
  /** Events older than this (ms) are eligible for cleanup */
  RETENTION_MS: 24 * 60 * 60 * 1000, // 24 hours
  /** Batch write interval (ms) — events are queued and flushed periodically */
  BATCH_INTERVAL_MS: 2_000,
  /** Maximum batch size before forcing a flush */
  BATCH_MAX_SIZE: 50,
  /** Cleanup interval (ms) */
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
});

/** User-editable defaults, persisted via extension storage */
export const DEFAULT_CONFIG = Object.freeze({
  urlFilters: URL_FILTERS,
  correlationHeaders: CORRELATION_HEADERS,
  pageDataWatchers: [],
  pageDataPollMs: 1000,
  pageDataDurationSeconds: 120,
  orderFlowMilestones: ORDER_FLOW_MILESTONES,
  reportRecipients: [],
  maxEvents: STORAGE_LIMITS.MAX_EVENTS,
  retentionHours: 24,
});

/** In-memory ring buffer config for the pending-request map */
export const RING_BUFFER = Object.freeze({
  /** Max pending (unmatched) request entries before eviction */
  MAX_PENDING: 5_000,
});

/** Source types for captured correlation IDs */
export const SOURCE_TYPES = Object.freeze({
  REQUEST_HEADER: 'request-header',
  RESPONSE_HEADER: 'response-header',
  PAGE_DATA: 'page-data',
});

/** Message types for background ↔ popup communication */
export const MSG = Object.freeze({
  GET_EVENTS: 'GET_EVENTS',
  NEW_EVENT: 'NEW_EVENT',
  CLEAR_EVENTS: 'CLEAR_EVENTS',
  EVENTS_CLEARED: 'EVENTS_CLEARED',
  EXPORT_EVENTS: 'EXPORT_EVENTS',
  GET_CONFIG: 'GET_CONFIG',
  SAVE_CONFIG: 'SAVE_CONFIG',
  CONFIG_UPDATED: 'CONFIG_UPDATED',
  CAPTURE_PAGE_DATA: 'CAPTURE_PAGE_DATA',
  RUN_ORDER_AUTOMATION: 'RUN_ORDER_AUTOMATION',
  RUN_ORDER_WORKFLOW: 'RUN_ORDER_WORKFLOW',
});

/** Popup UI defaults */
export const UI = Object.freeze({
  /** Debounce interval for UI refresh (ms) */
  DEBOUNCE_MS: 500,
  /** Max rows rendered in popup table at once */
  MAX_VISIBLE_ROWS: 200,
  /** Date format locale */
  LOCALE: 'en-US',
});
