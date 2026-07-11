# Tingyun Capture v2 Design

## Decision

Upgrade the existing TypeScript, Playwright, Express, React, and filesystem implementation in place. Preserve the v1 session reader and AI-ready contract while adding a Task-owned v2 write path, deterministic research derivation, and two allowlisted export modes. Capture continues to record facts only and never calls an LLM, replays target requests, or automates target pages.

## Architecture

- `TaskManager` owns minimal task metadata, task events, v2 session placement, ad-hoc task creation, and task-level deterministic indexes.
- Existing `RawStore` remains the v1 compatibility reader and gains a v2-compatible session layout adapter; sealed v1 Raw is never rewritten.
- `InteractionWindowBuilder`, `NavigationObservationBuilder`, `CorrelationEngine`, and endpoint/download normalizers are pure deterministic derivation modules.
- `ResearchPackageBuilder` assembles task research indexes and the single `README_FOR_RESEARCH.md` entry point.
- `PackageSecurity` builds shareable output from an empty directory using an allowlist, stable task-wide tokenization, pre-ZIP scanning, and ZIP-entry rescanning. High-risk secrets block publication.
- `Validator` checks task/session schemas, JSONL and evidence references, integrity gaps, derived indexes, export state, and v1 compatibility.
- Express and the existing Sidecar expose the new operations and review lists without adding login, dashboards, graph editors, or automatic browsing.

## Data Flow

Research Task metadata is persisted first. A Session immediately writes `RUNNING`, appends browser/network/download/annotation facts, then on stop flushes Raw, derives deterministic session artifacts, validates references, updates Task research indexes, and becomes `CLOSED`. A stale `RUNNING` session is marked `INTERRUPTED` without altering its Raw stream. Private export copies explicit task-owned evidence except profiles and environment files. Shareable export generates redacted files from source records into an empty staging directory, scans them, archives them, and scans archive entries again.

## Compatibility

The existing v1 layout, commands, Raw schema, and `ai-ready-evidence.v2` generation remain readable. The legacy start command maps to an explicit ad-hoc Task. v2 writes schema-versioned task/session data without bulk migration. Browser profiles default outside the capture data root and are never eligible for export.

## Failure Handling

Append/write/body/download failures create explicit integrity or omission facts. Export staging is atomic and retained only on diagnosable failure. Secret findings produce `BLOCKED`; broken schemas or references produce validation `FAILED`; policy omissions, interrupted sessions, and unperformed optional URL verification may produce `PARTIAL`. No failure is converted into a protocol conclusion.

## UI

The Sidecar keeps its compact two-column workstation layout. It adds current Task/Page/Window/health facts, Mark/Note/Finish and explicit URL verification controls, export/validate actions, and review sections for windows, navigation observations, candidates, downloads, and security. Controls remain semantic, keyboard reachable, visibly focused, and responsive.

## Verification

Tests cover schemas, lifecycle and compatibility; deterministic windows/navigation/correlation/endpoints; download normalization; aggregation; stable tokenization and secret blocking; allowlist/ZIP rescanning; validator references; API/UI flows; and a complete local fixture workflow. Final evidence includes typecheck, unit, E2E, aggregate tests, build, deterministic regeneration hashes, secret scan, Git diff check, push verification, and clean worktree.
