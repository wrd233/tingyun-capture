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
- Header, URL, JSON redaction.
- Reference cURL generation.
- Local browser E2E: cascade form, request/response bodies, pre-submit form state, AI-ready output.

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
