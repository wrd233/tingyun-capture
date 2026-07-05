# Capture Engine

## Browser

Capture launches a Playwright persistent Chromium context at `profileDir`. The profile is retained across runs; the browser process is closed when Capture stops.

The browser is long-lived relative to Sessions. Users may log in and prepare pages outside a Session; those actions are not recorded into any Session.

## Target Origin

`target_origin` is normalized to an origin and used as the only full-capture boundary. Sidecar traffic is excluded. No API path prefix whitelist exists.

## Tab, Frame, URL

Every target-origin page receives a stable `tab-*` ID. When Playwright exposes a browser opener page, `tab_created.tab.opener_tab_id` records that raw browser fact. If a page is first seen as `about:blank`, `tab_created` is emitted when it first navigates into the target origin. Frame events receive `frame-*` IDs when visible to Playwright. Navigation events and injected `pushState`, `replaceState`, and `hashchange` observations are written as `url_changed`.

## Interactions and Forms

An init script installs passive capture-phase listeners. It records:

- click;
- final input/change/blur values;
- select options exposed in the DOM;
- checkbox/radio values;
- Enter and submit;
- lightweight semantic control snapshots.

Before actual submit signals, it writes a `before_submit` form state and opens a deterministic submit observation window with an auditable trigger. Valid triggers are browser `submit` events, visible enabled submit controls associated with a form, and Enter in a form field. A normal anchor click or a hidden submit button elsewhere on the page does not open a submit window. It never clicks, opens dropdowns, changes values, or submits pages.

## Network

For target-origin requests that start while Session is active:

- `request_started` is appended immediately with method, URL, headers, resource type, Tab/Frame, Step, and request body reference.
- `response_received` records status and headers.
- `request_completed` writes response body references and lifecycle facts.
- `request_failed` records the raw Playwright failure text.

Raw still saves request and response bodies for observed target-origin requests unless the body is unavailable or over the configured hard limit. AI-ready later applies its own evidence policy so static resource bodies remain in Raw only.

## Downloads

User-triggered downloads on target-origin pages are saved under Raw downloads and recorded with source page context.
