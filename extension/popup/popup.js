/**
 * @fileoverview Popup controller for search, filters, export, copy, and live updates.
 */

import { MSG, UI } from '../utils/constants.js';
import { getExtensionApi, sendRuntimeMessage } from '../utils/browserApi.js';
import { csvEscape, enrichDuplicateCounts } from '../utils/dataUtils.js';
import { debounce, formatTimestamp, getEventKey, getHostname } from '../utils/helpers.js';
import { buildOrderFlowRows } from '../utils/flowUtils.js';
import { initRenderer, renderEvents, prependEvent } from './tableRenderer.js';

const FLOW_STORAGE_KEY = 'correlationTrackerOrderFlow';

const searchInput = document.getElementById('searchInput') || fallbackInput('');
const sourceFilter = document.getElementById('sourceFilter') || fallbackInput('all');
const methodFilter = document.getElementById('methodFilter') || fallbackInput('all');
const domainFilter = document.getElementById('domainFilter') || fallbackInput('all');
const timeFilter = document.getElementById('timeFilter') || fallbackInput('all');
const duplicateOnly = document.getElementById('duplicateOnly') || fallbackCheckbox(false);
const collapseDuplicates = document.getElementById('collapseDuplicates') || fallbackCheckbox(false);
const btnRefresh = document.getElementById('btnRefresh');
const btnOpenDashboard = document.getElementById('btnOpenDashboard');
const btnOptions = document.getElementById('btnOptions');
const btnClear = document.getElementById('btnClear');
const btnGenerateReport = document.getElementById('btnGenerateReport');
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
const orderFlowBody = document.getElementById('orderFlowBody');
const orderFlowEmpty = document.getElementById('orderFlowEmpty');
const eventsBody = document.getElementById('eventsBody');
const emptyState = document.getElementById('emptyState');
const statusText = document.getElementById('statusText');
const statsText = document.getElementById('statsText');

let allEvents = [];
let visibleEvents = [];
let latestEvent = null;
let eventMap = new Map();
let currentReport = null;
let flowState = loadStoredFlowState();
let activeOrderFlowMilestones = [];
let currentOrderFlowRows = [];
let selectedFlowRows = new Set();
const hasRawEventTable = Boolean(eventsBody);

function fallbackInput(value) {
  return {
    value,
    textContent: '',
    addEventListener: () => {},
    appendChild: () => {},
  };
}

function fallbackCheckbox(checked) {
  return {
    checked,
    addEventListener: () => {},
  };
}

