# Correlation ID Tracker — Browser Extension

A production-grade Manifest V3 browser extension that captures and tracks correlation IDs from **OrderUp** and **USOM** network traffic in real time. It targets Chrome and Edge directly and includes a WebExtension API compatibility layer for Firefox.

Built for performance engineers, SREs, and debugging workflows.

---

## Features

- **Real-time capture** — intercepts HTTP headers via the WebExtensions `webRequest` API (no DevTools scraping)
- **Header-only extraction** — scans request and response headers for correlation IDs
- **Configurable filters** — options page controls URL filters, header names, retention, and max saved events
- **IndexedDB persistence** — events survive browser restarts
- **Batched writes** — queues events and flushes periodically to reduce I/O
- **Automatic cleanup** — retention-based eviction (24h default) with scheduled cleanup
- **Ring-buffer eviction** — bounded in-memory pending map prevents memory leaks
- **Duplicate detection** — duplicate counts, duplicate-only filtering, and duplicate collapse mode
- **Badge count** — toolbar badge increments when new IDs are captured and clears with stored events
- **Interactive dashboard** — total events, unique IDs, duplicate rate, active domains, request/response split, top lists, and last-hour activity
- **Live popup UI** — latest-ID quick view plus search, source, method, domain, time, and duplicate filters
- **Copy formats** — copy ID, investigation note, or JSON for each event
- **Export** — JSON and CSV export with metadata such as browser, export time, counts, and active filters
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
├── options/                   # User-editable capture settings
├── tests/                     # Browser-based unit test runner
└── icons/                     # Extension icons
```

---

## Installation

### Chrome / Edge From Source

1. Clone this repository:
   ```bash
   git clone <repo-url>
   cd correlation-id-tracker
   ```

2. Open Chrome or Edge and navigate to:
   ```
   chrome://extensions/
   ```

    For Edge, use:
    ```
    edge://extensions/
    ```

3. Enable **Developer mode** (toggle in top-right).

4. Click **Load unpacked** and select the `extension/` folder.

5. The extension icon appears in the toolbar. Pin it for easy access.

### Firefox Temporary Install

1. Open Firefox and navigate to:
    ```
    about:debugging#/runtime/this-firefox
    ```

2. Click **Load Temporary Add-on...**.

3. Select `extension/manifest.json`.

Firefox support uses the shared WebExtension API wrapper in `utils/browserApi.js`. Validate request and response header capture in your target Firefox version before relying on it for production debugging.

---

## Usage

1. **Browse normally** — the extension silently monitors matching network traffic in the background.
2. **Click the extension icon** to open the popup dashboard.
3. **Read the dashboard** — scan total events, unique IDs, duplicate rate, active domains, request/response split, top domains, top methods, repeated IDs, and last-hour activity.
4. **Use latest ID** — copy the newest ID or a ready-to-paste investigation note from the top panel.
5. **Filter** — narrow by search text, source, method, domain, time range, or duplicate status.
6. **Copy** — copy an event as ID, note, or JSON from the Actions column.
7. **Export** — click "JSON" or "CSV" to download all captured events with metadata.
8. **Configure** — click the gear button to edit URL filters, headers, retention, and max saved events.
9. **Clear** — click the trash icon to wipe stored events and reset the badge.

---

## Configuration

Defaults are in [`extension/utils/constants.js`](extension/utils/constants.js), and runtime settings are saved through the options page:

| Setting | Default | Description |
|---------|---------|-------------|
| `urlFilters` | `['orderup', 'usom', '/api/']` | URL substrings to match |
| `correlationHeaders` | `['x-correlation-id', ...]` | Header names to extract |
| `maxEvents` | `10,000` | Max events in IndexedDB |
| `retentionHours` | `24` | Event retention window |
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

### Unit Tests

Open `extension/tests/test-runner.html` as an extension page after loading the unpacked extension. It covers header extraction, URL filtering, config normalization, duplicate handling, duplicate collapse, and CSV escaping.

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

- **Background logs**: In Chrome/Edge, go to the extensions page and click the "Service Worker" link under the extension. In Firefox, use `about:debugging#/runtime/this-firefox` and click **Inspect**.
- **IndexedDB inspection**: DevTools → Application → IndexedDB → `CorrelationTrackerDB`
- **Verbose logging**: In background DevTools console, import and call `setLogLevel('DEBUG')` (or edit `logger.js`)

---

## Security

- Only captures URL, method, headers, requestId, tabId, and timestamp
- Does **not** capture request bodies
- Does **not** capture response bodies
- Does **not** intentionally store auth tokens, cookies, or PII
- Captures only configured header names
- No data leaves the browser — all storage is local IndexedDB
- Options are stored locally with extension storage
- Exports are user-initiated downloads only

---

## Future Improvements

- DevTools panel for richer debugging
- WebSocket traffic inspection
- Correlation chain tracing (link related IDs across requests)
- Statistics dashboard (requests/min, top endpoints)
- Optional auto-copy latest correlation ID to clipboard

---

## License

Internal tool — see your organization's licensing policy.
