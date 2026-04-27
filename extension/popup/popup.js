/**
 * @fileoverview Popup controller for search, filters, export, copy, and live updates.
 */

import { MSG, UI } from '../utils/constants.js';
import { getExtensionApi, sendRuntimeMessage } from '../utils/browserApi.js';
import { collapseByCorrelationId, csvEscape, enrichDuplicateCounts, summarizeEvents } from '../utils/dataUtils.js';
import { debounce, formatTimestamp, getEventKey, getHostname } from '../utils/helpers.js';
import { buildOrderFlowReport } from '../utils/flowUtils.js';
import { buildInvestigationReport } from '../utils/reportUtils.js';
import { initRenderer, renderEvents, prependEvent } from './tableRenderer.js';

const FLOW_STORAGE_KEY = 'correlationTrackerOrderFlow';

const searchInput = document.getElementById('searchInput');
const sourceFilter = document.getElementById('sourceFilter');
const methodFilter = document.getElementById('methodFilter');
const domainFilter = document.getElementById('domainFilter');
const timeFilter = document.getElementById('timeFilter');
const duplicateOnly = document.getElementById('duplicateOnly');
const collapseDuplicates = document.getElementById('collapseDuplicates');
const btnRefresh = document.getElementById('btnRefresh');
const btnOpenDashboard = document.getElementById('btnOpenDashboard');
const btnOptions = document.getElementById('btnOptions');
const btnClear = document.getElementById('btnClear');
const btnGenerateReport = document.getElementById('btnGenerateReport');
const btnStartFlow = document.getElementById('btnStartFlow');
const btnStopFlow = document.getElementById('btnStopFlow');
const btnGenerateFlow = document.getElementById('btnGenerateFlow');
const btnExportJson = document.getElementById('btnExportJson');
const btnExportCsv = document.getElementById('btnExportCsv');
const btnCopyReport = document.getElementById('btnCopyReport');
const btnEmailReport = document.getElementById('btnEmailReport');
const btnCloseReport = document.getElementById('btnCloseReport');
const btnCopyLatestId = document.getElementById('btnCopyLatestId');
const btnCopyLatestNote = document.getElementById('btnCopyLatestNote');
const latestPanel = document.getElementById('latestPanel');
const latestId = document.getElementById('latestId');
const latestMeta = document.getElementById('latestMeta');
const reportPanel = document.getElementById('reportPanel');
const reportPreview = document.getElementById('reportPreview');
const reportMeta = document.getElementById('reportMeta');
const flowStatus = document.getElementById('flowStatus');
const flowSku = document.getElementById('flowSku');
const flowCustomer = document.getElementById('flowCustomer');
const flowAddress = document.getElementById('flowAddress');
const flowDeliveryType = document.getElementById('flowDeliveryType');
const flowNotes = document.getElementById('flowNotes');
const eventsBody = document.getElementById('eventsBody');
const emptyState = document.getElementById('emptyState');
const statusText = document.getElementById('statusText');
const statsText = document.getElementById('statsText');
const metricTotal = document.getElementById('metricTotal');
const metricUnique = document.getElementById('metricUnique');
const metricDuplicates = document.getElementById('metricDuplicates');
const metricDomains = document.getElementById('metricDomains');
const metricSources = document.getElementById('metricSources');
const insightText = document.getElementById('insightText');
const topDomainsList = document.getElementById('topDomainsList');
const topMethodsList = document.getElementById('topMethodsList');
const topDuplicatesList = document.getElementById('topDuplicatesList');
const activityBars = document.getElementById('activityBars');

let allEvents = [];
let visibleEvents = [];
let latestEvent = null;
let latestStats = null;
let eventMap = new Map();
let currentReport = null;
let flowState = loadStoredFlowState();

async function loadEvents() {
  setStatus('Loading...');
  try {
    const [eventsResponse, statsResponse] = await Promise.all([
      sendMessage({ type: MSG.EXPORT_EVENTS }),
      sendMessage({ type: MSG.GET_STATS }),
    ]);

    if (eventsResponse && eventsResponse.success) {
      allEvents = eventsResponse.data || [];
      latestEvent = allEvents[0] || null;
      refreshDerivedState();
      updateLatestPanel();
      setStatus(`${allEvents.length} events loaded`);
    } else {
      setStatus('Failed to load events');
    }

    if (statsResponse && statsResponse.success) {
      latestStats = statsResponse.data;
      updateStats();
    }
  } catch (err) {
    setStatus('Error: ' + err.message);
  }
}

