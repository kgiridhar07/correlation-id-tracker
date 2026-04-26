/**
 * @fileoverview Table rendering logic for the popup.
 * Builds DOM rows from CorrelationEvent data with virtual-window limiting.
 */

import { formatTimestamp, getEventKey, getHostname, truncateUrl } from '../utils/helpers.js';
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
    fragment.appendChild(createRow(evt));
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

  const tr = createRow(evt);

  // Highlight animation
  tr.classList.add('row-new');
  setTimeout(() => tr.classList.remove('row-new'), 1500);

  tbody.insertBefore(tr, tbody.firstChild);

  if (emptyState) emptyState.hidden = true;
}

function createRow(evt) {
  const tr = document.createElement('tr');
  tr.dataset.eventKey = getEventKey(evt);

  const cells = [
    { text: formatTimestamp(evt.timestamp), cls: 'cell-time' },
    { text: evt.method || '-', cls: 'cell-method' },
    { text: getHostname(evt.url) || '-', cls: 'cell-domain', title: getHostname(evt.url) },
    { text: truncateUrl(evt.url), cls: 'cell-url', title: evt.url },
    { text: evt.correlationId, cls: 'cell-corr-id', title: evt.correlationId },
    { text: String(evt.duplicateCount || 1), cls: 'cell-count' },
    { text: evt.sourceType, cls: 'cell-source' },
  ];

  for (const cell of cells) {
    const td = document.createElement('td');
    td.textContent = cell.text;
    td.className = cell.cls;
    if (cell.title) td.title = cell.title;
    tr.appendChild(td);
  }

  const tdActions = document.createElement('td');
  tdActions.className = 'cell-actions';
  tdActions.appendChild(createCopyButton('ID', 'id', evt));
  tdActions.appendChild(createCopyButton('Note', 'note', evt));
  tdActions.appendChild(createCopyButton('JSON', 'json', evt));
  tr.appendChild(tdActions);
  return tr;
}

function createCopyButton(label, format, evt) {
  const button = document.createElement('button');
  button.textContent = label;
  button.className = 'btn-copy';
  button.dataset.copyFormat = format;
  button.dataset.eventKey = getEventKey(evt);
  return button;
}
