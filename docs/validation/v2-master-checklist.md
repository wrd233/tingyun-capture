# Tingyun Capture v2 Master Checklist

Status vocabulary: `CLOSED_VERIFIED`, `NOT_APPLICABLE_WITH_PROOF`, `EXTERNALLY_BLOCKED_WITH_PROOF`.

| Area | Deliverable | Status | Evidence |
|---|---|---|---|
| Baseline | Starting branch/head/origin/tree recorded | CLOSED_VERIFIED | `main`; local/origin `ff57c0bd7729e0166a69b29cd45816ac256a049a`; clean at intake |
| Baseline | Existing requirements, design, contracts, code, and tests read in required order | CLOSED_VERIFIED | 2026-07-11 intake record |
| Baseline | Existing checks run and missing Playwright browser repaired | CLOSED_VERIFIED | 11 unit PASS; browser installed; 3 legacy E2E PASS |
| Architecture | No LLM/database/workflow engine; localhost-only; existing stack retained | CLOSED_VERIFIED | dependency/source scan and architecture contract |
| Task | Minimal schema, CLI create/import, multiple Sessions, deterministic aggregation | CLOSED_VERIFIED | `v2-core.test.ts`, CLI smoke |
| Session | Task ownership, RUNNING/CLOSED/INTERRUPTED, stale detection, v1 compatibility | CLOSED_VERIFIED | unit lifecycle and unchanged v1 AI-ready/E2E suites |
| Annotation | MARK/NOTE/FINISH append-only facts | CLOSED_VERIFIED | annotation append regression |
| Windows | Deterministic boundaries, opener association, temporal fallback, non-causal language | CLOSED_VERIFIED | observation regressions and full fixture flow |
| Navigation | Observation, Record URL, Reload/New-tab and cross-session reference model | CLOSED_VERIFIED | browser controls, API facts, contracts, fixture flow |
| Correlation | Exact scalar matches, filters, stable candidates/tokens/order | CLOSED_VERIFIED | deterministic correlation regressions |
| Endpoint | Exact method/URL/path/query/body/response shapes without semantic classification | CLOSED_VERIFIED | endpoint shape regression |
| Downloads | Raw facts/SHA256 and deterministic CSV/XLSX normalization; `.xls` explicit unsupported | CLOSED_VERIFIED | download unit tests and two-download browser flow |
| Derived | AI-ready compatibility, Task indexes, evidence presence, promotion input | CLOSED_VERIFIED | legacy AI-ready tests and research package flow |
| Export | Private and Shareable only; empty allowlist staging; deterministic core contents | CLOSED_VERIFIED | package tests, CLI smoke, full fixture exports |
| Security | Secret blocking, stable tokenization, filename/path handling, pre/post ZIP scan | CLOSED_VERIFIED | security regressions, ZIP rescan, zero audit vulnerabilities |
| Sidecar/CLI | Minimal controls, review lists, compatibility entry points | CLOSED_VERIFIED | typecheck/build, CLI smoke, browser E2E |
| Validate | Schemas, JSONL, bodies, windows, navigation, correlation, AI-ready refs, orphans, lifecycle | CLOSED_VERIFIED | PASS flow and broken-reference FAILED regression |
| Fixtures/tests | Unit, E2E, security, compatibility, determinism, complete local workflow | CLOSED_VERIFIED | 27 automated tests |
| Documentation | Requirements, designs, contracts, runbook, testing, templates, closure evidence | CLOSED_VERIFIED | required files present and terminology scan clean |
| Git | Secret-safe commit, pushed main, local/remote equality, clean tree | CLOSED_VERIFIED | required final Git commands and publish verification |
