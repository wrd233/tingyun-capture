# Runbook

## Install

```bash
npm install
npm run build
```

## Start Capture

```bash
npm start -- --target-origin http://127.0.0.1:5174
```

Useful options:

```bash
--output-dir capture-data
--profile-dir capture-data/browser-profile
--port 43127
--body-limit-bytes 10485760
--no-open-sidecar
```

The Sidecar listens on `http://127.0.0.1:43127` by default. Capture launches a dedicated Chromium with a persistent profile.

## Stop

Normal stop:

1. End the active Session in Sidecar.
2. Wait for `SEALED`.
3. Press `Ctrl+C` in the Capture terminal.

If `Ctrl+C` is used while a Session is active, Capture records `INTERRUPTED` with reason `engine_stopped`.

## Local Test Site

```bash
npm run test-site
```

Then start Capture with:

```bash
npm start -- --target-origin http://127.0.0.1:5174
```

## Raw Safety

Raw is private local data. Do not share `capture-data/<session_id>/raw/`. Use the AI-ready ZIP for external analysis.

## AI-ready Review

AI-ready is generated when a Session seals and can be regenerated from Review. The package is self-contained under:

```text
capture-data/<session_id>/derived/ai-ready/
```

External AI should read `README_FOR_AI.md` first, then `journey.md`, `interaction-windows.jsonl`, and `network-index.jsonl`. Static resource bodies are intentionally omitted from AI-ready and remain in Raw.
