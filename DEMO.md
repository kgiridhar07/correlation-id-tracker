# Correlation ID Tracker Demo

Use this script to show the extension in a short team demo.

## Setup

1. Load the `extension/` folder as an unpacked extension in Chrome or Edge.
2. Open `test.html` from the repository.
3. Open the extension popup so the table is visible.

## Demo Flow

1. Click **Send Test Request** on `test.html`.
2. Show the toolbar badge incrementing after the capture.
3. Open the popup and point to the dashboard metrics: total events, unique IDs, duplicate rate, domains, and request/response split.
4. Show the insight strip, top domains, top methods, repeated IDs, and last-hour activity bars.
5. Point to the **Latest correlation ID** panel.
6. Click **Copy Note** and paste the result into a scratch document.
7. Use the source, method, domain, time, duplicate, and collapse filters.
8. Click the gear button and show configurable URL filters, headers, retention, and max saved events.
9. Export JSON and mention the included metadata: browser, export time, counts, and active filters.
10. Export CSV for spreadsheet-friendly review.
11. Clear events and show the badge reset.

## Team Talking Points

- It captures only configured headers from matching requests.
- It does not read request or response bodies.
- It stores data locally in the browser.
- It helps SREs and engineers quickly copy IDs for logs, traces, and incident notes.
- It is configurable enough to support more services without code changes.