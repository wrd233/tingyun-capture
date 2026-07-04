# Raw Evidence Contract

Raw is stored under:

```text
capture-data/<session_id>/
  raw/
    manifest.json
    events.jsonl
    integrity.json
    bodies/
      requests/
      responses/
    downloads/
  annotations/current.json
  derived/
```

Raw files are private local evidence and may contain credentials or business data. `.gitignore` excludes `capture-data/` and `data/`.

## Manifest

`manifest.json` contains schema version, capture version, target origin, status, timestamps, interruption reason, and AI-ready status.

## Events

`events.jsonl` is append-only during runtime. Core event types include Session, Step, Note, Tab, Frame, URL, interaction, form state, request/response lifecycle, download, and integrity gap events.

## Bodies

Request and response bodies are independent files. JSON is pretty-printed when parseable; text/html stay readable; binary is raw bytes. Bodies over `bodyLimitBytes` are not truncated and instead create a `body_too_large` gap.

## Mutability

After `SEALED`, Raw facts are not edited. Human text lives in `annotations/current.json`; editing annotations makes AI-ready stale.
