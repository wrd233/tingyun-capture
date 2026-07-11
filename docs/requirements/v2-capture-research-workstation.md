# v2 Capture Research Workstation Requirement

v2 turns a real UI exploration into a Task-owned, auditable, reviewable, safely deliverable research asset. The Capture Runtime remains pure deterministic code and never calls an LLM, operates a target page automatically, replays a request, infers causality, judges business success, or promotes an endpoint.

## Required entities

Only Research Task, Session, Interaction Window, Annotation Event, Navigation Observation, Correlation Candidate, Download Record, and Export Package are top-level v2 entities. A Task has minimal goal/success/do-not-assume metadata and multiple independent Sessions. Session states are RUNNING, CLOSED, and INTERRUPTED.

## Evidence model

Raw is append-only private fact evidence. Interaction Windows group same-page/opener or labeled temporal facts. Navigation Observations record source/action/target and explicit verification results. Correlation Candidates only report exact scalar equality within bounded windows. Endpoint Observations aggregate exact URLs and data shapes without path templates or READ/WRITE labels. Researcher annotations are MARK, NOTE, and FINISH. Protocol conclusions remain external inference.

## Output

Each Session has independent Raw and Derived directories. Task research indexes remain separate. Existing v1 Raw and `ai-ready-evidence.v2` are read-compatible and never rewritten. Private and Shareable are the only physical packages. Shareable is generated from an empty allowlisted directory with stable task-wide tokenization, blocking secret detection, pre-ZIP scanning, and ZIP-entry rescanning.

## Acceptance

Task/Session CLI, localhost Sidecar controls, deterministic derivation, CSV/XLS/XLSX normalization, validation, security reports, local fixture E2E, compatibility tests, documentation, clean commit, and `origin/main` alignment are required together.
