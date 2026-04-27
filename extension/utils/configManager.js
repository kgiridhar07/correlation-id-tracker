/**
 * @fileoverview Persisted configuration for filters, headers, and retention.
 */

import { CONFIG, DEFAULT_CONFIG } from './constants.js';
import { getLocalStorage, setLocalStorage } from './browserApi.js';
import { normalizeOrderFlowMilestones } from './flowUtils.js';
import { normalizePageDataWatchers } from './pageDataUtils.js';

let activeConfig = { ...DEFAULT_CONFIG };

function normalizeStringList(value, fallback) {
  const items = Array.isArray(value) ? value : String(value || '').split('\n');
  const cleaned = items
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : [...fallback];
}

function normalizeEmailList(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[\n,;]/);
  const cleaned = items
    .map((item) => String(item).trim().toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
  return Array.from(new Set(cleaned)).slice(0, 25);
}

/**
 * Normalize user configuration and fill missing values with defaults.
 * @param {Object} value
 * @returns {Object}
 */
export function normalizeConfig(value = {}) {
  const maxEvents = Number.parseInt(value.maxEvents, 10);
  const retentionHours = Number.parseFloat(value.retentionHours);
  const pageDataPollMs = Number.parseInt(value.pageDataPollMs, 10);
  const pageDataDurationSeconds = Number.parseInt(value.pageDataDurationSeconds, 10);

  return {
    urlFilters: normalizeStringList(value.urlFilters, DEFAULT_CONFIG.urlFilters),
    correlationHeaders: normalizeStringList(value.correlationHeaders, DEFAULT_CONFIG.correlationHeaders),
    pageDataWatchers: normalizePageDataWatchers(value.pageDataWatchers),
    orderFlowMilestones: normalizeOrderFlowMilestones(value.orderFlowMilestones),
    pageDataPollMs: Number.isFinite(pageDataPollMs) ? clamp(pageDataPollMs, 250, 10000) : DEFAULT_CONFIG.pageDataPollMs,
    pageDataDurationSeconds: Number.isFinite(pageDataDurationSeconds) ? clamp(pageDataDurationSeconds, 1, 300) : DEFAULT_CONFIG.pageDataDurationSeconds,
    reportRecipients: normalizeEmailList(value.reportRecipients),
    maxEvents: Number.isFinite(maxEvents) && maxEvents > 0 ? Math.min(maxEvents, 100000) : DEFAULT_CONFIG.maxEvents,
    retentionHours: Number.isFinite(retentionHours) && retentionHours > 0 ? Math.min(retentionHours, 720) : DEFAULT_CONFIG.retentionHours,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Load configuration from extension storage.
 * @returns {Promise<Object>}
 */
export async function loadConfig() {
  const result = await getLocalStorage(CONFIG.STORAGE_KEY);
  const stored = result && result[CONFIG.STORAGE_KEY];
  activeConfig = normalizeConfig(stored);
  return getConfig();
}

/**
 * Save configuration to extension storage.
 * @param {Object} nextConfig
 * @returns {Promise<Object>}
 */
export async function saveConfig(nextConfig) {
  activeConfig = normalizeConfig(nextConfig);
  await setLocalStorage({ [CONFIG.STORAGE_KEY]: activeConfig });
  return getConfig();
}

/**
 * Return the active in-memory configuration.
 * @returns {Object}
 */
export function getConfig() {
  return {
    urlFilters: [...activeConfig.urlFilters],
    correlationHeaders: [...activeConfig.correlationHeaders],
    pageDataWatchers: activeConfig.pageDataWatchers.map((watcher) => ({ ...watcher })),
    orderFlowMilestones: activeConfig.orderFlowMilestones.map((milestone) => ({ ...milestone, patterns: [...milestone.patterns] })),
    pageDataPollMs: activeConfig.pageDataPollMs,
    pageDataDurationSeconds: activeConfig.pageDataDurationSeconds,
    reportRecipients: [...activeConfig.reportRecipients],
    maxEvents: activeConfig.maxEvents,
    retentionHours: activeConfig.retentionHours,
  };
}

export function getRetentionMs() {
  return activeConfig.retentionHours * 60 * 60 * 1000;
}

export function getMaxEvents() {
  return activeConfig.maxEvents;
}