function refreshDerivedState() {
  const enrichedEvents = enrichDuplicateCounts(allEvents);

  updateSelectOptions(methodFilter, 'All methods', uniqueValues(enrichedEvents, (event) => event.method));
  updateSelectOptions(domainFilter, 'All domains', uniqueValues(enrichedEvents, (event) => getHostname(event.url)));

  visibleEvents = applyFilters(enrichedEvents);
  if (collapseDuplicates.checked) {
    visibleEvents = collapseByCorrelationId(visibleEvents);
  }

  eventMap = new Map(visibleEvents.map((event) => [getEventKey(event), event]));
  renderEvents(visibleEvents);
  updateDashboard(enrichedEvents);
  updateStats();
}

function updateDashboard(events) {
  const summary = summarizeEvents(events);
  metricTotal.textContent = formatNumber(summary.totalEvents);
  metricUnique.textContent = formatNumber(summary.uniqueIds);
  metricDuplicates.textContent = `${summary.duplicateRate}%`;
  metricDomains.textContent = formatNumber(summary.activeDomains);
  metricSources.textContent = `${formatNumber(summary.requestCount)} / ${formatNumber(summary.responseCount)} / ${formatNumber(summary.pageDataCount)}`;
  insightText.textContent = summary.insight;
  renderRankList(topDomainsList, summary.topDomains);
  renderRankList(topMethodsList, summary.topMethods);
  renderRankList(topDuplicatesList, summary.topDuplicateIds);
  renderActivityBars(summary.recentActivity);
}

function renderRankList(container, items) {
  container.textContent = '';
  if (!items.length) {
    const empty = document.createElement('span');
    empty.className = 'empty-list';
    empty.textContent = 'No data yet';
    container.appendChild(empty);
    return;
  }

  const maxCount = Math.max(...items.map((item) => item.count), 1);
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'rank-item';

    const label = document.createElement('span');
    label.className = 'rank-label';
    label.textContent = item.label;
    label.title = item.label;

    const count = document.createElement('span');
    count.className = 'rank-count';
    count.textContent = formatNumber(item.count);

    const bar = document.createElement('div');
    bar.className = 'rank-bar';
    const fill = document.createElement('div');
    fill.className = 'rank-fill';
    fill.style.width = `${Math.max(6, Math.round((item.count / maxCount) * 100))}%`;
    bar.appendChild(fill);

    row.append(label, count, bar);
    container.appendChild(row);
  }
}

function renderActivityBars(buckets) {
  activityBars.textContent = '';
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);
  for (const bucket of buckets) {
    const bar = document.createElement('div');
    bar.className = 'activity-bar';
    bar.title = `${bucket.label}: ${bucket.count} events`;
    bar.style.height = `${Math.max(3, Math.round((bucket.count / maxCount) * 72))}px`;
    bar.style.opacity = bucket.count > 0 ? '1' : '0.3';
    activityBars.appendChild(bar);
  }
}

function applyFilters(events) {
  const query = (searchInput.value || '').toLowerCase().trim();
  const source = sourceFilter.value;
  const method = methodFilter.value;
  const domain = domainFilter.value;
  const minutes = timeFilter.value === 'all' ? null : Number.parseInt(timeFilter.value, 10);
  const cutoff = minutes ? Date.now() - minutes * 60 * 1000 : null;

  return events.filter((event) => {
    const hostname = getHostname(event.url);
    const matchesQuery = !query ||
      event.correlationId.toLowerCase().includes(query) ||
      event.url.toLowerCase().includes(query) ||
      (event.method || '').toLowerCase().includes(query) ||
      (event.sourceType || '').toLowerCase().includes(query) ||
      (event.fieldLabel || '').toLowerCase().includes(query) ||
      (event.fieldPath || '').toLowerCase().includes(query) ||
      hostname.toLowerCase().includes(query);
    return matchesQuery &&
      (source === 'all' || event.sourceType === source) &&
      (method === 'all' || event.method === method) &&
      (domain === 'all' || hostname === domain) &&
      (!cutoff || event.timestamp >= cutoff) &&
      (!duplicateOnly.checked || event.duplicateCount > 1);
  });
}

function uniqueValues(events, mapper) {
  return Array.from(new Set(events.map(mapper).filter(Boolean))).sort();
}

