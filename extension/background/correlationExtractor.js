/**
 * @fileoverview Correlation ID extraction from webRequest header arrays.
 * Uses case-insensitive matching against a configurable set of header names.
 * Returns all matching correlation IDs found in a single header set.
 */

import { ORDER_FLOW_CAPTURE_HEADERS } from '../utils/constants.js';
import { isValidHeader } from '../utils/validators.js';

export function getCaptureHeaderNames() {
  return [...ORDER_FLOW_CAPTURE_HEADERS];
}

/**
 * Extract all correlation IDs from a webRequest header array.
 * @param {Array<{name: string, value?: string}>} headers
 * @returns {Array<{headerName: string, value: string}>} matched correlation IDs
 */
export function extractCorrelationIds(headers) {
  if (!Array.isArray(headers)) return [];

  const headerSet = new Set(getCaptureHeaderNames());
  const results = [];
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (!isValidHeader(header)) continue;

    const nameLower = header.name.toLowerCase();
    if (headerSet.has(nameLower) && header.value) {
      results.push({ headerName: nameLower, value: header.value });
    }
  }
  return results;
}

/**
 * Extract the first correlation ID found (convenience shorthand).
 * @param {Array<{name: string, value?: string}>} headers
 * @returns {string|null}
 */
export function extractFirstCorrelationId(headers) {
  const ids = extractCorrelationIds(headers);
  return ids.length > 0 ? ids[0].value : null;
}
