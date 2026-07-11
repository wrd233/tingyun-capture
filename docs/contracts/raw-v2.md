# Raw v2 Contract

Task path: `capture-data/tasks/<task_id>/`. Session path: `sessions/<session_id>/` with `session.json`, `raw/`, and `derived/`.

Raw streams are `browser-events.jsonl`, `network-requests.jsonl`, `network-responses.jsonl`, `navigations.jsonl`, `downloads.jsonl`, `annotations.jsonl`, and `omissions.jsonl`, plus bodies, screenshots limited to marked windows, and downloads. Streams append facts; body/download bytes are independent files with size/SHA256/status metadata. Every omission is explicit. Existing v1 `raw/manifest.json`, `events.jsonl`, bodies, and downloads remain readable and are not migrated in place.

Fact, Deterministic Observation, Researcher Annotation, and External Inference are distinct layers. Raw contains facts and annotation events only.
