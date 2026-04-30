# Correlation ID Tracker — Browser Extension

A production-grade Manifest V3 browser extension that captures and tracks correlation IDs from **OrderUp** and **USOM** network traffic in real time. It targets Chrome and Edge directly and includes a WebExtension API compatibility layer for Firefox.

Built for performance engineers, SREs, and debugging workflows.

For the full project design, architecture, data flow, and roadmap, see [`../PDD.md`](../PDD.md).

---

## Features

- **Real-time capture** — intercepts HTTP headers via the WebExtensions `webRequest` API (no DevTools scraping)
- **Header-only extraction** — scans request and response headers for correlation IDs
- **Configurable filters** — options page controls URL filters, order-flow milestone URL patterns, retention, and max saved events
- **Built-in page element capture** — captures only Quote ID, SKU, customer, address, and delivery type from the order page
- **IndexedDB persistence** — events survive browser restarts
- **Batched writes** — queues events and flushes periodically to reduce I/O
- **Automatic cleanup** — retention-based eviction (24h default) with scheduled cleanup
- **Ring-buffer eviction** — bounded in-memory pending map prevents memory leaks
- **Badge count** — toolbar badge increments when new IDs are captured and clears with stored events
- **Order flow capture** — stitches timestamp, captured SKUs, customer, address, delivery type, Quote ID, and milestone correlation IDs
- **Live popup UI** — latest-ID quick view and a selectable stitched order-flow table
- **Manual reports** — generate a clean order-flow table from selected rows, copy it, or open a prefilled email draft
- **Export** — JSON and CSV export selected order-flow rows with date and timestamp fields
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
├── content/
│   ├── pageDataContent.js     # Built-in order-flow page element polling
├── popup/
│   ├── popup.html             # Popup markup
│   ├── popup.js               # Popup controller
│   ├── popup.css              # Dark theme styles
│   └── tableRenderer.js       # DOM rendering logic
├── utils/
│   ├── constants.js           # All config constants
│   ├── logger.js              # Level-gated logger
│   ├── validators.js          # Input validation
│   ├── pageDataUtils.js       # Page-data watcher parsing
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
2. **Click the extension icon** to open the popup.
3. **Read the order-flow row** — the Order Flow table stitches page values and the three network correlation IDs by shared `order-tracking-id`.
4. **Capture an order flow** — clear old events, perform the ordering steps, then review the Order Flow row.
5. **Select rows** — check the order-flow rows to include in Report, JSON, or CSV. If no rows are checked, all rows are included.
6. **Report** — click "Report" to generate a clean order-flow table, then copy it or open an email draft.
7. **Export** — click "JSON" or "CSV" to download selected order-flow rows with date and timestamp fields.
8. **Configure** — click the gear button to edit URL filters, milestone URL patterns, report recipients, retention, and max saved events.
9. **Clear** — click the trash icon to wipe stored events and reset the badge.

---

## Configuration

Defaults are in [`extension/utils/constants.js`](extension/utils/constants.js), and runtime settings are saved through the options page:

| Setting | Default | Description |
|---------|---------|-------------|
| `urlFilters` | `[]` | URL substrings to match; configure these in Options before capturing network headers |
| `correlationHeaders` | `['order-tracking-id', 'usom-correlationid']` | Legacy setting; order-flow capture is limited to `order-tracking-id` and `usom-correlationid` |
| `pageDataWatchers` | `[]` | Legacy setting; custom page globals are not captured in strict order-flow mode |
| `pageDataPollMs` | `1,000` | Page-data polling interval |
| `pageDataDurationSeconds` | `120` | How long to poll after page load |
| `reportRecipients` | `[]` | Email recipients used by Send Email Draft |
| `maxEvents` | `10,000` | Max events in IndexedDB |
| `retentionHours` | `24` | Event retention window |
| `STORAGE_LIMITS.BATCH_INTERVAL_MS` | `2,000 ms` | Batch write interval |
| `STORAGE_LIMITS.BATCH_MAX_SIZE` | `50` | Force flush threshold |
| `RING_BUFFER.MAX_PENDING` | `5,000` | Max pending request map entries |

