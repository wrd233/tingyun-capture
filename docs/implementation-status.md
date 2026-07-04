# Implementation Status

Status: `PARTIAL`

The repo now contains a runnable v1 implementation path with Engine, Sidecar, Dedicated Chromium, Raw persistence, deterministic AI-ready generation, ZIP creation, local test site, and automated tests.

## Completed

- Requirement baseline copied to `docs/requirements/`.
- TypeScript project, Vite Sidecar, Vitest tests.
- One-command Capture runtime after build: `npm start -- --target-origin <origin>`.
- Playwright-managed persistent Chromium.
- Localhost-only API and Sidecar.
- Session / Step / Note state machine.
- Raw manifest, append-only events, Body files, downloads, integrity gaps.
- Crash recovery for active/finalizing Sessions.
- Browser close and Engine stop interruption paths.
- Target-origin network capture with request/response lifecycle.
- Lightweight WebSocket open/message/close facts.
- Redirect chain IDs and adjacent request references when Playwright exposes them.
- Passive interaction, form, submit-candidate, and SPA URL observers.
- Deterministic redaction, cURL generation, AI-ready package, and ZIP.
- Local fixture site and E2E test for cascade submit flow.

## Known Limits

- EventSource message capture is represented as network request facts, not parsed stream messages.
- WebSocket and redirect facts are implemented but not yet covered by dedicated automated tests.
- Cache facts are limited to facts exposed cheaply by Playwright.
- Disk warning UI is not yet surfaced prominently beyond interruption behavior.
- Post-seal human annotation editing is represented in the data model but has only minimal UI support.
- Real Tingyun scenarios remain manual validation by design.

## Non-goals Preserved

No LLM/model API, endpoint ranking, parameter lineage inference, cascade causality inference, replay, cURL execution, screenshots, video, full DOM snapshots, dynamic cross-origin exploration, login system, desktop app, or old schema compatibility were added.
