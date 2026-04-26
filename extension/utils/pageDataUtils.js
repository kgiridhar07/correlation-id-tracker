/**
 * @fileoverview Utilities for configurable page-data watcher paths.
 */

const MAX_WATCHERS = 50;
const MAX_LABEL_LENGTH = 80;
const MAX_PATH_LENGTH = 300;

/**
 * Normalize watcher definitions from settings UI lines or stored objects.
 * @param {Array<Object|string>|string} value
 * @returns {Array<Object>}
 */
export function normalizePageDataWatchers(value) {
  const rawItems = Array.isArray(value) ? value : String(value || '').split('\n');
  const watchers = [];
  const seen = new Set();

  for (const item of rawItems) {
    const watcher = typeof item === 'string' ? parseWatcherLine(item) : normalizeWatcherObject(item);
    if (!watcher) continue;

    const key = `${watcher.label.toLowerCase()}|${watcher.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    watchers.push(watcher);
    if (watchers.length >= MAX_WATCHERS) break;
  }

  return watchers;
}

/**
 * Format watcher definitions for the options textarea.
 * @param {Array<Object>} watchers
 * @returns {string}
 */
export function formatWatcherLines(watchers) {
  return normalizePageDataWatchers(watchers)
    .map((watcher) => `${watcher.label} | ${watcher.path}`)
    .join('\n');
}

/**
 * Parse a JavaScript global path like digitalData.cart.items[0].id.
 * @param {string} path
 * @returns {Array<string>|null}
 */
export function parseDataPath(path) {
  const text = String(path || '').trim();
  if (!text || text.length > MAX_PATH_LENGTH) return null;

  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];

    if (char === '.') {
      index++;
      continue;
    }

    if (char === '[') {
      const closeIndex = text.indexOf(']', index + 1);
      if (closeIndex === -1) return null;
      const inner = text.slice(index + 1, closeIndex).trim();
      const token = parseBracketToken(inner);
      if (!token) return null;
      tokens.push(token);
      index = closeIndex + 1;
      continue;
    }

    const match = /^[A-Za-z_$][\w$]*/.exec(text.slice(index));
    if (!match) return null;
    tokens.push(match[0]);
    index += match[0].length;
  }

  return tokens.length > 0 ? tokens : null;
}

/**
 * Safely serialize a captured page value for local storage and display.
 * @param {*} value
 * @returns {{ value: string, valueType: string }|null}
 */
export function serializePageValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const valueType = Array.isArray(value) ? 'array' : typeof value;
  let text;
  if (valueType === 'object' || valueType === 'array') {
    try {
      text = JSON.stringify(value);
    } catch (_err) {
      text = String(value);
    }
  } else {
    text = String(value);
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  return {
    value: trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed,
    valueType,
  };
}

function parseWatcherLine(line) {
  const text = String(line || '').trim();
  if (!text || text.startsWith('#')) return null;
  const separatorIndex = text.indexOf('|');
  const label = separatorIndex === -1 ? pathToLabel(text) : text.slice(0, separatorIndex).trim();
  const path = separatorIndex === -1 ? text : text.slice(separatorIndex + 1).trim();
  return normalizeWatcherObject({ label, path });
}

function normalizeWatcherObject(item) {
  if (!item || typeof item !== 'object') return null;
  const path = String(item.path || '').trim();
  if (!parseDataPath(path)) return null;
  const label = String(item.label || pathToLabel(path)).trim().slice(0, MAX_LABEL_LENGTH);
  if (!label) return null;
  return { label, path };
}

function parseBracketToken(inner) {
  if (/^\d+$/.test(inner)) return inner;
  const quoted = /^(['"])(.*)\1$/.exec(inner);
  if (!quoted) return null;
  return quoted[2].replace(/\\(['"\\])/g, '$1');
}

function pathToLabel(path) {
  const parts = parseDataPath(path) || [];
  return parts.length ? parts[parts.length - 1] : 'Page Data';
}