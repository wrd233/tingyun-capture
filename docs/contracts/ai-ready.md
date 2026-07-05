# AI-ready Contract

AI-ready is deterministic derived output stored at:

```text
capture-data/<session_id>/derived/ai-ready/
  README_FOR_AI.md
  session.json
  journey.md
  interaction-windows.jsonl
  events.jsonl
  network-index.jsonl
  integrity.json
  omissions.json
  evidence/
    requests/
    responses/
```

`README_FOR_AI.md` is the only entry point. It explains reading order, fact boundaries, known gaps, and suggested external analysis tasks. It does not answer those tasks.

## Redaction

AI-ready redacts only high-confidence credential material:

- Headers: `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`.
- Query / JSON / form field names: `password`, `passwd`, `access_token`, `refresh_token`, `api_key`, `apikey`, `client_secret`, plus configured extra fields.

Business IDs such as `applicationId`, `actionId`, and `traceGuid` are preserved.

## Evidence Policy

Policy version `ai-ready-evidence.v2` keeps primary analysis bodies for browser resource types `xhr`, `fetch`, and `document`. Their saved request and response bodies are copied into AI-ready `evidence/` after deterministic redaction, and `network-index.jsonl` refs are relative to the AI-ready root.

Static browser resources such as `script`, `stylesheet`, `image`, `font`, `media`, `manifest`, and `other` are not copied into AI-ready by default. They remain complete in Raw. This is deterministic noise reduction, not a Capture gap, and is summarized in `omissions.json` and `integrity.json`.

## Journey and Windows

`journey.md` is the human-readable exploration path, organized around `interaction_recorded` facts. `interaction-windows.jsonl` has one deterministic observation window per interaction. Windows start at the interaction time and end at the earlier of the next same-tab interaction or 5 seconds.

Windows may include observed URL changes, new tabs, and primary requests from the source tab and associated new tabs. Association is recorded as `opener_tab_id` when the browser provides it, or `temporal_proximity` for legacy sessions without opener facts. These fields express observation only, not causality.

## Events

AI-ready `events.jsonl` is a reduced event stream. Network lifecycle events are represented in `network-index.jsonl` instead of being copied into `events.jsonl`. Legacy submit windows without a reliable trigger are filtered from AI-ready.

## Binary

Binary bodies and downloads stay in Raw. AI-ready includes metadata explaining why the bytes are not included.

## ZIP

The Review API can create `<session_id>-ai-ready.zip` from the current AI-ready directory. Raw is never included.