function updateSelectOptions(select, allLabel, values) {
  const currentValue = select.value;
  select.textContent = '';
  select.appendChild(new Option(allLabel, 'all'));
  for (const value of values) {
    select.appendChild(new Option(value, value));
  }
  select.value = values.includes(currentValue) ? currentValue : 'all';
}

async function exportJson() {
  setStatus('Exporting JSON...');
  const response = await sendMessage({ type: MSG.EXPORT_EVENTS });
  if (!response || !response.success) { setStatus('Export failed'); return; }

  const payload = {
    metadata: buildExportMetadata(response.data),
    events: response.data,
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `correlation-events-${Date.now()}.json`);
  setStatus('JSON exported');
}

async function exportCsv() {
  setStatus('Exporting CSV...');
  const response = await sendMessage({ type: MSG.EXPORT_EVENTS });
  if (!response || !response.success) { setStatus('Export failed'); return; }

  const metadata = buildExportMetadata(response.data);
  const header = 'timestamp,requestId,method,domain,url,capturedValue,sourceType,fieldLabel,fieldPath,valueType,tabId\n';
  const rows = response.data.map((event) => [
    new Date(event.timestamp).toISOString(),
    event.requestId,
    event.method,
    getHostname(event.url),
    csvEscape(event.url || ''),
    event.correlationId,
    event.sourceType,
    csvEscape(event.fieldLabel || ''),
    csvEscape(event.fieldPath || ''),
    event.valueType || '',
    event.tabId,
  ].join(','));
  const preface = [
    `# exportedAt=${metadata.exportedAt}`,
    `# browser=${metadata.browser}`,
    `# totalEvents=${metadata.totalEvents}`,
    `# activeFilters=${JSON.stringify(metadata.activeFilters)}`,
  ].join('\n');
  downloadBlob(new Blob([preface + '\n' + header + rows.join('\n')], { type: 'text/csv' }), `correlation-events-${Date.now()}.csv`);
  setStatus('CSV exported');
}

function buildExportMetadata(events) {
  return {
    tool: 'Correlation ID Tracker',
    version: getExtensionApi().runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    totalEvents: events.length,
    uniqueIds: new Set(events.map((event) => event.correlationId)).size,
    activeFilters: {
      search: searchInput.value || '',
      source: sourceFilter.value,
      method: methodFilter.value,
      domain: domainFilter.value,
      timeMinutes: timeFilter.value,
      duplicateOnly: duplicateOnly.checked,
      collapseDuplicates: collapseDuplicates.checked,
    },
  };
}

async function generateReport() {
  const report = buildInvestigationReport(visibleEvents, { scopeLabel: buildScopeLabel() });
  currentReport = report;
  reportPreview.value = report.body;
  reportMeta.textContent = `${visibleEvents.length} filtered events summarized. Full raw data stays in JSON/CSV export.`;
  reportPanel.hidden = false;
  setStatus('Report generated');
}

async function copyReport() {
  if (!currentReport) await generateReport();
  await navigator.clipboard.writeText(currentReport.body);
  setStatus('Report copied');
}

async function emailReport() {
  if (!currentReport) await generateReport();
  const config = await getConfig();
  const recipients = (config.reportRecipients || []).join(',');
  if (!recipients) {
    setStatus('Add report recipients in options');
    openOptions();
    return;
  }

  const subject = encodeURIComponent(currentReport.subject);
  const body = encodeURIComponent(currentReport.truncatedBody);
  window.open(`mailto:${encodeURIComponent(recipients)}?subject=${subject}&body=${body}`, '_blank');
  setStatus('Email draft opened');
}

function closeReport() {
  reportPanel.hidden = true;
}

async function getConfig() {
  const response = await sendMessage({ type: MSG.GET_CONFIG });
  return response && response.success ? response.data : {};
}

function buildScopeLabel() {
  const parts = [];
  if (searchInput.value.trim()) parts.push(`Search: ${searchInput.value.trim()}`);
  if (sourceFilter.value !== 'all') parts.push(`Source: ${sourceFilter.value}`);
  if (methodFilter.value !== 'all') parts.push(`Method: ${methodFilter.value}`);
  if (domainFilter.value !== 'all') parts.push(`Domain: ${domainFilter.value}`);
  if (timeFilter.value !== 'all') parts.push(`Last ${timeFilter.value} minutes`);
  if (duplicateOnly.checked) parts.push('Duplicates only');
  if (collapseDuplicates.checked) parts.push('Collapsed duplicates');
  return parts.length ? parts.join(', ') : 'All captured events';
}

