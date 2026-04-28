# Project Design Document: Correlation ID Tracker

## 1. Overview

Correlation ID Tracker is a Manifest V3 browser extension for debugging and validating correlation IDs, request IDs, trace IDs, and selected page-level business values on controlled websites.

The extension is intended for local diagnostic use by engineers, SREs, QA, and performance testers. It captures configured request/response header values and configured page globals, stores them locally, and presents the data in a dashboard with filtering, export, and manual report workflows.

This project is primarily designed for private/internal testing environments, including controlled personal or team-owned sites. It is not currently hardened for broad public Chrome Web Store distribution without additional permission and privacy improvements.

## 2. Goals

- Capture useful debugging identifiers without manually inspecting DevTools for every request.
- Support request headers, response headers, and configurable page data such as `digitalData.cart.cartId`.
- Keep all captured data local to the browser unless the user explicitly exports, copies, or opens an email draft.
- Provide a clear popup dashboard for quick diagnosis.
- Stitch order-flow context from manual SKU/customer/address/delivery details, DOM Quote ID, and key network correlation IDs.
- Support high-volume browser sessions with retention, batching, duplicate detection, and bounded reports.
- Make configuration flexible enough for different sites and header conventions.

## 3. Non-Goals

- The extension does not capture request bodies.
- The extension does not capture response bodies.
- The extension does not silently send emails.
- The extension does not include SMTP passwords, API keys, or email provider secrets.
- The extension does not scrape the DevTools Network panel.
- The extension is not a full distributed tracing platform.
- The extension is not currently optimized for public Chrome Web Store approval.

## 4. Target Users

- SREs validating production-like request tracing.
- Developers debugging API request flows.
- QA engineers validating cart, checkout, login, search, or order flows.
- Performance engineers correlating browser activity with backend logs.
- Site owners testing correlation behavior on controlled environments.

## 5. Main Use Cases

### 5.1 Validate Correlation IDs

The user configures target URL filters and header names, browses the site, then checks whether captured IDs can be found in backend logs.

### 5.2 Capture Page Business Context

The user configures page-data watchers such as:

```text
Cart ID | digitalData.cart.cartId
Page Name | digitalData.page.pageName
DataLayer Event | dataLayer[0].event
```

The extension captures those values when present on matching pages.

### 5.3 Generate Investigation Reports

The user filters captured events, generates a bounded report, reviews it, copies it, or opens a prefilled email draft.

### 5.4 Export Full Raw Data

The user exports JSON or CSV when a complete raw dataset is needed.

### 5.5 Stitch Order Flow

The user clears old events, performs the ordering journey, then generates a report that includes captured business context plus Sourcing Options, Capacity, and Reserve Delivery correlation IDs.

## 6. Architecture

```text
extension/
  manifest.json
  background/
    background.js
    networkListener.js
    correlationExtractor.js
    storageManager.js
    cleanupManager.js
    messageBus.js
    badgeManager.js
  content/
    pageDataContent.js
    pageDataBridge.js
  popup/
    popup.html
    popup.css
    popup.js
    tableRenderer.js
  dashboard/
    dashboard.html
    dashboard.css
  options/
    options.html
    options.css
    options.js
  utils/
    browserApi.js
    configManager.js
    constants.js
    dataUtils.js
    flowUtils.js
    helpers.js
    logger.js
    pageDataUtils.js
    reportUtils.js
    validators.js
  tests/
    test-runner.html
    unit.test.js
```

## 7. Execution Model

### 7.1 Background Service Worker

The background service worker initializes configuration, message handling, network listeners, batch storage flushing, and retention cleanup.

Responsibilities:

- Listen for request headers and response headers through `webRequest`.
- Extract configured header values.
- Accept page-data capture messages from the content script.
- Queue and flush events into IndexedDB.
- Broadcast new events to the popup.
- Clear events and badge state when requested.

### 7.2 Content Script

The content script runs on browser pages and checks whether the current URL matches configured filters. If page-data watchers are configured, it injects the page bridge and polls for configured values during a bounded capture window.

### 7.3 Injected Page Bridge

The injected bridge runs in page context so it can read page JavaScript globals that normal isolated content scripts cannot directly access.

Responsibilities:

- Receive scan requests from the content script.
- Resolve configured paths such as `digitalData.cart.cartId`.
- Serialize matching values into strings.
- Return results to the content script with `window.postMessage`.

### 7.4 Popup UI

The popup is the main user interface.

Responsibilities:

