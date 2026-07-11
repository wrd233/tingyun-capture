import { createHash } from "node:crypto";

export interface EndpointInput {
  request_id: string;
  session_id: string;
  window_id?: string;
  method: string;
  url: string;
  request_content_type?: string;
  request_body?: unknown;
  response_content_type?: string;
  response_body?: unknown;
  status?: number;
  resource_type?: string;
}

export function buildEndpointObservations(inputs: EndpointInput[]): Array<Record<string, unknown>> {
  const groups = new Map<string, EndpointInput[]>();
  for (const input of inputs) {
    const key = `${input.method.toUpperCase()} ${input.url}`;
    groups.set(key, [...(groups.get(key) ?? []), input]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, records]) => {
    const first = records[0];
    const url = new URL(first.url);
    return {
      schema_version: 1,
      endpoint_observation_id: `endpoint-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`,
      method: first.method.toUpperCase(),
      exact_url: first.url,
      origin: url.origin,
      path: url.pathname,
      query_field_names: [...new Set(url.searchParams.keys())].sort(),
      request_content_types: unique(records.map((record) => record.request_content_type)),
      request_body_shape: mergeShapes(records.map((record) => shape(record.request_body))),
      response_content_types: unique(records.map((record) => record.response_content_type)),
      response_shape: mergeShapes(records.map((record) => shape(record.response_body))),
      resource_types: unique(records.map((record) => record.resource_type)),
      status_codes_observed: [...new Set(records.map((record) => record.status).filter((value): value is number => value !== undefined))].sort((a, b) => a - b),
      occurrence_count: records.length,
      session_refs: unique(records.map((record) => record.session_id)),
      window_refs: unique(records.map((record) => record.window_id)),
      request_refs: unique(records.map((record) => record.request_id))
    };
  });
}

function shape(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return { type: "array", items: mergeShapes(value.map(shape)) };
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, shape((value as Record<string, unknown>)[key])]));
  return typeof value;
}

function mergeShapes(values: unknown[]): unknown {
  const present = values.filter((value) => value !== "undefined");
  if (present.length === 0) return undefined;
  const encoded = unique(present.map((value) => JSON.stringify(value)));
  return encoded.length === 1 ? present[0] : { any_of: encoded.map((value) => JSON.parse(value)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
}

function unique<T>(values: Array<T | undefined>): T[] {
  return [...new Set(values.filter((value): value is T => value !== undefined))].sort((a, b) => String(a).localeCompare(String(b)));
}