function startFlow() {
  flowState = {
    ...readFlowInputs(),
    startTime: Date.now(),
    endTime: null,
    active: true,
  };
  saveFlowState();
  updateFlowUi();
  setStatus('Order flow started');
}

function stopFlow() {
  flowState = {
    ...flowState,
    ...readFlowInputs(),
    endTime: Date.now(),
    active: false,
  };
  saveFlowState();
  updateFlowUi();
  setStatus('Order flow stopped');
}

async function generateFlowReport() {
  flowState = { ...flowState, ...readFlowInputs() };
  saveFlowState();
  const config = await getConfig();
  const report = buildOrderFlowReport(allEvents, flowState, Date.now(), config.orderFlowMilestones);
  currentReport = {
    subject: report.subject,
    body: report.body,
    truncatedBody: report.body,
  };
  reportPreview.value = report.body;
  reportMeta.textContent = `${report.matchedEvents.length} flow-window events stitched from manual fields, Quote ID, and milestone URLs.`;
  reportPanel.hidden = false;
  setStatus('Flow report generated');
}

function readFlowInputs() {
  return {
    sku: flowSku ? flowSku.value.trim() : '',
    customer: flowCustomer ? flowCustomer.value.trim() : '',
    address: flowAddress ? flowAddress.value.trim() : '',
    deliveryType: flowDeliveryType ? flowDeliveryType.value.trim() : '',
    notes: flowNotes ? flowNotes.value.trim() : '',
  };
}

function loadStoredFlowState() {
  try {
    return JSON.parse(localStorage.getItem(FLOW_STORAGE_KEY)) || {};
  } catch (_err) {
    return {};
  }
}

function saveFlowState() {
  localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(flowState));
}

function persistFlowInputs() {
  flowState = { ...flowState, ...readFlowInputs() };
  saveFlowState();
  updateFlowUi();
}

function updateFlowUi() {
  if (flowSku) flowSku.value = flowState.sku || '';
  if (flowCustomer) flowCustomer.value = flowState.customer || '';
  if (flowAddress) flowAddress.value = flowState.address || '';
  if (flowDeliveryType) flowDeliveryType.value = flowState.deliveryType || '';
  if (flowNotes) flowNotes.value = flowState.notes || '';
  if (!flowStatus) return;

  if (flowState.active && flowState.startTime) {
    flowStatus.textContent = `Active since ${formatTimestamp(flowState.startTime)}`;
  } else if (flowState.startTime) {
    flowStatus.textContent = `Stopped: ${formatTimestamp(flowState.startTime)} to ${formatTimestamp(flowState.endTime || Date.now())}`;
  } else {
    flowStatus.textContent = 'Not started';
  }
}

async function clearEvents() {
  if (!confirm('Clear all captured events?')) return;
  const response = await sendMessage({ type: MSG.CLEAR_EVENTS });
  if (response && response.success) {
    allEvents = [];
    latestEvent = null;
    latestStats = null;
    refreshDerivedState();
    updateLatestPanel();
    setStatus('Events cleared');
  }
}

async function handleTableClick(event) {
  const button = event.target.closest('.btn-copy');
  if (!button) return;
  const targetEvent = eventMap.get(button.dataset.eventKey);
  if (!targetEvent) return;
  await copyEvent(targetEvent, button.dataset.copyFormat);
  flashButton(button);
}

async function copyEvent(event, format) {
  const value = formatCopyValue(event, format);
  await navigator.clipboard.writeText(value);
  setStatus(`Copied ${format}`);
}

function formatCopyValue(event, format) {
  if (format === 'json') {
    return JSON.stringify(event, null, 2);
  }
  if (format === 'note') {
    return [
      `Captured Value: ${event.correlationId}`,
      event.fieldLabel ? `Field: ${event.fieldLabel}` : '',
      event.fieldPath ? `Path: ${event.fieldPath}` : '',
      `Endpoint: ${event.url}`,
      `Method: ${event.method || '-'}`,
      `Source: ${event.sourceType}`,
      `Time: ${formatTimestamp(event.timestamp)}`,
    ].filter(Boolean).join('\n');
  }
  return event.correlationId;
}

function flashButton(button) {
  const original = button.textContent;
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = original; }, 1200);
}

