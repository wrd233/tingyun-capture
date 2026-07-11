# Agent Notes

Before editing, read `docs/requirements/README.md`, `docs/requirements/v2-capture-research-workstation.md`, the relevant `docs/contracts/` file, and the code path under `src/capture/`.

Hard boundaries:

- Do not add LLM calls to Capture runtime.
- Do not hard-code Tingyun URLs, application IDs, trace IDs, or endpoint allowlists.
- Do not reduce Raw completeness to shrink AI-ready.
- Keep AI-ready grouping deterministic and label time-based associations as observation, not causality.
- Keep real Session zips and extracted data outside Git.
- Keep the v2 entity budget limited to Task, Session, Interaction Window, Annotation Event, Navigation Observation, Correlation Candidate, Download Record, and Export Package.
- Build Shareable output from an empty allowlisted directory and require both directory and ZIP scans to pass.
- Keep exact matches named candidates; never promote them to lineage, dependency, cause, READ/WRITE, stable-route, or business-success claims.

Recommended checks:

```bash
npm run typecheck
npm run test:unit
npm run test:e2e
npm run build
```

Before completion also run `npm ci`, `npm run test`, `git diff --check`, a repository secret scan, and local/remote SHA comparison.
