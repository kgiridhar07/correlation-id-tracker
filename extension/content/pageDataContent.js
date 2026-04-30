(function () {
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

    if (!shouldCaptureDom(location.href, activeConfig)) return;
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
    return shouldCaptureDom(url, config);
  }

  function shouldCaptureDom(_url, _config) {
    return DOM_WATCHERS.length > 0;
  }

  function scanOnce() {
    if (!activeConfig || !shouldCapture(location.href, activeConfig)) return;
    if (shouldCaptureDom(location.href, activeConfig)) {
      scanDomWatchers().catch(() => undefined);
    }
  }

  async function scanDomWatchers() {
    for (const watcher of DOM_WATCHERS) {
      const path = buildDomWatcherPath(watcher);
      const values = readDomWatcherValues(watcher);
      for (const value of values) {
        const key = `${location.href}|${path}|${value}`;
        if (lastValues.get(key) === true) continue;
        lastValues.set(key, true);

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
  }

  function readDomWatcherValues(watcher) {
    if (watcher.labelText && watcher.valueSelector) {
      const containers = document.querySelectorAll(watcher.selector);
      for (const container of containers) {
        const label = container.querySelector(watcher.labelSelector || '.label');
        const labelText = normalizeText(label ? label.textContent : '');
        if (!labelText.toLowerCase().includes(watcher.labelText)) continue;
        const valueElement = container.querySelector(watcher.valueSelector);
        const value = normalizeText(valueElement ? valueElement.textContent : '');
        if (value) return [value];
      }
      return [];
    }

    const values = [];
    const seen = new Set();
    const elements = document.querySelectorAll(watcher.selector);
    for (const element of elements) {
      const value = normalizeText(element ? element.textContent : '');
      if (!value || seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
    return values;
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