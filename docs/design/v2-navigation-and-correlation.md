# v2 Navigation and Correlation Design

Navigation Observations are derived from a bounded Interaction Window and preserve source page, researcher action, observed target page, request references, and explicit reload/new-tab/cross-session verification facts. Observed does not mean stable. Verification failures remain facts.

Correlation extraction walks JSON scalars plus request URL path/query and request body scalars. It ignores null, booleans, empty strings, 0/1, common status values, pagination-like low values, containers, binary data, and long text. Exact type-and-value equality produces a `CANDIDATE_ONLY` record with a stable hash, token, ID, and sorted output. It never emits lineage, dependency, parameter source, or cause.

Endpoint aggregation retains exact method/URL/origin/path, query field names, content types, request/response shapes, resource types, observed statuses, counts, and refs. It never templates paths or classifies semantics.
