# Agent Notes

Before editing, read `docs/requirements/README.md`, the relevant `docs/contracts/` file, and the code path under `src/capture/`.

Hard boundaries:

- Do not add LLM calls to Capture runtime.
- Do not hard-code Tingyun URLs, application IDs, trace IDs, or endpoint allowlists.
- Do not reduce Raw completeness to shrink AI-ready.
- Keep AI-ready grouping deterministic and label time-based associations as observation, not causality.
- Keep real Session zips and extracted data outside Git.

Recommended checks:

```bash
npm run typecheck
npm run test:unit
npm run test:e2e
npm run build
```
