/**
 * @fileoverview Correlation ID extraction from chrome.webRequest header arrays.
 * Uses case-insensitive matching against a configurable set of header names.
 * Returns all matching correlation IDs found in a single header set.
 */

import { CORRELATION_HEADERS } from '../utils/constants.js';
import { isValidHeader } from '../utils/validators.js';

/**
 * Pre-built Set for O(1) header-name lookups.
 * All entries are stored lowercase since we normalise incoming header names.
 * @type {Set<string>}
 */
const HEADER_SET = new Set(CORRELATION_HEADERS);

/**
 * Extract all correlation IDs from a chrome.webRequest header array.
 * @param {Array<{name: string, value?: string}>} headers
 * @returns {Array<{headerName: string, value: string}>} matched correlation IDs
 */
export function extractCorrelationIds(headers) {
  if (!Array.isArray(headers)) return [];

  const results = [];
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (!isValidHeader(header)) continue;

    const nameLower = header.name.toLowerCase();
    if (HEADER_SET.has(nameLower) && header.value) {
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
