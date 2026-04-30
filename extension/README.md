# Correlation ID Tracker — Browser Extension

A production-grade Manifest V3 browser extension that captures and tracks correlation IDs from **OrderUp** and **USOM** network traffic in real time. It targets Chrome and Edge directly and includes a WebExtension API compatibility layer for Firefox.

Built for performance engineers, SREs, and debugging workflows.

For the full project design, architecture, data flow, and roadmap, see [`../PDD.md`](../PDD.md).

---

## Features

- **Real-time capture** — intercepts HTTP headers via the WebExtensions `webRequest` API (no DevTools scraping)
- **Header-only extraction** — scans request and response headers for correlation IDs
- **Configurable filters** — options page controls URL filters, header names, page-data watchers, retention, and max saved events
- **Page-data watchers** — captures configured page globals such as `digitalData.cart.cartId` or `dataLayer[0].event`
- **IndexedDB persistence** — events survive browser restarts
- **Batched writes** — queues events and flushes periodically to reduce I/O
- **Automatic cleanup** — retention-based eviction (24h default) with scheduled cleanup
- **Ring-buffer eviction** — bounded in-memory pending map prevents memory leaks
- **Duplicate detection** — duplicate counts, duplicate-only filtering, and duplicate collapse mode
- **Badge count** — toolbar badge increments when new IDs are captured and clears with stored events
- **Interactive dashboard** — total events, unique IDs, duplicate rate, active domains, request/response split, top lists, and last-hour activity
- **Expanded dashboard tab** — opens the popup experience in a full browser tab for deeper review
- **Order flow capture** — stitches timestamp, captured SKUs, customer, address, delivery type, Quote ID, and milestone correlation IDs
- **Live popup UI** — latest-ID quick view plus search, source, method, domain, time, and duplicate filters
- **Copy formats** — copy ID, investigation note, or JSON for each event
- **Manual reports** — generate a clean investigation summary, copy it, or open a prefilled email draft
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
├── content/
│   ├── pageDataContent.js     # Config-driven page-data polling
│   └── pageDataBridge.js      # Injected page-context reader
├── popup/
│   ├── popup.html             # Popup markup
│   ├── popup.js               # Popup controller
│   ├── popup.css              # Dark theme styles
│   └── tableRenderer.js       # DOM rendering logic
├── dashboard/                 # Expanded full-tab dashboard
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
2. **Click the extension icon** to open the popup dashboard.
3. **Read the order-flow row** — the Order Flow table stitches page values and the three network correlation IDs by shared `order-tracking-id`.
4. **Open expanded view** — click "Open" in the popup to launch the same dashboard in a full browser tab.
5. **Capture an order flow** — clear old events, perform the ordering steps, then review the Order Flow row. Use "Copy Flow" to copy the stitched row.
6. **Use latest ID** — copy the newest ID or a ready-to-paste investigation note from the top panel.
7. **Filter** — narrow by search text, source, method, domain, time range, or duplicate status.
8. **Copy** — copy an event as ID, note, or JSON from the Actions column.
9. **Report** — click "Report" to generate a bounded summary from the current popup filters, then copy it or open an email draft.
10. **Export** — click "JSON" or "CSV" to download all captured events with metadata.
11. **Configure** — click the gear button to edit URL filters, headers, page-data watchers, report recipients, retention, and max saved events.
12. **Clear** — click the trash icon to wipe stored events and reset the badge.

---

## Configuration

Defaults are in [`extension/utils/constants.js`](extension/utils/constants.js), and runtime settings are saved through the options page:

| Setting | Default | Description |
|---------|---------|-------------|
| `urlFilters` | `[]` | URL substrings to match; configure these in Options before capturing network headers |
| `correlationHeaders` | `['order-tracking-id', 'usom-correlationid']` | Additional header names to extract for general tracking; order-flow capture always includes `order-tracking-id` and `usom-correlationid` |
| `pageDataWatchers` | `[]` | Page global paths to capture |
| `pageDataPollMs` | `1,000` | Page-data polling interval |
| `pageDataDurationSeconds` | `120` | How long to poll after page load |
| `reportRecipients` | `[]` | Email recipients used by Send Email Draft |
| `maxEvents` | `10,000` | Max events in IndexedDB |
| `retentionHours` | `24` | Event retention window |
| `STORAGE_LIMITS.BATCH_INTERVAL_MS` | `2,000 ms` | Batch write interval |
| `STORAGE_LIMITS.BATCH_MAX_SIZE` | `50` | Force flush threshold |
| `RING_BUFFER.MAX_PENDING` | `5,000` | Max pending request map entries |

### Page Data Watchers

Page-data watchers capture values from page-level JavaScript globals. They use the same URL filters as network capture, so add the site or API domain first, then add one watcher per line:

```text
Cart ID | digitalData.cart.cartId
Cart ID Legacy | digitalData.cartId
DataLayer Event | dataLayer[0].event
Adobe Cart | adobeDataLayer[0].cart.id
```

The format is:

```text
Display Label | global.path.to.value
```

The extension injects a small page-context bridge because browser content scripts cannot directly read page JavaScript variables. It only reads configured paths on matching URLs and stores the resulting value locally as a `page-data` event.

### Reports And Email Drafts

The popup report workflow is intentionally manual and reviewable:

1. Filter the popup to the time range, source, domain, or search term you care about.
2. Click **Report**.
3. Review the generated summary.
4. Click **Copy Report** for chat/ticket workflows or **Send Email Draft** to open a prefilled email.

Reports summarize large captures instead of dumping every row. They include totals, request/response/page-data counts, top domains, top methods, repeated values, recent page-data values, and a latest-event sample. Use JSON/CSV export when the recipient needs the full raw dataset.

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

The built-in DOM values above are scanned from the order page even when URL filters are focused on API paths. Custom page-data watchers still use URL filters.

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

The extension still captures IDs from configured network headers. These milestone patterns only tell the Order Flow table which captured network events belong under each step.

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
  "fieldLabel": "Cart ID",
  "fieldPath": "digitalData.cart.cartId",
  "valueType": "string",
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

Open `extension/tests/test-runner.html` as an extension page after loading the unpacked extension. It covers header extraction, URL filtering, config normalization, page-data watcher parsing, duplicate handling, duplicate collapse, dashboard summaries, report generation, and CSV escaping.

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
- Captures only configured header names
- Captures only configured page-data paths on matching URLs
- No data leaves the browser — all storage is local IndexedDB
- Options are stored locally with extension storage
- Exports are user-initiated downloads only
- Email reports open a user-reviewed draft; the extension does not send email silently

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
