/**
 * @fileoverview Table rendering logic for the popup.
 * Builds DOM rows from CorrelationEvent data with virtual-window limiting.
 */

import { formatTimestamp, truncateUrl } from '../utils/helpers.js';
import { UI } from '../utils/constants.js';

/** @type {HTMLTableSectionElement} */
let tbody = null;

/** @type {HTMLElement} */
let emptyState = null;

/**
 * Initialise renderer with DOM references.
 * @param {HTMLTableSectionElement} tbodyEl
 * @param {HTMLElement} emptyStateEl
 */
export function initRenderer(tbodyEl, emptyStateEl) {
  tbody = tbodyEl;
  emptyState = emptyStateEl;
}

/**
 * Render an array of events into the table body.
 * Replaces all existing rows (full re-render, debounced by caller).
 * @param {Array<Object>} events — sorted newest-first
 */
export function renderEvents(events) {
  if (!tbody) return;

  // Limit visible rows for performance
  const visible = events.slice(0, UI.MAX_VISIBLE_ROWS);

  // Build document fragment to minimise reflows
  const fragment = document.createDocumentFragment();

  for (const evt of visible) {
    const tr = document.createElement('tr');

    // Timestamp
    const tdTime = document.createElement('td');
    tdTime.textContent = formatTimestamp(evt.timestamp);
    tdTime.className = 'cell-time';
    tr.appendChild(tdTime);

    // Method
    const tdMethod = document.createElement('td');
    tdMethod.textContent = evt.method || '-';
    tdMethod.className = 'cell-method';
    tr.appendChild(tdMethod);

    // URL (truncated, full in title)
    const tdUrl = document.createElement('td');
    tdUrl.textContent = truncateUrl(evt.url);
    tdUrl.title = evt.url;
    tdUrl.className = 'cell-url';
    tr.appendChild(tdUrl);

    // Correlation ID
    const tdCorrId = document.createElement('td');
    tdCorrId.textContent = evt.correlationId;
    tdCorrId.title = evt.correlationId;
    tdCorrId.className = 'cell-corr-id';
    tr.appendChild(tdCorrId);

    // Source type
    const tdSource = document.createElement('td');
    tdSource.textContent = evt.sourceType;
    tdSource.className = 'cell-source';
    tr.appendChild(tdSource);

    // Actions — copy button
    const tdActions = document.createElement('td');
    tdActions.className = 'cell-actions';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.className = 'btn-copy';
    copyBtn.dataset.corrId = evt.correlationId;
    tdActions.appendChild(copyBtn);
    tr.appendChild(tdActions);

    fragment.appendChild(tr);
  }

  tbody.textContent = ''; // clear efficiently
  tbody.appendChild(fragment);

  // Empty state toggle
  if (emptyState) {
    emptyState.hidden = visible.length > 0;
  }
}

/**
 * Append a single event row at the top of the table (live update path).
 * Falls back to full re-render if table exceeds MAX_VISIBLE_ROWS.
 * @param {Object} evt
 */
export function prependEvent(evt) {
  if (!tbody) return;

  // If already at max, remove the last row
  if (tbody.rows.length >= UI.MAX_VISIBLE_ROWS) {
    tbody.deleteRow(tbody.rows.length - 1);
  }

  const tr = document.createElement('tr');

  const cells = [
    { text: formatTimestamp(evt.timestamp), cls: 'cell-time' },
    { text: evt.method || '-', cls: 'cell-method' },
    { text: truncateUrl(evt.url), cls: 'cell-url', title: evt.url },
    { text: evt.correlationId, cls: 'cell-corr-id', title: evt.correlationId },
    { text: evt.sourceType, cls: 'cell-source' },
  ];

  for (const c of cells) {
    const td = document.createElement('td');
    td.textContent = c.text;
    td.className = c.cls;
    if (c.title) td.title = c.title;
    tr.appendChild(td);
  }

  const tdActions = document.createElement('td');
  tdActions.className = 'cell-actions';
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.className = 'btn-copy';
  copyBtn.dataset.corrId = evt.correlationId;
  tdActions.appendChild(copyBtn);
  tr.appendChild(tdActions);

  // Highlight animation
  tr.classList.add('row-new');
  setTimeout(() => tr.classList.remove('row-new'), 1500);

  tbody.insertBefore(tr, tbody.firstChild);

  if (emptyState) emptyState.hidden = true;
}
