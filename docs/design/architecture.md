# Architecture

`tingyun-capture v1` is a local macOS developer tool with three runtime parts:

1. Capture Engine: TypeScript Node process that owns state, Raw persistence, browser observation, and deterministic derived output.
2. Dedicated Chromium: launched and closed by Capture through Playwright `launchPersistentContext`, with a persistent profile directory.
3. Sidecar Web UI: React UI served by the localhost API after `npm run build`.

All local services bind to `127.0.0.1`. Runtime has no LLM, model API, prompt manager, endpoint ranking, replay, screenshot, video, or automation explorer.

## Data Flow

```text
User operates Dedicated Chromium
        ↓
Playwright page/network/download events + injected passive DOM listeners
        ↓
SessionManager validates Session / Step boundaries
        ↓
RawStore appends JSONL events and writes Body files incrementally
        ↓
Review API reads Raw + annotations
        ↓
AiReadyGenerator builds deterministic redacted package and ZIP
```

## Module Boundaries

- `src/capture/session-manager.ts`: Session, Step, Note, finalization, interruption, and counters.
- `src/capture/raw-store.ts`: Raw directory layout, manifest, append-only JSONL, Body files, integrity gaps.
- `src/capture/browser-controller.ts`: Playwright Chromium lifecycle and passive observation.
- `src/capture/injected.ts`: page-side passive listeners for interactions, form snapshots, and SPA URL changes.
- `src/capture/redaction.ts`: deterministic high-confidence credential redaction.
- `src/capture/ai-ready.ts`: deterministic AI-ready package and ZIP generation.
- `src/server/api.ts`: localhost JSON API and static Sidecar serving.
- `src/sidecar/main.tsx`: operational Sidecar and Review UI.
- `src/test-site/server.ts`: local fixture site for automated validation only.

## Runtime Choice

TypeScript + Playwright keeps browser ownership, API serving, filesystem persistence, and tests in one toolchain. Playwright is used as an observation layer; the product does not use it to operate real target pages.
