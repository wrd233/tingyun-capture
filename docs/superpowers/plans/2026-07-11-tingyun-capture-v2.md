# Tingyun Capture v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the complete evidence-first protocol research workstation defined by the v2 Goal while preserving v1 compatibility.

**Architecture:** Extend the filesystem runtime with Task-owned v2 sessions and focused deterministic derivation modules. Keep browser capture passive, Raw append-only, AI-ready compatible, and exports allowlist-driven with blocking security scans.

**Tech Stack:** TypeScript, Node.js, Playwright, Express, React, Vitest, Vite, Zod, Archiver, SheetJS.

## Global Constraints

- macOS local single-user runtime; all services bind `127.0.0.1`.
- Capture Runtime has no LLM, database, replay, automatic target-page actions, causal inference, or workflow engine.
- Raw is append-only and v1 Raw is never rewritten.
- Derived output and tokenization are deterministic for frozen input.
- Private and Shareable are the only physical export modes; Shareable starts from an empty allowlisted staging directory.

---

### Task 1: Task and Session contracts

**Files:** `src/shared/types.ts`, `src/capture/task-manager.ts`, `src/capture/raw-store.ts`, `src/capture/session-manager.ts`, `src/main.ts`, `tests/unit/task-session-v2.test.ts`

**Interfaces:** Produces minimal `ResearchTask`, v2 `SessionManifest`, `TaskManager.initTask()`, task-owned session paths, stale `RUNNING -> INTERRUPTED`, ad-hoc compatibility, and Commander task/session commands.

- [x] Write schema/lifecycle/compatibility tests and run them to observe the expected missing-interface failures.
- [x] Implement minimal task/session persistence and CLI compatibility.
- [x] Run focused tests and typecheck; refactor only after green.

### Task 2: Annotation, windows, and navigation

**Files:** `src/capture/interaction-window.ts`, `src/capture/navigation-observation.ts`, `src/capture/browser-controller.ts`, `src/capture/injected.ts`, `tests/unit/observation-v2.test.ts`

**Interfaces:** Produces deterministic MARK/NOTE/FINISH windows, opener-first association with labeled temporal fallback, observed navigation records, and explicit reload/new-tab verification facts.

- [x] Write failing boundary, multi-tab, navigation, and verification tests.
- [x] Implement pure builders and explicit browser control methods.
- [x] Run focused tests and typecheck.

### Task 3: Correlation and endpoint observations

**Files:** `src/capture/correlation.ts`, `src/capture/endpoint-observation.ts`, `tests/unit/research-derivation-v2.test.ts`

**Interfaces:** Produces filtered exact scalar candidates with stable IDs/tokens and exact-URL endpoint shape aggregates without lineage, READ/WRITE, templates, or importance claims.

- [x] Write failing scalar/filter/determinism/shape tests.
- [x] Implement deterministic extraction, sorting, hashing, and aggregation.
- [x] Run focused tests and typecheck.

### Task 4: Downloads and research aggregation

**Files:** `src/capture/download-normalizer.ts`, `src/capture/research-package.ts`, `src/capture/ai-ready.ts`, `tests/unit/package-v2.test.ts`

**Interfaces:** Produces SHA256 download records, CSV/XLSX normalized sheets, extended AI-ready files, task indexes, evidence-presence statuses, promotion input, and `README_FOR_RESEARCH.md`.

- [x] Write failing normalization, AI-ready compatibility, aggregation, and deterministic output tests.
- [x] Implement normalization and research derivation.
- [x] Run focused tests and typecheck.

### Task 5: Export security and validation

**Files:** `src/capture/package-security.ts`, `src/capture/research-package.ts`, `src/capture/validator.ts`, `tests/unit/security-validator-v2.test.ts`

**Interfaces:** Produces stable task-wide tokenization, pre/post ZIP scans, blocking reports, allowlisted private/shareable archives, and PASS/PARTIAL/FAILED validation reports.

- [x] Write failing secret, filename/path, allowlist, ZIP-rescan, ref, and determinism tests.
- [x] Implement scanners, exporters, and validator with atomic staging.
- [x] Run focused tests and typecheck.

### Task 6: API, Sidecar, CLI, and local fixture E2E

**Files:** `src/server/api.ts`, `src/sidecar/main.tsx`, `src/sidecar/styles.css`, `src/test-site/server.ts`, `tests/e2e/capture-flow.test.ts`

**Interfaces:** Exposes task/session/annotation/verify/validate/export operations and compact review lists; fixture covers list/detail/SPA/popup/fetch/correlation/CSV/XLSX/secrets/large body/failure/HTTP-200-code-minus-one.

- [x] Extend E2E first and observe missing endpoint/control failures.
- [x] Implement API/browser/Sidecar/fixture behavior with accessible controls.
- [x] Run E2E, aggregate tests, typecheck, and build.

### Task 7: Documentation, real fixture validation, and finish-work

**Files:** all Goal-required README, requirements, design, contract, runbook, testing, templates, and validation reports.

**Interfaces:** Produces contract-complete docs, closure matrix, real local fixture hashes/results, and clean published `main`.

- [x] Run the full local Task workflow, both exports, ZIP inspection, secret regression, and deterministic regeneration comparison.
- [x] Update every required document and close every checklist row with evidence.
- [x] Run `npm ci`, typecheck, unit, E2E, aggregate tests, build, diff check, and secret scan.
- [x] Commit, push `origin/main`, fetch, compare SHAs, and verify a clean worktree.
