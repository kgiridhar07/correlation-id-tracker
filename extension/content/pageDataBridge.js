(function () {
  const CONTENT_SOURCE = 'CID_TRACKER_CONTENT';
  const PAGE_SOURCE = 'CID_TRACKER_PAGE';

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== CONTENT_SOURCE || message.type !== 'SCAN_PAGE_DATA') return;

    const values = [];
    for (const watcher of message.watchers || []) {
      const tokens = parseDataPath(watcher.path);
      if (!tokens) continue;
      const serialized = serializePageValue(readPath(window, tokens));
      if (!serialized) continue;
      values.push({
        label: String(watcher.label || watcher.path),
        path: String(watcher.path),
        value: serialized.value,
        valueType: serialized.valueType,
      });
    }

    window.postMessage({
      source: PAGE_SOURCE,
      type: 'PAGE_DATA_RESULT',
      requestId: message.requestId,
      values,
    }, '*');
  });

  function readPath(root, tokens) {
    let current = root;
    for (const token of tokens) {
      if (current === undefined || current === null) return undefined;
      current = current[token];
    }
    return current;
  }

  function parseDataPath(path) {
    const text = String(path || '').trim();
    if (!text || text.length > 300) return null;
    const tokens = [];
    let index = 0;

    while (index < text.length) {
      const char = text[index];
      if (char === '.') {
        index++;
        continue;
      }
      if (char === '[') {
        const closeIndex = text.indexOf(']', index + 1);
        if (closeIndex === -1) return null;
        const inner = text.slice(index + 1, closeIndex).trim();
        const token = parseBracketToken(inner);
        if (!token) return null;
        tokens.push(token);
        index = closeIndex + 1;
        continue;
      }
      const match = /^[A-Za-z_$][\w$]*/.exec(text.slice(index));
      if (!match) return null;
      tokens.push(match[0]);
      index += match[0].length;
    }

    return tokens.length ? tokens : null;
  }

  function parseBracketToken(inner) {
    if (/^\d+$/.test(inner)) return inner;
    const quoted = /^(['"])(.*)\1$/.exec(inner);
    if (!quoted) return null;
    return quoted[2].replace(/\\(['"\\])/g, '$1');
  }

  function serializePageValue(value) {
    if (value === undefined || value === null || value === '') return null;
    const valueType = Array.isArray(value) ? 'array' : typeof value;
    let text;
    if (valueType === 'object' || valueType === 'array') {
      try {
        text = JSON.stringify(value);
      } catch (_err) {
        text = String(value);
      }
    } else {
      text = String(value);
    }
    const trimmed = text.trim();
    if (!trimmed) return null;
    return {
      value: trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed,
      valueType,
    };
  }
}());