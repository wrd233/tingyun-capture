# tingyun-capture v2

Local macOS evidence-first protocol research workstation. It owns a dedicated persistent Chromium, records browser/network/navigation/download facts to append-only Raw Evidence, derives deterministic non-causal observations, and exports private or strictly allowlisted shareable research packages without calling any LLM.

Capture records facts. Interaction Windows organize context. Navigation records observed movement. Correlation records exact-value candidates. External agents infer protocol.

## Install

```bash
npm ci
npx playwright install chromium
npm run build
```

## Research Task and Session

```bash
npm start -- task init \
  --task-id trace-direct-url \
  --title "Trace direct URL" \
  --goal "Record the observed route and parameter candidates" \
  --success-criterion "record source and target URL"

npm start -- session start --task-id trace-direct-url --session-id session-001
npm start -- session stop --task-id trace-direct-url --session-id session-001
npm start -- validate --task-id trace-direct-url
npm start -- export --task-id trace-direct-url --type private
npm start -- export --task-id trace-direct-url --type shareable
```

Task JSON import is supported with `npm start -- task init --from task.json`. All commands accept `--data-root`.

## Start Workstation

```bash
npm start -- --task-id trace-direct-url --target-origin http://127.0.0.1:5174
```

Without `--task-id`, an explicit ad-hoc Task is created. The legacy `npm start -- --target-origin ...` syntax remains valid.

## Boundaries

- Runtime Capture is pure code: no LLM, database, replay, workflow engine, target-page automation, or causal inference.
- v2 Task data is under `capture-data/tasks/<task_id>/`; each Session has independent Raw and Derived directories.
- Existing v1 Session Raw and `ai-ready-evidence.v2` remain readable and are never rewritten in place.
- AI-ready retains `xhr`, `fetch`, and `document` analysis bodies; static bodies remain complete in Raw.
- Private and Shareable are the only physical exports. Shareable starts empty, generates allowlisted redacted files, and must pass scans before and after ZIP creation.
- The browser profile defaults to `~/.tingyun-capture/browser-profile/`, outside capture data, and is never exported.

## Docs

- v2 requirement: `docs/requirements/v2-capture-research-workstation.md`
- architecture: `docs/design/architecture.md`
- contracts: `docs/contracts/`
- runbook: `docs/runbook.md`
- testing and final evidence: `docs/testing.md`, `docs/validation/`
