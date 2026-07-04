# Capture Engine

## Browser

Capture launches a Playwright persistent Chromium context at `profileDir`. The profile is retained across runs; the browser process is closed when Capture stops.

The browser is long-lived relative to Sessions. Users may log in and prepare pages outside a Session; those actions are not recorded into any Session.

## Target Origin

`target_origin` is normalized to an origin and used as the only full-capture boundary. Sidecar traffic is excluded. No API path prefix whitelist exists.

## Tab, Frame, URL

Every target-origin page receives a stable `tab-*` ID. Frame events receive `frame-*` IDs when visible to Playwright. Navigation events and injected `pushState`, `replaceState`, and `hashchange` observations are written as `url_changed`.

## Interactions and Forms

An init script installs passive capture-phase listeners. It records:

- click;
- final input/change/blur values;
- select options exposed in the DOM;
- checkbox/radio values;
- Enter and submit;
- lightweight semantic control snapshots.

Before high-confidence submit candidates, it writes a `before_submit` form state and opens a deterministic submit observation window. It never clicks, opens dropdowns, changes values, or submits pages.

## Network

For target-origin requests that start while Session is active:

- `request_started` is appended immediately with method, URL, headers, resource type, Tab/Frame, Step, and request body reference.
- `response_received` records status and headers.
- `request_completed` writes response body references and lifecycle facts.
- `request_failed` records the raw Playwright failure text.

Static resource types remain metadata-first. Dynamic requests get body files unless the body is unavailable, binary, or over the configured hard limit.

## Downloads

User-triggered downloads on target-origin pages are saved under Raw downloads and recorded with source page context.
