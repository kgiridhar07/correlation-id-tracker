/**
 * @fileoverview Validation utilities for incoming data.
 * Guards against malformed headers, missing fields, and unexpected types.
 */

/**
 * Check whether a value is a non-empty string.
 * @param {*} val
 * @returns {boolean}
 */
export function isNonEmptyString(val) {
  return typeof val === 'string' && val.length > 0;
}

/**
 * Validate that an object has the minimum shape of a CorrelationEvent.
 * @param {Object} event
 * @returns {boolean}
 */
export function isValidCorrelationEvent(event) {
  if (!event || typeof event !== 'object') return false;
  return (
    isNonEmptyString(event.requestId) &&
    typeof event.timestamp === 'number' &&
    event.timestamp > 0 &&
    isNonEmptyString(event.url) &&
    isNonEmptyString(event.correlationId) &&
    isNonEmptyString(event.sourceType)
  );
}

/**
 * Validate a webRequest header array entry.
 * @param {{ name: string, value?: string }} header
 * @returns {boolean}
 */
export function isValidHeader(header) {
  return header && isNonEmptyString(header.name);
}
