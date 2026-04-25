/**
 * @fileoverview General-purpose helper functions.
 */

import { URL_FILTERS } from './constants.js';

/**
 * Test whether a URL matches any of the configured filter patterns.
 * Uses simple substring matching for O(n) where n = number of patterns (small constant).
 * @param {string} url
 * @returns {boolean}
 */
export function isRelevantUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  for (let i = 0; i < URL_FILTERS.length; i++) {
    if (lower.includes(URL_FILTERS[i])) return true;
  }
  return false;
}

/**
 * Format a timestamp to a human-readable local string.
 * @param {number} ts — epoch milliseconds
 * @returns {string}
 */
export function formatTimestamp(ts) {
  return new Date(ts).toLocaleString('en-US', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Truncate a URL for display (keep first N chars + last M chars).
 * @param {string} url
 * @param {number} maxLen
 * @returns {string}
 */
export function truncateUrl(url, maxLen = 80) {
  if (!url || url.length <= maxLen) return url || '';
  const half = Math.floor((maxLen - 3) / 2);
  return url.slice(0, half) + '...' + url.slice(-half);
}

/**
 * Simple debounce utility.
 * @param {Function} fn
 * @param {number} delayMs
 * @returns {Function}
 */
export function debounce(fn, delayMs) {
  let timerId = null;
  return function (...args) {
    if (timerId !== null) clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerId = null;
      fn.apply(this, args);
    }, delayMs);
  };
}
