# Decisions

## D001 TypeScript Runtime

Use TypeScript for Engine, API, Sidecar, tests, and deterministic generators. This keeps contracts shared and reduces cross-language complexity.

## D002 Playwright Persistent Context

Use Playwright `launchPersistentContext` for dedicated Chromium ownership and persistent login profile. Product code observes real user actions; it does not operate target pages.

## D003 Filesystem Raw, No SQLite

Use manifest JSON, append-only JSONL, independent Body files, and downloads. This follows the Raw contract and supports long Sessions without retaining all facts in memory.

## D004 Body Limit

Default single Body hard limit is 10 MiB. Over-limit bodies are not truncated; Capture records metadata and an integrity gap.

## D005 Disk Thresholds

Default low disk threshold is 5 GiB and critical threshold is 1 GiB. Critical disk interrupts active capture with `low_disk_space`.

## D006 AI-ready Scope

AI-ready generation is pure code and deterministic templates. It redacts high-confidence credentials but preserves business IDs by default.

## D007 UI Scope

Sidecar is operational, not analytical: current status, active controls, recent events, recent Sessions, and three-level Review down to Request/Response.