function updateLatestPanel() {
  latestPanel.hidden = !latestEvent;
  if (!latestEvent) return;
  latestId.textContent = latestEvent.correlationId;
  const label = latestEvent.fieldLabel ? `${latestEvent.fieldLabel} - ` : '';
  latestMeta.textContent = `${label}${latestEvent.method || '-'} ${getHostname(latestEvent.url) || latestEvent.url} - ${latestEvent.sourceType}`;
}

function updateStats() {
  const total = latestStats ? latestStats.totalEvents : allEvents.length;
  const unique = latestStats ? latestStats.uniqueIds : new Set(allEvents.map((event) => event.correlationId)).size;
  statsText.textContent = `${visibleEvents.length} shown - ${total} saved - ${unique} unique`;
}

function onMessage(message) {
  if (!message) return;
  switch (message.type) {
    case MSG.NEW_EVENT:
      allEvents.unshift(message.data);
      latestEvent = message.data;
      updateLatestPanel();
      if (hasActiveFilters()) {
        debouncedRefresh();
      } else {
        const enriched = enrichDuplicateCounts(allEvents)[0];
        prependEvent(enriched);
        visibleEvents.unshift(enriched);
        eventMap.set(getEventKey(enriched), enriched);
        updateStats();
      }
      break;
    case MSG.EVENTS_CLEARED:
      allEvents = [];
      latestEvent = null;
      refreshDerivedState();
      updateLatestPanel();
      setStatus('Events cleared');
      break;
    case MSG.CONFIG_UPDATED:
      setStatus('Options updated');
      break;
  }
}

function hasActiveFilters() {
  return Boolean(searchInput.value.trim()) || sourceFilter.value !== 'all' || methodFilter.value !== 'all' ||
    domainFilter.value !== 'all' || timeFilter.value !== 'all' || duplicateOnly.checked || collapseDuplicates.checked;
}

function sendMessage(msg) {
  return sendRuntimeMessage(msg).catch(() => undefined);
}

function setStatus(text) {
  if (statusText) statusText.textContent = text;
}

function openOptions() {
  const runtime = getExtensionApi().runtime;
  if (runtime.openOptionsPage) {
    runtime.openOptionsPage();
  }
}

function openDashboard() {
  const extensionApi = getExtensionApi();
  const url = extensionApi.runtime.getURL('dashboard/dashboard.html');
  if (extensionApi.tabs && extensionApi.tabs.create) {
    extensionApi.tabs.create({ url });
    return;
  }
  window.open(url, '_blank');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const debouncedRefresh = debounce(refreshDerivedState, UI.DEBOUNCE_MS);

initRenderer(eventsBody, emptyState);
updateFlowUi();
loadEvents();
attachListeners();

function attachListeners() {
  searchInput.addEventListener('input', debouncedRefresh);
  sourceFilter.addEventListener('change', refreshDerivedState);
  methodFilter.addEventListener('change', refreshDerivedState);
  domainFilter.addEventListener('change', refreshDerivedState);
  timeFilter.addEventListener('change', refreshDerivedState);
  duplicateOnly.addEventListener('change', refreshDerivedState);
  collapseDuplicates.addEventListener('change', refreshDerivedState);
  btnRefresh.addEventListener('click', loadEvents);
  if (btnOpenDashboard) btnOpenDashboard.addEventListener('click', openDashboard);
  btnOptions.addEventListener('click', openOptions);
  btnClear.addEventListener('click', clearEvents);
  btnGenerateReport.addEventListener('click', generateReport);
  if (btnStartFlow) btnStartFlow.addEventListener('click', startFlow);
  if (btnStopFlow) btnStopFlow.addEventListener('click', stopFlow);
  if (btnGenerateFlow) btnGenerateFlow.addEventListener('click', generateFlowReport);
  [flowSku, flowCustomer, flowAddress, flowDeliveryType, flowNotes]
    .filter(Boolean)
    .forEach((input) => input.addEventListener('change', persistFlowInputs));
  btnCopyReport.addEventListener('click', copyReport);
  btnEmailReport.addEventListener('click', emailReport);
  btnCloseReport.addEventListener('click', closeReport);
  btnExportJson.addEventListener('click', exportJson);
  btnExportCsv.addEventListener('click', exportCsv);
  btnCopyLatestId.addEventListener('click', () => latestEvent && copyEvent(latestEvent, 'id'));
  btnCopyLatestNote.addEventListener('click', () => latestEvent && copyEvent(latestEvent, 'note'));
  eventsBody.addEventListener('click', handleTableClick);
  getExtensionApi().runtime.onMessage.addListener(onMessage);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}