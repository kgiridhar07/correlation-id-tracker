/**
 * @fileoverview Cross-browser WebExtension API helpers.
 * Uses Firefox's promise-based `browser` API when present and Chrome/Edge's
 * callback-based `chrome` API otherwise.
 */

const extensionApi = globalThis.browser || globalThis.chrome;
const usesBrowserPromiseApi = Boolean(globalThis.browser && extensionApi === globalThis.browser);

/**
 * Return the active WebExtension API namespace.
 * @returns {typeof chrome|typeof browser}
 */
export function getExtensionApi() {
  if (!extensionApi) {
    throw new Error('WebExtension API is not available in this context');
  }
  return extensionApi;
}

/**
 * Send a runtime message with a Promise interface in Chrome, Edge, and Firefox.
 * @param {Object} message
 * @returns {Promise<any>}
 */
export function sendRuntimeMessage(message) {
  const runtime = getExtensionApi().runtime;

  if (usesBrowserPromiseApi) {
    return runtime.sendMessage(message);
  }

  return new Promise((resolve, reject) => {
    runtime.sendMessage(message, (response) => {
      const lastError = runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Register a runtime message listener with a Promise-returning handler.
 * @param {(message: Object, sender: Object) => Promise<any>|any} handler
 */
export function addRuntimeMessageListener(handler) {
  const runtime = getExtensionApi().runtime;

  if (usesBrowserPromiseApi) {
    runtime.onMessage.addListener((message, sender) => handler(message, sender));
    return;
  }

  runtime.onMessage.addListener((message, sender, sendResponse) => {
    Promise.resolve(handler(message, sender))
      .then((response) => {
        if (response !== undefined) sendResponse(response);
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  });
}

/**
 * Read values from extension local storage across Chrome, Edge, and Firefox.
 * @param {string|Array<string>|Object|null} keys
 * @returns {Promise<Object>}
 */
export function getLocalStorage(keys) {
  const storage = getExtensionApi().storage.local;

  if (usesBrowserPromiseApi) {
    return storage.get(keys);
  }

  return new Promise((resolve, reject) => {
    storage.get(keys, (result) => {
      const lastError = getExtensionApi().runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(result || {});
    });
  });
}

/**
 * Write values to extension local storage across Chrome, Edge, and Firefox.
 * @param {Object} value
 * @returns {Promise<void>}
 */
export function setLocalStorage(value) {
  const storage = getExtensionApi().storage.local;

  if (usesBrowserPromiseApi) {
    return storage.set(value);
  }

  return new Promise((resolve, reject) => {
    storage.set(value, () => {
      const lastError = getExtensionApi().runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve();
    });
  });
}