- Show latest captured value.
- Render dashboard metrics.
- Filter by source, method, domain, time range, duplicate status, and search text.
- Copy individual events.
- Export JSON/CSV.
- Generate manual reports.
- Open email drafts with reviewed report content.
- Start, stop, and generate order flow reports.

### 7.5 Expanded Dashboard Tab

The expanded dashboard is a full browser tab that reuses the popup controller and renderer with a wider layout. It is launched from the popup with the **Open** button and is intended for deeper investigation when the popup is too constrained.

Responsibilities:

- Reuse the same event loading, filtering, export, report, and copy behavior as the popup.
- Provide wider table columns and more vertical review space.
- Keep the quick popup and full dashboard behavior consistent.

### 7.6 Options UI

The options page stores user configuration.

Configurable values:

- URL filters.
- Correlation header names.
- Page-data watchers.
- Order flow milestone URL patterns.
- Page-data polling interval.
- Page-data capture duration.
- Report recipients.
- Maximum stored events.
- Retention window.

## 8. Data Flow

```text
Request headers
  -> webRequest.onBeforeSendHeaders
  -> correlationExtractor
  -> storageManager queue
  -> IndexedDB
  -> popup dashboard/export/report

Response headers
  -> webRequest.onHeadersReceived
  -> correlationExtractor
  -> storageManager queue
  -> IndexedDB
  -> popup dashboard/export/report

Page globals
  -> pageDataBridge
  -> window.postMessage
  -> pageDataContent
  -> runtime message
  -> background messageBus
  -> storageManager queue
  -> IndexedDB
  -> popup dashboard/export/report

DOM Quote ID
  -> pageDataContent reads [data-testid="order-number"]
  -> runtime message
  -> background messageBus
  -> storageManager queue
  -> IndexedDB
  -> order flow report

User configuration
  -> options page
  -> chrome.storage.local
  -> background/content runtime behavior

Manual report
  -> popup report generator
  -> preview panel
  -> clipboard or mailto draft by user action
```

## 9. Captured Event Model

