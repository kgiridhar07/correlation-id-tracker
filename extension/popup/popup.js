/**
 * @fileoverview Popup controller — wires up UI controls, loads events,
 * handles search/filter, export, copy, and live updates from the background.
 */

import { MSG, UI } from '../utils/constants.js';
import { debounce } from '../utils/helpers.js';
import { initRenderer, renderEvents, prependEvent } from './tableRenderer.js';

// ── DOM References ───────────────────────────────────────────────────────────

const searchInput = document.getElementById('searchInput');
const btnRefresh = document.getElementById('btnRefresh');
const btnClear = document.getElementById('btnClear');
const btnExportJson = document.getElementById('btnExportJson');
const btnExportCsv = document.getElementById('btnExportCsv');
const eventsBody = document.getElementById('eventsBody');
const emptyState = document.getElementById('emptyState');
const statusText = document.getElementById('statusText');

// ── State ────────────────────────────────────────────────────────────────────

/** Full event list cached in popup (newest first) */
let allEvents = [];

// ── Filtering ────────────────────────────────────────────────────────────────

function applyFilter() {
  const query = (searchInput.value || '').toLowerCase().trim();
  if (!query) {
    renderEvents(allEvents);
    return;
  }
  const filtered = allEvents.filter((evt) =>
    evt.correlationId.toLowerCase().includes(query) ||
    evt.url.toLowerCase().includes(query) ||
    (evt.method || '').toLowerCase().includes(query) ||
    (evt.sourceType || '').toLowerCase().includes(query)
  );
  renderEvents(filtered);
}

const debouncedFilter = debounce(applyFilter, UI.DEBOUNCE_MS);

// ── Init ─────────────────────────────────────────────────────────────────────

initRenderer(eventsBody, emptyState);
loadEvents();
attachListeners();

// ── Data Loading ─────────────────────────────────────────────────────────────

async function loadEvents() {
  setStatus('Loading...');
  try {
    const response = await sendMessage({ type: MSG.GET_EVENTS, limit: UI.MAX_VISIBLE_ROWS });
    if (response && response.success) {
      allEvents = response.data;
      applyFilter();
      setStatus(`${allEvents.length} events loaded`);
    } else {
      setStatus('Failed to load events');
    }
  } catch (err) {
    setStatus('Error: ' + err.message);
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

async function exportJson() {
  setStatus('Exporting JSON...');
  const response = await sendMessage({ type: MSG.EXPORT_EVENTS });
  if (!response || !response.success) { setStatus('Export failed'); return; }

  const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `correlation-events-${Date.now()}.json`);
  setStatus('JSON exported');
}

async function exportCsv() {
  setStatus('Exporting CSV...');
  const response = await sendMessage({ type: MSG.EXPORT_EVENTS });
  if (!response || !response.success) { setStatus('Export failed'); return; }

  const header = 'timestamp,requestId,method,url,correlationId,sourceType,tabId\n';
  const rows = response.data.map((e) =>
    [
      new Date(e.timestamp).toISOString(),
      e.requestId,
      e.method,
      `"${(e.url || '').replace(/"/g, '""')}"`,
      e.correlationId,
      e.sourceType,
      e.tabId,
    ].join(',')
  );
  const blob = new Blob([header + rows.join('\n')], { type: 'text/csv' });
  downloadBlob(blob, `correlation-events-${Date.now()}.csv`);
  setStatus('CSV exported');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Clear ────────────────────────────────────────────────────────────────────

async function clearEvents() {
  if (!confirm('Clear all captured correlation events?')) return;
  const response = await sendMessage({ type: MSG.CLEAR_EVENTS });
  if (response && response.success) {
    allEvents = [];
    renderEvents([]);
    setStatus('Events cleared');
  }
}

// ── Copy ─────────────────────────────────────────────────────────────────────

function handleTableClick(e) {
  const btn = e.target.closest('.btn-copy');
  if (!btn) return;
  const id = btn.dataset.corrId;
  if (id) {
    navigator.clipboard.writeText(id).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
    });
  }
}

// ── Live Updates ─────────────────────────────────────────────────────────────

function onMessage(message) {
  if (!message) return;
  switch (message.type) {
    case MSG.NEW_EVENT:
      allEvents.unshift(message.data);
      // Trim to limit
      if (allEvents.length > UI.MAX_VISIBLE_ROWS) allEvents.length = UI.MAX_VISIBLE_ROWS;
      // If search is active, re-apply filter; otherwise prepend live
      if (searchInput.value.trim()) {
        debouncedFilter();
      } else {
        prependEvent(message.data);
      }
      break;
    case MSG.EVENTS_CLEARED:
      allEvents = [];
      renderEvents([]);
      setStatus('Events cleared');
      break;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      resolve(response);
    });
  });
}

function setStatus(text) {
  if (statusText) statusText.textContent = text;
}

// ── Event Wiring ─────────────────────────────────────────────────────────────

function attachListeners() {
  searchInput.addEventListener('input', debouncedFilter);
  btnRefresh.addEventListener('click', loadEvents);
  btnClear.addEventListener('click', clearEvents);
  btnExportJson.addEventListener('click', exportJson);
  btnExportCsv.addEventListener('click', exportCsv);
  eventsBody.addEventListener('click', handleTableClick);
  chrome.runtime.onMessage.addListener(onMessage);
}
