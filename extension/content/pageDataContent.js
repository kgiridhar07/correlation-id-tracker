(function () {
  const CONTENT_SOURCE = 'CID_TRACKER_CONTENT';
  const PAGE_SOURCE = 'CID_TRACKER_PAGE';
  const BRIDGE_ID = 'cid-tracker-page-data-bridge';
  const DEFAULT_POLL_MS = 1000;
  const DEFAULT_DURATION_SECONDS = 30;
  const DOM_WATCHERS = Object.freeze([
    { label: 'Quote ID', selector: '[data-testid="order-number"]' },
  ]);

  const extensionApi = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : chrome;
  const runtime = extensionApi.runtime;
  let activeTimer = null;
  let stopTimer = null;
  let activeConfig = null;
  let lastValues = new Map();
  let lastUrl = location.href;
  let scanSequence = 0;

  window.addEventListener('message', onPageMessage);
  runtime.onMessage.addListener((message) => {
    if (message && message.type === 'CONFIG_UPDATED') {
      loadAndStart();
    }
  });

  loadAndStart();
  setInterval(checkUrlChange, 1000);

  async function loadAndStart() {
    stopCapture();
    const response = await sendRuntimeMessage({ type: 'GET_CONFIG' });
    if (!response || !response.success) return;
    activeConfig = response.data;

    if (!shouldCapture(location.href, activeConfig)) return;
    ensureBridge();
    scanOnce();

    activeTimer = setInterval(scanOnce, activeConfig.pageDataPollMs || DEFAULT_POLL_MS);
    stopTimer = setTimeout(stopCapture, (activeConfig.pageDataDurationSeconds || DEFAULT_DURATION_SECONDS) * 1000);
  }

  function stopCapture() {
    if (activeTimer) clearInterval(activeTimer);
    if (stopTimer) clearTimeout(stopTimer);
    activeTimer = null;
    stopTimer = null;
    lastValues = new Map();
  }

  function shouldCapture(url, config) {
    const watchers = config && Array.isArray(config.pageDataWatchers) ? config.pageDataWatchers : [];
    if (!watchers.length && DOM_WATCHERS.length === 0) return false;
    const lowerUrl = String(url || '').toLowerCase();
    const filters = Array.isArray(config.urlFilters) ? config.urlFilters : [];
    return filters.some((filter) => lowerUrl.includes(String(filter).toLowerCase()));
  }

  function ensureBridge() {
    if (document.getElementById(BRIDGE_ID)) return;
    const script = document.createElement('script');
    script.id = BRIDGE_ID;
    script.src = runtime.getURL('content/pageDataBridge.js');
    script.onload = () => script.remove();
    (document.documentElement || document.head || document.body).appendChild(script);
  }

  function scanOnce() {
    if (!activeConfig || !shouldCapture(location.href, activeConfig)) return;
    scanDomWatchers().catch(() => undefined);
    window.postMessage({
      source: CONTENT_SOURCE,
      type: 'SCAN_PAGE_DATA',
      requestId: `scan-${Date.now()}-${scanSequence++}`,
      watchers: activeConfig.pageDataWatchers,
    }, '*');
  }

  async function scanDomWatchers() {
    for (const watcher of DOM_WATCHERS) {
      const element = document.querySelector(watcher.selector);
      const value = element ? String(element.textContent || '').replace(/\u00a0/g, ' ').trim() : '';
      if (!value) continue;

      const path = `dom:${watcher.selector}`;
      const key = `${location.href}|${path}|${value}`;
      if (lastValues.get(path) === key) continue;
      lastValues.set(path, key);

      await sendRuntimeMessage({
        type: 'CAPTURE_PAGE_DATA',
        data: {
          requestId: `dom-${Date.now()}-${scanSequence++}`,
          url: location.href,
          label: watcher.label,
          path,
          value,
          valueType: 'dom-text',
        },
      });
    }
  }

  function checkUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    loadAndStart();
  }

  async function onPageMessage(event) {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== PAGE_SOURCE || message.type !== 'PAGE_DATA_RESULT') return;

    for (const item of message.values || []) {
      const key = `${location.href}|${item.path}|${item.value}`;
      if (lastValues.get(item.path) === key) continue;
      lastValues.set(item.path, key);

      await sendRuntimeMessage({
        type: 'CAPTURE_PAGE_DATA',
        data: {
          requestId: `${message.requestId}-${item.path}`,
          url: location.href,
          label: item.label,
          path: item.path,
          value: item.value,
          valueType: item.valueType,
        },
      });
    }
  }

  function sendRuntimeMessage(message) {
    try {
      if (globalThis.browser && globalThis.browser.runtime) {
        return runtime.sendMessage(message);
      }
      return new Promise((resolve) => {
        runtime.sendMessage(message, (response) => {
          const lastError = runtime.lastError;
          resolve(lastError ? undefined : response);
        });
      });
    } catch (_err) {
      return Promise.resolve(undefined);
    }
  }
}());