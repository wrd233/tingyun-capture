# AI-ready Contract

AI-ready is deterministic derived output stored at:

```text
capture-data/<session_id>/derived/ai-ready/
  README_FOR_AI.md
  session.json
  events.jsonl
  network-index.jsonl
  integrity.json
  timeline.md
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

## Binary

Binary bodies and downloads stay in Raw. AI-ready includes metadata explaining why the bytes are not included.

## ZIP

The Review API can create `<session_id>-ai-ready.zip` from the current AI-ready directory. Raw is never included.
