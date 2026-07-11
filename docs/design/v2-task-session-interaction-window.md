# v2 Task, Session, and Interaction Window Design

`TaskManager` persists `task.json`, task events, and task-owned Session directories. Session creation immediately writes RUNNING and initializes append-only Raw streams. Restart detection changes only `session.json` to INTERRUPTED and appends a Task event; it does not touch the old Raw stream. Closing writes CLOSED after capture flush and derivation.

`buildInteractionWindows` is a pure function over ordered facts. Click, submit, select, explicit navigation, MARK, FINISH, and URL verification can start a window. The end is the earlier of the next same-page trigger or five seconds. Opener identity is preferred; fallback is explicitly `temporal_proximity`. The structure contains references and `association_basis`, never causal fields.

The existing v1 `Step` remains readable as annotation context. v2 does not add a competing workflow model.
