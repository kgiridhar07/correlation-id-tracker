# Correlation ID Tracker — Chrome/Edge Extension

A production-grade Manifest V3 browser extension that captures and tracks correlation IDs from **OrderUp** and **USOM** network traffic in real time.

Built for performance engineers, SREs, and debugging workflows.

---

## Features

- **Real-time capture** — intercepts HTTP headers via `chrome.webRequest` (no DevTools scraping)
- **Header-only extraction** — scans request and response headers for correlation IDs
- **Configurable filters** — only captures traffic matching OrderUp / USOM / `/api/` URL patterns
- **IndexedDB persistence** — events survive browser restarts
- **Batched writes** — queues events and flushes periodically to reduce I/O
- **Automatic cleanup** — retention-based eviction (24h default) with scheduled cleanup
- **Ring-buffer eviction** — bounded in-memory pending map prevents memory leaks
- **Live popup UI** — real-time table with search, filter, copy, and export
- **Export** — JSON and CSV export of all captured events
- **Dark theme** — lightweight, VSCode-inspired dark UI

---

## Architecture

```
extension/
├── manifest.json              # Manifest V3 config
├── background/
│   ├── background.js          # Service worker entry point
│   ├── networkListener.js     # webRequest hooks
│   ├── correlationExtractor.js # Header extraction logic
│   ├── storageManager.js      # IndexedDB with batch writes
│   ├── cleanupManager.js      # Retention cleanup scheduler
│   └── messageBus.js          # Background ↔ popup messaging
├── popup/
│   ├── popup.html             # Popup markup
│   ├── popup.js               # Popup controller
│   ├── popup.css              # Dark theme styles
│   └── tableRenderer.js       # DOM rendering logic
├── utils/
│   ├── constants.js           # All config constants
│   ├── logger.js              # Level-gated logger
│   ├── validators.js          # Input validation
│   └── helpers.js             # URL filtering, debounce, formatting
└── icons/                     # Extension icons
```

---

## Installation

### From Source (Developer Mode)

1. Clone this repository:
   ```bash
   git clone <repo-url>
   cd correlation-id-tracker
   ```

2. Open Chrome/Edge and navigate to:
   ```
   chrome://extensions/
   ```

3. Enable **Developer mode** (toggle in top-right).

4. Click **Load unpacked** and select the `extension/` folder.

5. The extension icon appears in the toolbar. Pin it for easy access.

---

## Usage

1. **Browse normally** — the extension silently monitors network traffic in the background.
2. **Click the extension icon** to open the popup and view captured correlation IDs.
3. **Search** — type in the search box to filter by correlation ID, URL, method, or source type.
4. **Copy** — click the "Copy" button next to any correlation ID.
5. **Export** — click "JSON" or "CSV" to download all captured events.
6. **Clear** — click the trash icon to wipe all stored events.

---

## Configuration

All constants are in [`extension/utils/constants.js`](extension/utils/constants.js):

| Setting | Default | Description |
|---------|---------|-------------|
| `URL_FILTERS` | `['orderup', 'usom', '/api/']` | URL substrings to match |
| `CORRELATION_HEADERS` | `['x-correlation-id', ...]` | Header names to extract |
| `STORAGE_LIMITS.MAX_EVENTS` | `10,000` | Max events in IndexedDB |
| `STORAGE_LIMITS.RETENTION_MS` | `24 hours` | Event retention window |
| `STORAGE_LIMITS.BATCH_INTERVAL_MS` | `2,000 ms` | Batch write interval |
| `STORAGE_LIMITS.BATCH_MAX_SIZE` | `50` | Force flush threshold |
| `RING_BUFFER.MAX_PENDING` | `5,000` | Max pending request map entries |

---

## Captured Event Schema

```json
{
  "requestId": "12345",
  "timestamp": 1714000000000,
  "url": "https://api.orderup.com/v1/orders",
  "method": "POST",
  "correlationId": "abc-123-def-456",
  "sourceType": "response-header",
  "tabId": 42
}
```

---

## Testing Strategy

### Manual Testing

1. Load the extension in developer mode.
2. Open a site that sends requests matching URL filters.
3. Verify events appear in the popup.
4. Test search, copy, export, and clear functions.

### Simulated Traffic

Use `fetch()` in the browser console to generate matching requests:

```js
fetch('https://example.com/api/test', {
  headers: { 'x-correlation-id': 'test-corr-123' }
});
```

### Edge Cases

- Extension restart mid-session — events persist in IndexedDB
- High traffic burst — batch queue absorbs spikes, flush handles backpressure
- Popup opened during traffic — live updates stream via message bus
- No matching traffic — empty state shown

---

## Debugging

- **Background logs**: Go to `chrome://extensions/` → click "Service Worker" link under the extension → opens DevTools for background
- **IndexedDB inspection**: DevTools → Application → IndexedDB → `CorrelationTrackerDB`
- **Verbose logging**: In background DevTools console, import and call `setLogLevel('DEBUG')` (or edit `logger.js`)

---

## Security

- Only captures URL, method, headers, requestId, tabId, and timestamp
- Does **not** store auth tokens, cookies, request/response bodies, or PII
- No data leaves the browser — all storage is local IndexedDB

---

## Future Improvements

- Options page for configurable URL patterns and header names
- DevTools panel for richer debugging
- WebSocket traffic inspection
- Correlation chain tracing (link related IDs across requests)
- Statistics dashboard (requests/min, top endpoints)
- Duplicate suppression (same correlation ID from request + response)
- Badge count on extension icon showing active captures
- Auto-copy latest correlation ID to clipboard

---

## License

Internal tool — see your organization's licensing policy.
