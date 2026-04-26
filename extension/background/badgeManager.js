/**
 * @fileoverview Toolbar badge updates for newly captured events.
 */

import { getExtensionApi } from '../utils/browserApi.js';

let newEventCount = 0;

function getActionApi() {
  const api = getExtensionApi();
  return api.action || api.browserAction;
}

function updateBadge() {
  const action = getActionApi();
  if (!action) return;

  const text = newEventCount > 0 ? String(Math.min(newEventCount, 999)) : '';
  action.setBadgeText({ text });
  action.setBadgeBackgroundColor({ color: '#0e639c' });
}

export function incrementBadge() {
  newEventCount++;
  updateBadge();
}

export function clearBadge() {
  newEventCount = 0;
  updateBadge();
}