```json
{
  "requestId": "12345",
  "timestamp": 1714000000000,
  "url": "https://example.com/api/cart",
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

For network header captures, `headerName` stores the matched request or response header name, while `fieldLabel`, `fieldPath`, and `valueType` may be absent. For page-data captures, `correlationId` stores the captured value so the existing dashboard, duplicate logic, copy, export, and report flows can reuse one event model.

## 10. Configuration Design

### URL Filters

URL filters are simple case-insensitive substring matches. A request or page must match at least one filter before it is considered relevant.

Example:

```text
abc.com
/api/
checkout
```

### Header Names

Header matching is case-insensitive and configurable.

Example:

```text
x-correlation-id
x-request-id
traceparent
```

### Page-Data Watchers

Page-data watcher format:

```text
Display Label | global.path.to.value
```

Example:

```text
Cart ID | digitalData.cart.cartId
Page Name | digitalData.page.pageName
DataLayer Event | dataLayer[0].event
```

### Report Recipients

Report recipients are stored as local configuration and used only to populate a user-reviewed `mailto:` draft.

## 11. Storage Design

### IndexedDB

Captured events are stored in IndexedDB under `CorrelationTrackerDB`.

Indexes:

- `timestamp`
- `correlationId`
- `url`
- `requestId`

### chrome.storage.local

Extension settings are stored in local extension storage using the `correlationTrackerConfig` key.

### Retention

The extension enforces:

- Maximum saved events.
- Retention window in hours.
- Periodic cleanup.
- Batch writes to reduce storage overhead.

## 12. Reporting Design

Reports are designed to summarize high-volume captures without dumping thousands of rows.

Included sections:

- Generated timestamp.
- Current popup filter scope.
- Total events.
- Unique values.
- Duplicate rate.
- Request/response/page-data counts.
- Latest captures.
- Top domains.
- Top methods.
- Most repeated values.
- Page-data values.
- Recent event sample.

Report actions:

- Generate Report.
- Copy Report.
- Send Email Draft.

Email behavior:

- Uses `mailto:` only.
- Opens a draft in the user's configured mail client.
- Does not send automatically.
- Does not store email passwords or API secrets.

### Order Flow Reports

Order flow reports combine optional manual overrides with captured page values and matching network events from the current captured event set.

Optional manual overrides:

- SKU.
- Customer.
- Address.
- Delivery Type.
- Notes.

Automatic values:

- Quote ID from `[data-testid="order-number"]`.
- SKU from `[data-testid="product-description__sku-number"]`.
- Customer from `.customer-card__name .pal--type-style-05`.
- Address from the fulfillment row labeled `DELIVERY ADDRESS`.
- Delivery Type from the fulfillment row labeled `DELIVERY OPTIONS`.
- Sourcing Options correlation IDs from URLs containing `sourcing-options`, `sourcing options`, or `sourcing`.
- Capacity correlation IDs from URLs containing `capacity`.
- Reserve Delivery correlation IDs from URLs containing `reserve-delivery`, `reserve delivery`, or `reserve`.

When multiple configured headers are present on a matching milestone request, reports prefer `order-tracking-id` because it is common across the three order-flow calls.

Milestone URL patterns are user-configurable in Options with this format:

```text
Sourcing Options | /your/sourcing/path
Capacity | /your/capacity/path
Reserve Delivery | /your/reserve/path
```

The normal workflow does not require Start/Stop controls. Users should clear old events before a new order journey when they want a clean report.

## 13. Security And Privacy Design

### Current Protections

- No request body capture.
- No response body capture.
- No automatic external telemetry.
- Local IndexedDB storage.
- User-initiated export only.
- User-reviewed email draft only.
- DOM rendering uses text-based APIs instead of HTML injection.
- No third-party dependencies.

### Known Risks

- `<all_urls>` host permission is broad.
- Content script currently matches all URLs and relies on runtime URL filters.
- Page-data capture uses a `window.postMessage` bridge.
- Full URLs may contain sensitive query parameters.
- User-configurable header names could accidentally include sensitive headers such as `authorization` or `cookie`.

### Recommended Hardening

- Move to optional host permissions or domain-scoped permissions.
- Add denylist validation for sensitive headers.
- Strip query strings by default.
- Add nonce validation for page-data bridge messages.
- Validate page-data capture messages in the background against sender URL and configured watcher paths.
- Add an explicit privacy notice in the popup/options UI.

## 14. Performance Design

- Header filtering is done before event creation.
- Pending requests are tracked in a bounded map.
- IndexedDB writes are batched.
- Cleanup trims old and surplus records.
- Popup rendering limits visible rows.
- UI refresh uses debounce.
- Reports include bounded samples instead of all rows.
- Flow reports scan captured events and milestone keywords, then show the best matched ID per milestone.

## 15. Browser Support

Primary target:

- Chrome Manifest V3.
- Microsoft Edge Manifest V3.

Compatibility target:

- Firefox through the shared WebExtension wrapper, with validation required before relying on production debugging.

## 16. Testing Strategy

### Browser Unit Tests

`extension/tests/test-runner.html` validates:

- Header extraction.
- URL filtering.
- Config normalization.
- Page-data watcher parsing.
- Duplicate counting.
- Duplicate collapse.
- CSV escaping.
- Dashboard summaries.
- Report generation.
- Order flow stitching.

### Manual Testing

- Load unpacked extension.
- Configure target URL filter.
- Configure headers and page-data watchers.
- Generate traffic on the target site.
- Verify dashboard updates.
- Verify exports.
- Verify generated reports.
- Verify email draft opens without automatic sending.

## 17. Operational Workflow

1. Reload or load the unpacked extension.
2. Open the options page.
3. Add the target site/domain to URL filters.
4. Add correlation headers.
5. Add page-data watchers if needed.
6. Add report recipients if email drafts are needed.
7. Save options.
8. Clear previous events.
9. Browse the target site.
10. Open the popup dashboard.
11. Open the expanded dashboard tab when more space is needed.
12. Clear old events before testing SKU-to-delivery journeys.
13. Filter to the relevant time/source/domain.
14. Copy values, export raw data, generate a report, or generate a flow report.

## 18. Roadmap

### Short Term

- Add sensitive header denylist.
- Add privacy notice in options.
- Strip query strings by default.
- Add page-bridge nonce validation.

### Medium Term

- Optional host permissions.
- Capture session start/stop mode.
- Report section toggles.
- Per-domain configuration profiles.

### Long Term

- DevTools panel.
- Traceparent parsing.
- Correlation chain visualization.
- Backend log search integration, if a secure company API exists.

## 19. Open Questions

- Should full URLs be stored, or should query strings be removed by default?
- Should page-data capture require a separate enable toggle per domain?
- Should reports include raw recent samples by default, or require explicit opt-in?
- Should this remain an unpacked/private tool, or should it be hardened for Chrome Web Store distribution?

## 20. Final Design Position

Correlation ID Tracker is designed as a practical local diagnostic extension. It prioritizes fast validation and investigation workflows for controlled sites. The current design is appropriate for personal/internal use, but public distribution would require tighter host permissions, stronger page-message validation, and stronger privacy disclosures.