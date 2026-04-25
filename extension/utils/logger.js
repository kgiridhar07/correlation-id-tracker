/**
 * @fileoverview Lightweight logger with level gating.
 * Prevents excessive console output in production while enabling verbose
 * logging during development.
 */

const LOG_LEVELS = Object.freeze({ OFF: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4 });

/** Current log level — set to WARN for production, DEBUG during development */
let currentLevel = LOG_LEVELS.WARN;

const PREFIX = '[CorrTracker]';

/**
 * Set the active log level.
 * @param {'OFF'|'ERROR'|'WARN'|'INFO'|'DEBUG'} level
 */
export function setLogLevel(level) {
  if (LOG_LEVELS[level] !== undefined) {
    currentLevel = LOG_LEVELS[level];
  }
}

/** @param {...any} args */
export function error(...args) {
  if (currentLevel >= LOG_LEVELS.ERROR) console.error(PREFIX, ...args);
}

/** @param {...any} args */
export function warn(...args) {
  if (currentLevel >= LOG_LEVELS.WARN) console.warn(PREFIX, ...args);
}

/** @param {...any} args */
export function info(...args) {
  if (currentLevel >= LOG_LEVELS.INFO) console.info(PREFIX, ...args);
}

/** @param {...any} args */
export function debug(...args) {
  if (currentLevel >= LOG_LEVELS.DEBUG) console.debug(PREFIX, ...args);
}

export default { setLogLevel, error, warn, info, debug };
