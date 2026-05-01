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
  const AUTOMATION_KEYWORDS = Object.freeze(['order', 'quote', 'sku', 'product', 'customer', 'address', 'delivery', 'fulfillment']);
  const DANGEROUS_CLICK_TEXT = Object.freeze(['submit', 'confirm', 'place order', 'checkout', 'pay', 'payment', 'purchase', 'reserve', 'delete', 'remove', 'cancel', 'sign out', 'logout']);
  const AUTOMATION_SELECTOR = [
    'button',
    'a',
    'summary',
    '[role="button"]',
    '[role="tab"]',
    '[aria-controls]',
    '[data-testid]',
  ].join(',');
  let activeTimer = null;
  let stopTimer = null;
  let activeConfig = null;
  let lastValues = new Map();
  let lastUrl = location.href;
  let scanSequence = 0;

  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'CONFIG_UPDATED') {
      loadAndStart();
    }
    if (message && message.type === 'RUN_ORDER_AUTOMATION') {
      if (typeof sendResponse !== 'function') {
        return runOrderAutomation()
          .then((result) => ({ success: true, ...result }))
          .catch((err) => ({ success: false, error: err.message }));
      }
      runOrderAutomation()
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (message && message.type === 'RUN_ORDER_WORKFLOW') {
      if (typeof sendResponse !== 'function') {
        return runOrderWorkflow(message.data || {})
          .then((result) => ({ success: true, ...result }))
          .catch((err) => ({ success: false, error: err.message }));
      }
      runOrderWorkflow(message.data || {})
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
    return undefined;
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
    let capturedCount = 0;
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
        capturedCount++;
      }
    }
    return capturedCount;
  }

  async function runOrderAutomation() {
    if (!activeConfig) {
      const response = await sendRuntimeMessage({ type: 'GET_CONFIG' });
      if (response && response.success) activeConfig = response.data;
    }

    const clickedLabels = [];
    let capturedCount = await scanDomWatchers();
    const candidates = getAutomationCandidates().slice(0, 24);

    for (const candidate of candidates) {
      candidate.element.scrollIntoView({ block: 'center', inline: 'nearest' });
      await wait(150);
      candidate.element.click();
      clickedLabels.push(candidate.label);
      await wait(650);
      capturedCount += await scanDomWatchers();
    }

    return {
      clickedCount: clickedLabels.length,
      capturedCount,
      clickedLabels,
    };
  }

  async function runOrderWorkflow(data) {
    const sku = normalizeText(data.sku);
    const customer = normalizeText(data.customer);
    if (!sku || !customer) throw new Error('SKU and customer are required');

    if (!activeConfig) {
      const response = await sendRuntimeMessage({ type: 'GET_CONFIG' });
      if (response && response.success) activeConfig = response.data;
    }

    const steps = [];
    await recordWorkflowStep(steps, 'Search SKU', () => searchForValue(sku, ['sku', 'search', 'product', 'item'], 'skuSearchInput'));
    await recordWorkflowStep(steps, 'Select SKU', () => clickFirstMatch([sku, 'select', 'view details'], { selectorKey: 'skuResult', preferText: sku }));
    await recordWorkflowStep(steps, 'Add To Cart', () => clickFirstMatch(['add to cart', 'add item', 'add'], { selectorKey: 'addToCartButton', requireAny: ['cart', 'add'] }));
    await recordWorkflowStep(steps, 'View Cart', () => clickFirstMatch(['view cart', 'cart'], { selectorKey: 'viewCartButton' }));
    await recordWorkflowStep(steps, 'Select Customer', () => clickFirstMatch(['select customer', 'customer'], { selectorKey: 'selectCustomerButton' }));
    await recordWorkflowStep(steps, 'Search Customer', () => searchForValue(customer, ['customer', 'search', 'name'], 'customerSearchInput'));
    await recordWorkflowStep(steps, 'Choose Customer', () => clickFirstMatch([customer, 'select customer', 'select'], { selectorKey: 'customerResult', preferText: customer }));
    await recordWorkflowStep(steps, 'Delivery Option', () => clickFirstMatch(['delivery option', 'delivery options', 'delivery'], { selectorKey: 'deliveryOptionsButton' }));
    await recordWorkflowStep(steps, 'Schedule Delivery', () => clickFirstMatch(['schedule delivery', 'schedule'], { selectorKey: 'scheduleDeliveryButton' }));

    const capturedCount = await scanDomWatchers();
    return { steps, capturedCount };
  }

  async function recordWorkflowStep(steps, label, action) {
    try {
      const detail = await action();
      await wait(900);
      const capturedCount = await scanDomWatchers();
      steps.push({ label, success: true, detail, capturedCount });
    } catch (err) {
      steps.push({ label, success: false, error: err.message });
    }
  }

  async function searchForValue(value, hints, selectorKey) {
    const input = findConfiguredElement(selectorKey, { inputOnly: true }) || findBestSearchInput(hints);
    if (!input) throw new Error(`Could not find search input for ${value}`);
    focusAndSetValue(input, value);
    await wait(250);
    pressEnter(input);
    return getElementLabel(input) || input.getAttribute('placeholder') || 'search input';
  }

  function findBestSearchInput(hints) {
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"], [role="textbox"]'));
    const visibleInputs = inputs.filter((input) => isVisible(input) && !isDisabled(input));
    if (!visibleInputs.length) return null;

    const scored = visibleInputs.map((input) => ({ input, score: scoreInput(input, hints) }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].input;
  }

  function scoreInput(input, hints) {
    const label = getElementLabel(input).toLowerCase();
    let score = 0;
    if (label.includes('search')) score += 20;
    for (const hint of hints) {
      if (label.includes(hint)) score += 10;
    }
    if (input === document.activeElement) score += 4;
    if (!input.value) score += 2;
    return score;
  }

  function focusAndSetValue(input, value) {
    input.scrollIntoView({ block: 'center', inline: 'nearest' });
    input.focus();
    if (input.isContentEditable) {
      input.textContent = value;
    } else {
      setNativeInputValue(input, value);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setNativeInputValue(input, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(input, 'value') && Object.getOwnPropertyDescriptor(input, 'value').set;
    const prototype = Object.getPrototypeOf(input);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value') && Object.getOwnPropertyDescriptor(prototype, 'value').set;
    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(input, value);
      return;
    }
    if (valueSetter) {
      valueSetter.call(input, value);
      return;
    }
    input.value = value;
  }

  function pressEnter(element) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  }

  async function clickFirstMatch(texts, options = {}) {
    const element = findConfiguredElement(options.selectorKey, { preferText: options.preferText }) || findClickableByText(texts, options);
    if (!element) throw new Error(`Could not find ${texts.join(' or ')}`);
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    await wait(150);
    element.click();
    return getElementLabel(element);
  }

  function findConfiguredElement(selectorKey, options = {}) {
    const selectors = getConfiguredSelectors(selectorKey);
    if (!selectors.length) return null;

    const matches = [];
    for (const selector of selectors) {
      try {
        matches.push(...document.querySelectorAll(selector));
      } catch (_err) {
        // Ignore invalid user-configured selectors and continue to fallbacks.
      }
    }

    const candidates = matches
      .map((element) => options.inputOnly ? element : getClickableElement(element))
      .filter(Boolean)
      .filter((element, index, all) => all.indexOf(element) === index)
      .filter((element) => isVisible(element) && !isDisabled(element));
    if (!candidates.length) return null;

    const preferText = String(options.preferText || '').toLowerCase();
    if (!preferText) return candidates[0];

    return candidates
      .map((element) => ({ element, score: getElementLabel(element).toLowerCase().includes(preferText) ? 1 : 0 }))
      .sort((a, b) => b.score - a.score)[0].element;
  }

  function getConfiguredSelectors(selectorKey) {
    const selectors = activeConfig && Array.isArray(activeConfig.orderAutomationSelectors)
      ? activeConfig.orderAutomationSelectors
      : [];
    const item = selectors.find((entry) => entry.key === selectorKey);
    return item && Array.isArray(item.selectors) ? item.selectors.filter(Boolean) : [];
  }

  function findClickableByText(texts, options = {}) {
    const normalizedTexts = texts.map((text) => text.toLowerCase());
    const candidates = Array.from(document.querySelectorAll(AUTOMATION_SELECTOR))
      .map(getClickableElement)
      .filter(Boolean)
      .filter((element, index, all) => all.indexOf(element) === index)
      .filter((element) => isVisible(element) && !isDisabled(element));

    const scored = [];
    for (const element of candidates) {
      const label = getElementLabel(element).toLowerCase();
      if (!label) continue;
      if (isDangerousWorkflowClick(label)) continue;
      if (options.requireAny && !options.requireAny.some((text) => label.includes(text))) continue;
      const score = scoreClickable(label, normalizedTexts, options.preferText);
      if (score > 0) scored.push({ element, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.length ? scored[0].element : null;
  }

  function scoreClickable(label, texts, preferText) {
    let score = 0;
    for (const text of texts) {
      if (!text) continue;
      if (label === text) score += 100;
      else if (label.includes(text)) score += 40;
    }
    const normalizedPreferText = String(preferText || '').toLowerCase();
    if (normalizedPreferText && label.includes(normalizedPreferText)) score += 80;
    return score;
  }

  function isDangerousWorkflowClick(label) {
    const blocked = ['place order', 'submit order', 'confirm order', 'pay', 'payment', 'purchase', 'delete', 'remove', 'cancel', 'sign out', 'logout'];
    return blocked.some((keyword) => label.includes(keyword));
  }

  function getAutomationCandidates() {
    const candidates = [];
    const seen = new Set();
    const elements = document.querySelectorAll(AUTOMATION_SELECTOR);

    for (const element of elements) {
      const clickable = getClickableElement(element);
      if (!clickable || seen.has(clickable)) continue;
      const label = getElementLabel(clickable);
      const normalizedLabel = label.toLowerCase();
      if (!normalizedLabel || !isVisible(clickable) || isDisabled(clickable)) continue;
      if (!AUTOMATION_KEYWORDS.some((keyword) => normalizedLabel.includes(keyword))) continue;
      if (DANGEROUS_CLICK_TEXT.some((keyword) => normalizedLabel.includes(keyword))) continue;
      seen.add(clickable);
      candidates.push({ element: clickable, label: label.slice(0, 80) });
    }

    return candidates.sort((a, b) => getAutomationPriority(a.label) - getAutomationPriority(b.label));
  }

  function getClickableElement(element) {
    return element.closest('button, a, summary, [role="button"], [role="tab"], [aria-controls], [tabindex]') || element;
  }

  function getElementLabel(element) {
    return normalizeText([
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-testid'),
      element.getAttribute('placeholder'),
      element.getAttribute('name'),
      element.id,
      element.textContent,
    ].filter(Boolean).join(' '));
  }

  function getAutomationPriority(label) {
    const normalizedLabel = label.toLowerCase();
    const index = AUTOMATION_KEYWORDS.findIndex((keyword) => normalizedLabel.includes(keyword));
    return index === -1 ? AUTOMATION_KEYWORDS.length : index;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function isDisabled(element) {
    return element.disabled || element.getAttribute('aria-disabled') === 'true';
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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