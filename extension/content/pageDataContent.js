(function () {
  const CONTENT_SOURCE = 'CID_TRACKER_CONTENT';
  const PAGE_SOURCE = 'CID_TRACKER_PAGE';
  const BRIDGE_ID = 'cid-tracker-page-data-bridge';
  const DEFAULT_POLL_MS = 1000;
  const DEFAULT_DURATION_SECONDS = 120;
  const DOM_WATCHERS = Object.freeze([
    { label: 'Quote ID', selector: '[data-testid="order-number"]' },
    { label: 'SKU', selector: '[data-testid="product-description__sku-number"]' },
    { label: 'Customer', selector: '.customer-card__name .pal--type-style-05' },
    {
      label: 'Address',
      selector: '[data-testid="fulfillment-steps"]',
      labelSelector: '.label',
      labelText: 'delivery address',
      valueSelector: '.description',
    },
    {
      label: 'Delivery Type',
      selector: '[data-testid="fulfillment-steps"]',
      labelSelector: '.label',
      labelText: 'delivery options',
      valueSelector: '.description',
    },
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

    if (!shouldCaptureDom(location.href, activeConfig) && !shouldCapturePageGlobals(location.href, activeConfig)) return;
    if (shouldCapturePageGlobals(location.href, activeConfig)) ensureBridge();
    scanOnce();

    activeTimer = setInterval(scanOnce, activeConfig.pageDataPollMs || DEFAULT_POLL_MS);
    const captureSeconds = Math.max(activeConfig.pageDataDurationSeconds || DEFAULT_DURATION_SECONDS, DEFAULT_DURATION_SECONDS);
    stopTimer = setTimeout(stopCapture, captureSeconds * 1000);
  }

  function stopCapture() {
    if (activeTimer) clearInterval(activeTimer);
    if (stopTimer) clearTimeout(stopTimer);
    activeTimer = null;
    stopTimer = null;
    lastValues = new Map();
  }

  function shouldCapture(url, config) {
    return shouldCaptureDom(url, config) || shouldCapturePageGlobals(url, config);
  }

  function shouldCaptureDom(_url, _config) {
    return DOM_WATCHERS.length > 0;
  }

  function shouldCapturePageGlobals(url, config) {
    const watchers = config && Array.isArray(config.pageDataWatchers) ? config.pageDataWatchers : [];
    if (!watchers.length) return false;
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
    if (shouldCaptureDom(location.href, activeConfig)) {
      scanDomWatchers().catch(() => undefined);
    }
    if (shouldCapturePageGlobals(location.href, activeConfig)) {
      window.postMessage({
        source: CONTENT_SOURCE,
        type: 'SCAN_PAGE_DATA',
        requestId: `scan-${Date.now()}-${scanSequence++}`,
        watchers: activeConfig.pageDataWatchers,
      }, '*');
    }
  }

  async function scanDomWatchers() {
    for (const watcher of DOM_WATCHERS) {
      const value = readDomWatcherValue(watcher);
      if (!value) continue;

      const path = buildDomWatcherPath(watcher);
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

  function readDomWatcherValue(watcher) {
    if (watcher.labelText && watcher.valueSelector) {
      const containers = document.querySelectorAll(watcher.selector);
      for (const container of containers) {
        const label = container.querySelector(watcher.labelSelector || '.label');
        const labelText = normalizeText(label ? label.textContent : '');
        if (!labelText.toLowerCase().includes(watcher.labelText)) continue;
        const valueElement = container.querySelector(watcher.valueSelector);
        const value = normalizeText(valueElement ? valueElement.textContent : '');
        if (value) return value;
      }
      return '';
    }

    const element = document.querySelector(watcher.selector);
    return normalizeText(element ? element.textContent : '');
  }

  function buildDomWatcherPath(watcher) {
    if (watcher.labelText && watcher.valueSelector) {
      return `dom:${watcher.selector}|label:${watcher.labelText}|value:${watcher.valueSelector}`;
    }
    return `dom:${watcher.selector}`;
  }

  function normalizeText(value) {
    const normalized = String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return /^[-\s]+$/.test(normalized) ? '' : normalized;
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