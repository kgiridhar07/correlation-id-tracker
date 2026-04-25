# Correlation ID Tracker — Chrome Extension

## Project Overview

A production-quality browser extension for Chrome/Edge (Manifest V3) that captures and tracks correlation IDs from network traffic related to **OrderUp** and **USOM** systems.

Designed as an internal engineering diagnostic/debugging tool for performance engineers and SRE teams.

---

## Goal

Build a browser extension that **automatically captures correlation IDs from network traffic** without relying on DevTools UI scraping.

### Must NOT

- Automate clicking Network tab, Preserve Log, or Clear buttons
- Use DOM scraping or DevTools automation

### Must

1. Monitor network traffic in real time
2. Filter only relevant OrderUp / USOM requests
3. Extract correlation IDs from:
   - Request headers
   - Response headers
   - **Scope: Headers only** — no request/response body interception
4. Store correlation events efficiently
5. Display captured correlation IDs in a popup UI
6. Allow filtering/searching
7. Support future scalability for high-volume traffic

---

## Technical Requirements

### Use

- Chrome Extension Manifest V3
- Background service worker
- `chrome.webRequest` API
- IndexedDB for persistence
- Modular architecture
- Event-driven design

### Avoid

- DOM scraping
- DevTools automation
- Polling
- Inefficient loops
- Large memory usage

---

## Architecture

### Directory Structure

```
extension/
│
├── manifest.json
│
├── background/
│   ├── background.js
│   ├── networkListener.js
│   ├── correlationExtractor.js
│   ├── storageManager.js
│   ├── cleanupManager.js
│   └── messageBus.js
│
├── popup/
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   └── tableRenderer.js
│
├── utils/
│   ├── constants.js
│   ├── logger.js
│   ├── validators.js
│   └── helpers.js
│
└── README.md
```

### Separation of Concerns

- **background/** — Service worker scripts for network interception, extraction, storage, cleanup, and messaging
- **popup/** — UI layer for displaying and interacting with captured data
- **utils/** — Shared constants, logging, validation, and helper functions

---

## Network Capture Requirements

### APIs

- `chrome.webRequest.onBeforeSendHeaders`
- `chrome.webRequest.onHeadersReceived`

### Requirements

- Capture request metadata
- Capture response metadata
- Correlate requests using `requestId`
- Use O(1) lookup structures
- Aggressively filter irrelevant traffic

### URL Filters

Only capture URLs containing (configurable):

- `orderup`
- `usom`
- `/api/`
- Additional configurable patterns

---

## Correlation ID Extraction

### Header Names to Match

- `x-correlation-id`
- `x-usom-correlation-id`
- `correlation-id`
- `trace-id`
- `request-id`

### Extraction Utility

```
extractCorrelationId(headers)
```

- Case-insensitive matching
- Future extensibility for new header names

---

## Performance Requirements

### Assumptions

- Thousands of requests/hour
- Long browser sessions
- Multiple tabs

### Requirements

- Avoid memory leaks
- Implement retention cleanup
- Use ring-buffer strategy
- Batch storage writes
- Avoid excessive console logging
- Debounce UI updates

---

## Storage Requirements

### Technology

- IndexedDB

### Requirements

- Async storage layer
- Efficient indexing
- Timestamp support
- Cleanup strategy for old records

### Schema — `CorrelationEvent`

```json
{
  "requestId": "string",
  "timestamp": "number",
  "url": "string",
  "method": "string",
  "correlationId": "string",
  "sourceType": "string (request-header | response-header | payload)",
  "tabId": "number"
}
```

---

## Popup UI Requirements

### Display Columns

- Timestamp
- URL
- Correlation ID
- Request method
- Source type

### Features

- Live updates
- Search/filter
- Clear logs
- Export to JSON/CSV
- Copy correlation ID button

### Constraints

- Lightweight and fast rendering

---

## Message Passing

- Clean message passing between background service worker and popup UI
- Event-driven architecture

---

## Error Handling

Robust handling for:

- Malformed headers
- Extension restart
- IndexedDB failures
- Missing fields
- High traffic bursts

---

## Security Requirements

### Must NOT Store

- Auth tokens
- Cookies
- PII

### Must Only Store

- Required metadata (as defined in `CorrelationEvent` schema)

---

## Advanced Features (Future Extensibility)

Architecture must support easy addition of:

- WebSocket inspection
- Request replay
- Export logs
- Correlation tracing chains
- Filtering by endpoint
- Statistics dashboard
- Duplicate suppression

---

## Implementation Deliverables

1. Full `manifest.json`
2. Fully implemented background scripts
3. Storage manager implementation
4. Correlation extraction utility
5. Popup UI (HTML/CSS/JS)
6. Popup rendering logic
7. IndexedDB wrapper
8. Cleanup scheduler
9. Efficient filtering implementation
10. README with setup instructions

---

## Code Quality Requirements

- Production-quality
- Modular
- Readable
- Optimized
- Commented
- Maintainable

### Standards

- JSDoc comments
- Constants for magic values
- Reusable functions
- Minimal duplication

---

## Engineering Constraints

### Optimize For

- Low CPU overhead
- Low memory overhead
- High reliability
- Extensibility
- Maintainability

### Avoid

- Naive implementations
- Toy/example code

---

## Bonus Features

- Optional DevTools panel support
- Request timeline tracking
- Configurable filters (via options page or popup)
- Auto-copy latest correlation ID

---

## Testing Strategy

*(To be defined during implementation)*

- Unit tests for extraction logic
- Integration tests for storage layer
- Manual testing with simulated network traffic
- Edge case testing under high traffic

## Debugging Strategy

*(To be defined during implementation)*

- Background service worker logging
- IndexedDB inspection via DevTools > Application
- Message passing diagnostics

## Scaling Recommendations

*(To be defined during implementation)*

- Ring-buffer with configurable max size
- Batch write intervals
- Debounced UI refresh
- Configurable retention period

---

## References

- [Chrome Extension Manifest V3 Docs](https://developer.chrome.com/docs/extensions/mv3/)
- [chrome.webRequest API](https://developer.chrome.com/docs/extensions/reference/webRequest/)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