async function loadEvents() {
  setStatus('Loading...');
  try {
    const [eventsResponse, configResponse] = await Promise.all([
      sendMessage({ type: MSG.EXPORT_EVENTS }),
      sendMessage({ type: MSG.GET_CONFIG }),
    ]);

    if (configResponse && configResponse.success) {
      activeOrderFlowMilestones = configResponse.data.orderFlowMilestones || [];
    }

    if (eventsResponse && eventsResponse.success) {
      allEvents = eventsResponse.data || [];
      latestEvent = allEvents[0] || null;
      refreshDerivedState();
      updateLatestPanel();
      setStatus(`${allEvents.length} events loaded`);
    } else {
      setStatus('Failed to load events');
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
  eventMap = new Map(visibleEvents.map((event) => [getEventKey(event), event]));
  if (hasRawEventTable) renderEvents(visibleEvents);
  renderOrderFlowRows();
  updateStats();
}

function renderOrderFlowRows() {
  if (!orderFlowBody) return;
  currentOrderFlowRows = buildOrderFlowRows(allEvents, flowState, activeOrderFlowMilestones);
  orderFlowBody.textContent = '';

  for (const row of currentOrderFlowRows) {
    const tableRow = document.createElement('tr');
    const rowKey = getFlowRowKey(row);
    tableRow.dataset.flowRowKey = rowKey;

    const selectCell = document.createElement('td');
    selectCell.className = 'flow-select';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'flow-row-select';
    checkbox.checked = selectedFlowRows.has(rowKey);
    checkbox.setAttribute('aria-label', `Select order flow ${row.orderTrackingId || row.quoteId || rowKey}`);
    selectCell.appendChild(checkbox);
    tableRow.appendChild(selectCell);

    [
      { value: formatFlowTimestamp(row.lastUpdated), className: 'flow-time' },
      { value: row.orderTrackingId, className: 'flow-code' },
      { value: row.quoteId, className: 'flow-code' },
      { value: row.sku, className: 'flow-sku' },
      { value: row.customer, className: 'flow-text' },
      { value: row.address, className: 'flow-wide' },
      { value: row.deliveryType, className: 'flow-text' },
      { value: row.sourcingOptions && row.sourcingOptions.correlationId, className: 'flow-code flow-corr' },
      { value: row.capacity && row.capacity.correlationId, className: 'flow-code flow-corr' },
      { value: row.reserveDelivery && row.reserveDelivery.correlationId, className: 'flow-code flow-corr' },
    ].forEach(({ value, className }) => {
      const cell = document.createElement('td');
      cell.textContent = value || '-';
      cell.className = value ? className : 'flow-missing';
      if (value) cell.title = value;
      tableRow.appendChild(cell);
    });
    orderFlowBody.appendChild(tableRow);
  }

  if (orderFlowEmpty) orderFlowEmpty.hidden = currentOrderFlowRows.length > 0;
  if (flowStatus) flowStatus.textContent = currentOrderFlowRows.length
    ? `${currentOrderFlowRows.length} stitched order flow${currentOrderFlowRows.length === 1 ? '' : 's'} - select rows for Report, JSON, or CSV`
    : 'Clear, run the order, then review the stitched row.';
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
  if (!select || typeof select.appendChild !== 'function') return;
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
  const rows = getSelectedFlowRows();
  const payload = {
    metadata: buildFlowExportMetadata(rows),
    orderFlows: rows.map(flowRowToRecord),
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `order-flow-${Date.now()}.json`);
  setStatus('JSON exported');
}

async function exportCsv() {
  setStatus('Exporting CSV...');
  const rows = getSelectedFlowRows();
  const metadata = buildFlowExportMetadata(rows);
  const header = getFlowHeaders().join(',') + '\n';
  const csvRows = rows.map((row) => flowRowToValues(row).map(csvEscape).join(','));
  const preface = [
    `# exportedAt=${metadata.exportedAt}`,
    `# exportDate=${metadata.exportDate}`,
    `# selectedRows=${metadata.selectedRows}`,
  ].join('\n');
  downloadBlob(new Blob([preface + '\n' + header + csvRows.join('\n')], { type: 'text/csv' }), `order-flow-${Date.now()}.csv`);
  setStatus('CSV exported');
}

function buildFlowExportMetadata(rows) {
  const now = new Date();
  return {
    tool: 'Correlation ID Tracker',
    version: getExtensionApi().runtime.getManifest().version,
    exportedAt: now.toISOString(),
    exportDate: now.toLocaleDateString('en-US'),
    selectedRows: rows.length,
  };
}

async function generateReport() {
  const rows = getSelectedFlowRows();
  const body = buildOrderFlowTableText(rows);
  currentReport = {
    subject: `Order Flow Report - ${new Date().toLocaleDateString('en-US')}`,
    body,
    truncatedBody: body,
  };
  reportPreview.value = body;
  reportMeta.textContent = `${rows.length} order flow row${rows.length === 1 ? '' : 's'} included. Select rows in the table to control Report, JSON, and CSV.`;
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

async function generateFlowReport() {
  flowState = readFlowInputs();
  saveFlowState();
  renderOrderFlowRows();
  const rows = getSelectedFlowRows();
  const report = buildOrderFlowTableText(rows);
  currentReport = {
    subject: 'Order Flow Rows',
    body: report,
    truncatedBody: report,
  };
  await navigator.clipboard.writeText(report);
  reportPreview.value = report;
  reportMeta.textContent = `${rows.length} order flow row${rows.length === 1 ? '' : 's'} copied.`;
  reportPanel.hidden = false;
  setStatus('Flow copied');
}

function buildOrderFlowTableText(rows) {
  const headers = ['Timestamp', 'Date', 'Order Tracking ID', 'Quote', 'SKU', 'Customer', 'Address', 'Delivery', 'Sourcing Corr', 'Capacity Corr', 'Reserve Corr'];
  const lines = [headers.join('\t')];
  for (const row of rows) {
    lines.push(flowRowToValues(row).map((value) => value || '-').join('\t'));
  }
  return lines.join('\n');
}

function getSelectedFlowRows() {
  const selectedRows = currentOrderFlowRows.filter((row) => selectedFlowRows.has(getFlowRowKey(row)));
  return selectedRows.length ? selectedRows : currentOrderFlowRows;
}

function getFlowRowKey(row) {
  return [row.orderTrackingId, row.quoteId, row.firstSeen, row.lastUpdated].join('|');
}

function getFlowHeaders() {
  return ['timestamp', 'date', 'orderTrackingId', 'quoteId', 'sku', 'customer', 'address', 'delivery', 'sourcingCorr', 'capacityCorr', 'reserveCorr'];
}

function flowRowToValues(row) {
  return [
    row.lastUpdated ? new Date(row.lastUpdated).toISOString() : '',
    row.lastUpdated ? new Date(row.lastUpdated).toLocaleDateString('en-US') : '',
    row.orderTrackingId || '',
    row.quoteId || '',
    row.sku || '',
    row.customer || '',
    row.address || '',
    row.deliveryType || '',
    row.sourcingOptions && row.sourcingOptions.correlationId || '',
    row.capacity && row.capacity.correlationId || '',
    row.reserveDelivery && row.reserveDelivery.correlationId || '',
  ];
}

function flowRowToRecord(row) {
  const values = flowRowToValues(row);
  return Object.fromEntries(getFlowHeaders().map((header, index) => [header, values[index]]));
}

function formatFlowTimestamp(timestamp) {
  return timestamp ? formatTimestamp(timestamp) : '';
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
    const stored = JSON.parse(localStorage.getItem(FLOW_STORAGE_KEY)) || {};
    return pickFlowInputs(stored);
  } catch (_err) {
    return {};
  }
}

function saveFlowState() {
  localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(pickFlowInputs(flowState)));
}

function persistFlowInputs() {
  flowState = readFlowInputs();
  saveFlowState();
  updateFlowUi();
}

function pickFlowInputs(value) {
  return {
    sku: value.sku || '',
    customer: value.customer || '',
    address: value.address || '',
    deliveryType: value.deliveryType || '',
    notes: value.notes || '',
  };
}

function updateFlowUi() {
  if (flowSku) flowSku.value = flowState.sku || '';
  if (flowCustomer) flowCustomer.value = flowState.customer || '';
  if (flowAddress) flowAddress.value = flowState.address || '';
  if (flowDeliveryType) flowDeliveryType.value = flowState.deliveryType || '';
  if (flowNotes) flowNotes.value = flowState.notes || '';
  if (!flowStatus) return;

  renderOrderFlowRows();
}

async function clearEvents() {
  if (!confirm('Clear all captured events?')) return;
  const response = await sendMessage({ type: MSG.CLEAR_EVENTS });
  if (response && response.success) {
    allEvents = [];
    latestEvent = null;
    selectedFlowRows = new Set();
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

function handleOrderFlowChange(event) {
  const checkbox = event.target.closest('.flow-row-select');
  if (!checkbox) return;
  const tableRow = checkbox.closest('tr');
  if (!tableRow || !tableRow.dataset.flowRowKey) return;
  if (checkbox.checked) {
    selectedFlowRows.add(tableRow.dataset.flowRowKey);
  } else {
    selectedFlowRows.delete(tableRow.dataset.flowRowKey);
  }
  updateStats();
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
  if (!latestPanel) return;
  latestPanel.hidden = !latestEvent;
  if (!latestEvent) return;
  latestId.textContent = latestEvent.correlationId;
  const label = latestEvent.fieldLabel ? `${latestEvent.fieldLabel} - ` : '';
  latestMeta.textContent = `${label}${latestEvent.method || '-'} ${getHostname(latestEvent.url) || latestEvent.url} - ${latestEvent.sourceType}`;
}

function updateStats() {
  if (!statsText) return;
  const selectedCount = currentOrderFlowRows.filter((row) => selectedFlowRows.has(getFlowRowKey(row))).length;
  const selectedText = selectedCount ? `${selectedCount} selected` : 'all rows by default';
  statsText.textContent = `${currentOrderFlowRows.length} order flow row${currentOrderFlowRows.length === 1 ? '' : 's'} - ${selectedText}`;
}

function onMessage(message) {
  if (!message) return;
  switch (message.type) {
    case MSG.NEW_EVENT:
      allEvents.unshift(message.data);
      latestEvent = message.data;
      renderOrderFlowRows();
      updateLatestPanel();
      if (hasActiveFilters()) {
        debouncedRefresh();
      } else {
        const enriched = enrichDuplicateCounts(allEvents)[0];
        if (hasRawEventTable) prependEvent(enriched);
        visibleEvents.unshift(enriched);
        eventMap.set(getEventKey(enriched), enriched);
        updateStats();
      }
      break;
    case MSG.EVENTS_CLEARED:
      allEvents = [];
      latestEvent = null;
      selectedFlowRows = new Set();
      renderOrderFlowRows();
      refreshDerivedState();
      updateLatestPanel();
      setStatus('Events cleared');
      break;
    case MSG.CONFIG_UPDATED:
      activeOrderFlowMilestones = message.data && message.data.orderFlowMilestones ? message.data.orderFlowMilestones : activeOrderFlowMilestones;
      renderOrderFlowRows();
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

if (hasRawEventTable) initRenderer(eventsBody, emptyState);
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
  if (btnGenerateFlow) btnGenerateFlow.addEventListener('click', generateFlowReport);
  [flowSku, flowCustomer, flowAddress, flowDeliveryType, flowNotes]
    .filter(Boolean)
    .forEach((input) => input.addEventListener('change', persistFlowInputs));
  btnCopyReport.addEventListener('click', copyReport);
  btnEmailReport.addEventListener('click', emailReport);
  btnCloseReport.addEventListener('click', closeReport);
  btnExportJson.addEventListener('click', exportJson);
  btnExportCsv.addEventListener('click', exportCsv);
  if (btnCopyLatestId) btnCopyLatestId.addEventListener('click', () => latestEvent && copyEvent(latestEvent, 'id'));
  if (btnCopyLatestNote) btnCopyLatestNote.addEventListener('click', () => latestEvent && copyEvent(latestEvent, 'note'));
  if (eventsBody) eventsBody.addEventListener('click', handleTableClick);
  if (orderFlowBody) orderFlowBody.addEventListener('change', handleOrderFlowChange);
  getExtensionApi().runtime.onMessage.addListener(onMessage);
}