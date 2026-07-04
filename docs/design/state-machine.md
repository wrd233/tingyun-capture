# State Machine

## Session

```text
IDLE
  -> ACTIVE
  -> FINALIZING
  -> SEALED
```

Abnormal path:

```text
ACTIVE
  -> INTERRUPTED
  -> SEALED after explicit review/seal action
```

Rules implemented in `SessionManager`:

- Only one unfinished Session may exist.
- `startSession` requires only a name.
- `endSession` fixes `end_time` immediately, stops accepting new request starts, waits the configured finalization window, marks remaining pending requests `incomplete`, writes integrity, seals Raw, then generates AI-ready.
- `interrupt` fixes interruption reason and does not generate AI-ready.
- Startup recovery converts persisted `ACTIVE` or `FINALIZING` manifests into `INTERRUPTED` with reason `capture_restarted`.
- Active Engine stop calls `interrupt("engine_stopped")`.
- Dedicated Chromium close calls `interrupt("browser_closed")`.

## Step

```text
no active Step -> ACTIVE Step -> no active Step
```

Rules:

- Only one active Step.
- Step intent is required.
- Step `ended_at` is fixed immediately.
- Step does not start or stop capture.
- Request ownership is assigned at request start using the current active Step ID.

## Notes

Notes are allowed only while Session is `ACTIVE`. The API binds note time, active Step, active target Tab, URL, and title automatically.
