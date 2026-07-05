# tingyun-capture

Local macOS capture tool for recording real user exploration in a dedicated Chromium profile.

```bash
npm install
npm run build
npm start -- --target-origin http://127.0.0.1:5174
```

## Boundaries

- Runtime Capture is pure code and does not call an LLM.
- Raw under `capture-data/<session_id>/raw/` is the complete private fact source.
- AI-ready under `derived/ai-ready/` is deterministic, redacted, self-contained derived evidence for external AI analysis.
- Capture records browser facts and deterministic observation groups. It does not infer endpoint importance, parameter lineage, business success, or causality.

## AI-ready

Start at `README_FOR_AI.md`, then read `journey.md`, `interaction-windows.jsonl`, and `network-index.jsonl`.

Policy `ai-ready-evidence.v2` copies primary `xhr`, `fetch`, and `document` bodies into `evidence/`. Static resources such as scripts, stylesheets, images, fonts, and media stay in Raw and are summarized in `omissions.json`.

## Docs

- Requirements: `docs/requirements/README.md`
- Architecture: `docs/design/architecture.md`
- AI-ready contract: `docs/contracts/ai-ready.md`
- Runbook: `docs/runbook.md`
- Testing: `docs/testing.md`