### Page Element Capture

Strict order-flow mode captures only the built-in page elements used by the stitched row: Quote ID, SKU, customer, address, and delivery type. Custom page globals are ignored so unrelated page values are not stored.

### Reports And Email Drafts

The popup report workflow is intentionally manual and reviewable:

1. Select the order-flow rows to include, or leave all rows unchecked to include every row.
2. Click **Report**.
3. Review the generated order-flow table.
4. Click **Copy Report** for chat/ticket workflows or **Send Email Draft** to open a prefilled email.

Reports include only Timestamp, Date, Order Tracking ID, Quote, SKU, Customer, Address, Delivery, Sourcing Corr, Capacity Corr, and Reserve Corr. JSON and CSV exports use the same selected rows.

Email sending uses `mailto:` and opens a draft in the user's configured email client. The extension does not store email passwords, API keys, SMTP credentials, or email provider secrets.

### Order Flow Capture

Order Flow Capture is designed for SKU-to-delivery troubleshooting. Clear old events, perform the ordering flow, then review the stitched Order Flow table. Each row is keyed by the shared `order-tracking-id` captured on the network requests.

Automatic values:

```text
Quote ID from [data-testid="order-number"]
All seen SKUs from [data-testid="product-description__sku-number"]
Customer from .customer-card__name .pal--type-style-05
Address from the fulfillment row labeled DELIVERY ADDRESS
Delivery Type from the fulfillment row labeled DELIVERY OPTIONS
Sourcing Options correlation ID from the matching network request
Capacity correlation ID from the matching network request
Reserve Delivery correlation ID from the matching network request
```

The built-in DOM values above are scanned from the order page even when URL filters are focused on API paths. Custom page-data watchers are ignored in strict order-flow mode.

The Order Flow table combines captured DOM values and matching network header captures on the same line. Each row includes the latest timestamp for that flow, keeps all unique SKU values seen during capture, uses `order-tracking-id` only as the stitch key, and uses `usom-correlationid` as the displayed milestone correlation ID when present.

Milestone URL matching is configurable in Options. The default milestone patterns are:

```text
Sourcing Options | sourcingoptions
Capacity | sourcingoptions?calltype=capacity
Reserve Delivery | reservedelivery
```

You can put multiple patterns on a line with semicolons:

```text
Sourcing Options | /sourcing-options; /source/options
```

The extension captures only `order-tracking-id` and `usom-correlationid` from URLs matching these milestone patterns. Other matching network traffic is ignored.

When `order-tracking-id` is shared across Sourcing Options, Capacity, and Reserve Delivery, the row can show all three `usom-correlationid` values beside the same SKU/customer/address/delivery/quote data.

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
  "headerName": "order-tracking-id",
  "fieldLabel": "Quote ID",
  "fieldPath": "dom:[data-testid=\"order-number\"]",
  "valueType": "dom-text",
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

Open `extension/tests/test-runner.html` as an extension page after loading the unpacked extension. It covers header extraction, URL filtering, config normalization, page-data watcher parsing, duplicate handling, order-flow stitching, and CSV escaping.

### Simulated Traffic

Use `fetch()` in the browser console to generate matching requests:

```js
fetch('https://example.com/api/test', {
  headers: {
    'order-tracking-id': 'TRACK-123',
    'usom-correlationid': 'test-corr-123'
  }
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
- Captures only `order-tracking-id` and `usom-correlationid` on matching milestone URLs
- Captures only the built-in order-flow page elements
- No data leaves the browser — all storage is local IndexedDB
- Options are stored locally with extension storage
- Exports are user-initiated downloads only
- Email reports open a user-reviewed draft; the extension does not send email silently

---

## Future Improvements

- DevTools panel for richer debugging
- WebSocket traffic inspection
- Correlation chain tracing (link related IDs across requests)
- Optional auto-copy latest correlation ID to clipboard

---

## License

Internal tool — see your organization's licensing policy.
