import { createHash } from "node:crypto";

type Scalar = string | number;

export interface CorrelationCandidate {
  schema_version: 1;
  candidate_id: string;
  kind: "exact_value_match";
  source: { event_id: string; field_path: string };
  target: { event_id: string; field_path: string };
  value_token: string;
  value_type: "string" | "number";
  value_hash: string;
  scope: "same_interaction_window";
  relation_status: "CANDIDATE_ONLY";
}

export function buildCorrelationCandidates(input: {
  windows: Array<{ window_id: string; response_refs: string[]; request_refs: string[] }>;
  responses: Array<{ event_id: string; body: unknown }>;
  requests: Array<{ event_id: string; url: string; body?: unknown }>;
}): CorrelationCandidate[] {
  const responses = new Map(input.responses.map((item) => [item.event_id, item]));
  const requests = new Map(input.requests.map((item) => [item.event_id, item]));
  const matches: Array<Omit<CorrelationCandidate, "candidate_id" | "value_token"> & { raw: Scalar }> = [];
  for (const window of [...input.windows].sort((a, b) => a.window_id.localeCompare(b.window_id))) {
    for (const responseRef of [...window.response_refs].sort()) {
      const response = responses.get(responseRef);
      if (!response) continue;
      for (const [sourcePath, sourceValue] of extractScalars(response.body)) {
        if (!useful(sourceValue)) continue;
        for (const requestRef of [...window.request_refs].sort()) {
          const request = requests.get(requestRef);
          if (!request) continue;
          const targets = [...extractScalars(request.body, "$.body"), ...extractUrlScalars(request.url)];
          for (const [targetPath, targetValue] of targets) {
            if (sameScalar(sourceValue, targetValue)) {
              const hash = createHash("sha256").update(`${typeof sourceValue}:${String(sourceValue)}`).digest("hex");
              matches.push({ schema_version: 1, kind: "exact_value_match", source: { event_id: responseRef, field_path: sourcePath }, target: { event_id: requestRef, field_path: targetPath }, value_type: typeof sourceValue as "string" | "number", value_hash: hash, scope: "same_interaction_window", relation_status: "CANDIDATE_ONLY", raw: sourceValue });
            }
          }
        }
      }
    }
  }
  matches.sort((a, b) => `${a.source.event_id}|${a.source.field_path}|${a.target.event_id}|${a.target.field_path}`.localeCompare(`${b.source.event_id}|${b.source.field_path}|${b.target.event_id}|${b.target.field_path}`));
  const tokenByHash = new Map<string, string>();
  return matches.map(({ raw: _raw, ...match }) => {
    if (!tokenByHash.has(match.value_hash)) tokenByHash.set(match.value_hash, `value-${String(tokenByHash.size + 1).padStart(4, "0")}`);
    const signature = `${match.source.event_id}|${match.source.field_path}|${match.target.event_id}|${match.target.field_path}|${match.value_hash}`;
    return { ...match, candidate_id: `corr-${createHash("sha256").update(signature).digest("hex").slice(0, 12)}`, value_token: tokenByHash.get(match.value_hash)! };
  });
}

function extractScalars(value: unknown, root = "$", depth = 0): Array<[string, Scalar]> {
  if (depth > 12) return [];
  if (typeof value === "string" || typeof value === "number") return [[root, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => extractScalars(item, `${root}[${index}]`, depth + 1));
  if (value && typeof value === "object") return Object.keys(value as object).sort().flatMap((key) => extractScalars((value as Record<string, unknown>)[key], `${root}.${key}`, depth + 1));
  return [];
}

function extractUrlScalars(rawUrl: string): Array<[string, Scalar]> {
  const url = new URL(rawUrl);
  const query = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [`$.url.query.${key}`, parseScalar(value)] as [string, Scalar]);
  const pathParts = url.pathname.split("/").filter(Boolean).map((value, index) => [`$.url.path[${index}]`, parseScalar(decodeURIComponent(value))] as [string, Scalar]);
  return [...query, ...pathParts];
}

function parseScalar(value: string): Scalar {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? Number(value) : value;
}

function useful(value: Scalar): boolean {
  if (typeof value === "number") return Number.isFinite(value) && ![0, 1, 200, 201, 204, 400, 401, 403, 404, 500].includes(value) && Math.abs(value) > 1;
  const text = value.trim();
  return text.length >= 2 && text.length <= 256 && !["true", "false", "null", "undefined"].includes(text.toLowerCase());
}

function sameScalar(a: Scalar, b: Scalar): boolean {
  return typeof a === typeof b && a === b;
}
