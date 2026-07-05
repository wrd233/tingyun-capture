# Testing

## Automated

```bash
npm run typecheck
npm run test:unit
npm run test:e2e
npm run build
```

Current coverage includes:

- Session / Step state boundaries.
- Concurrent Session/Step rejection.
- Crash recovery to `INTERRUPTED`.
- Finalization and AI-ready generation.
- JSONL Raw gap recording.
- Body hard-limit behavior.
- Integrity summary.
- AI-ready evidence policy for `xhr`, `fetch`, `document`, and static resource omissions.
- AI-ready self-contained Body refs and missing-evidence validation failure.
- Interaction Window grouping for same-tab changes, legacy new-tab temporal fallback, truncation by next interaction, and non-causal field names.
- Legacy submit-window filtering when no reliable trigger exists.
- Header, URL, JSON redaction.
- Reference cURL generation.
- Local browser E2E: cascade form, request/response bodies, pre-submit form state with trigger, hidden-submit navigation non-submit, opener tab facts, AI-ready output.

## Local Test Site Scenarios

The fixture site includes:

- normal request and new target Tab;
- async cascade form;
- final `/save` submit;
- delayed request, failure, download, iframe, redirect, and SPA URL page.

## Real Tingyun Manual Validation

Do not automate real Tingyun access. User should manually run:

1. Complex form and final submit: inspect options, technical values, cascade facts, pre-submit state, payload, and response.
2. Problem to application to transaction to Trace to URL: inspect multi-Tab continuity, URL/query/hash, business IDs, and request/response facts.
3. Long Session: inspect multi-Step reliability, Sidecar refresh, delayed requests, finalization, and AI-ready generation.
4. Fresh AI reading test: give only AI-ready ZIP to an external Agent and verify it can start at `README_FOR_AI.md` and cite stable evidence IDs.

## Real Session Regression

Use real Session zips only outside Git. Unzip into a temporary output directory, point `RawStore` at that directory, and regenerate AI-ready from Raw. Check:

- AI-ready size is at least 80% smaller and under 3 MB for the current regression sample.
- `network-index.jsonl` contains primary `xhr` / `fetch` / `document` requests with `resource_type`.
- Saved Body refs are bundle-relative `evidence/...` paths and pass AI-ready validation without Raw.
- `journey.md` and `interaction-windows.jsonl` are organized around human interactions.
- Legacy submit misfires without trigger metadata are absent from AI-ready Journey and events.
