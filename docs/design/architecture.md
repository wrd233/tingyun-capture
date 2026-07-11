# Architecture v2

`tingyun-capture v2` retains the three local runtime parts and adds deterministic filesystem research modules:

1. Capture Engine: TypeScript Node process that owns state, Raw persistence, browser observation, and deterministic derived output.
2. Dedicated Chromium: launched and closed by Capture through Playwright `launchPersistentContext`, with a persistent profile directory.
3. Sidecar Web UI: React UI served by the localhost API after `npm run build`.

Task/session ownership, windows, navigation observations, correlation candidates, endpoint shapes, download normalization, research aggregation, validation, and package security remain small TypeScript modules. They communicate through versioned JSON/JSONL files; no database or workflow engine is present.

All local services bind to `127.0.0.1`. Runtime has no LLM, model API, prompt manager, endpoint ranking, replay, screenshot, video, or automation explorer.

## Data Flow

```text
User operates Dedicated Chromium
        ↓
Playwright page/network/download events + injected passive DOM listeners
        ↓
TaskManager owns Task / Session placement; SessionManager preserves v1 capture compatibility
        ↓
RawStore appends JSONL events and writes Body files incrementally
        ↓
Review API reads Raw + annotations
        ↓
AiReadyGenerator preserves internal AI-ready; ResearchPackageBuilder builds Task research indexes and Private/Shareable packages
```

## Module Boundaries

- `src/capture/session-manager.ts`: Session, Step, Note, finalization, interruption, and counters.
- `src/capture/raw-store.ts`: Raw directory layout, manifest, append-only JSONL, Body files, integrity gaps.
- `src/capture/browser-controller.ts`: Playwright Chromium lifecycle and passive observation.
- `src/capture/injected.ts`: page-side passive listeners for interactions, form snapshots, and SPA URL changes.
- `src/capture/redaction.ts`: deterministic high-confidence credential redaction.
- `src/capture/ai-ready.ts`: deterministic AI-ready package and ZIP generation.
- `src/capture/task-manager.ts`: minimal Tasks, task-owned Sessions, annotations, and stale-session interruption.
- `src/capture/interaction-window.ts`: deterministic non-causal observation windows.
- `src/capture/navigation-observation.ts`: observed movement and explicit verification facts.
- `src/capture/correlation.ts`: filtered exact-scalar candidate matching.
- `src/capture/endpoint-observation.ts`: exact URL and shape aggregation without semantic classification.
- `src/capture/download-normalizer.ts`: SHA256 and CSV/XLSX sheet normalization; `.xls` is reported unsupported.
- `src/capture/research-package.ts`: Task indexes, research entry point, promotion input, and exports.
- `src/capture/package-security.ts`: stable tokenization, secret blocking, and directory/ZIP scanning.
- `src/capture/validator.ts`: schema, JSONL, lifecycle, and reference validation reports.
- `src/server/api.ts`: localhost JSON API and static Sidecar serving.
- `src/sidecar/main.tsx`: operational Sidecar and Review UI.
- `src/test-site/server.ts`: local fixture site for automated validation only.

## Runtime Choice

TypeScript + Playwright keeps browser ownership, API serving, filesystem persistence, and tests in one toolchain. Playwright is used as an observation layer; the product does not use it to operate real target pages.
