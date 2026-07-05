import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { AiReadyGenerator } from "../../src/capture/ai-ready";
import { buildConfig } from "../../src/capture/config";
import { RawStore, readJson } from "../../src/capture/raw-store";
import { readJsonl } from "../../src/capture/jsonl";
import type { BodyRef, RawEvent, RequestRecord } from "../../src/shared/types";

let tmp = "";

beforeEach(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ty-capture-ai-ready-"));
});

afterEach(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true });
});

test("AI-ready policy keeps xhr fetch document evidence and omits static bodies", async () => {
  const { store, generator, sessionId } = await createSealedSession("policy");
  await appendCompletedRequest(store, "request-0001", "xhr", "/api/data", await responseBody(store, "request-0001", "application/json", { token: "keep", access_token: "secret" }));
  await appendCompletedRequest(store, "request-0002", "fetch", "/api/fetch", await responseBody(store, "request-0002", "application/json", { ok: true }));
  await appendCompletedRequest(store, "request-0003", "document", "/page", await responseBody(store, "request-0003", "text/html", "<!doctype html>"));
  await appendCompletedRequest(store, "request-0004", "script", "/app.js", await responseBody(store, "request-0004", "text/javascript", "console.log('large static');"));
  await appendCompletedRequest(store, "request-0005", "stylesheet", "/app.css", await responseBody(store, "request-0005", "text/css", "body{}"));
  await appendCompletedRequest(store, "request-0006", "image", "/logo.png", await responseBody(store, "request-0006", "image/png", "png"));
  await appendCompletedRequest(store, "request-0007", "font", "/font.woff2", await responseBody(store, "request-0007", "font/woff2", "font"));

  await generator.generate(sessionId);

  const root = store.pathsFor(sessionId).aiReady;
  const index = await readJsonl<Record<string, { ref?: string; save_status?: string } | string>>(path.join(root, "network-index.jsonl"));
  expect(index.map((item) => item.request_id)).toEqual(["request-0001", "request-0002", "request-0003"]);
  expect(index.every((item) => typeof item.resource_type === "string")).toBe(true);
  for (const item of index) {
    const body = item.response_body as { ref?: string; save_status?: string };
    expect(body.ref).toMatch(/^evidence\/responses\//);
    expect(body.ref).not.toContain("raw/bodies");
    await expect(fs.promises.access(path.join(root, body.ref!))).resolves.toBeUndefined();
  }
  const xhrBody = await fs.promises.readFile(path.join(root, (index[0].response_body as { ref: string }).ref), "utf8");
  expect(xhrBody).toContain("***REDACTED***");
  expect(await fs.promises.readdir(path.join(root, "evidence", "responses"))).toHaveLength(3);
  const omissions = await readJson<{ total_requests: number; ai_ready_retained_requests: number; omitted_requests: number; requests_by_resource_type: Record<string, { omitted: number }> }>(
    path.join(root, "omissions.json")
  );
  expect(omissions.total_requests).toBe(7);
  expect(omissions.ai_ready_retained_requests).toBe(3);
  expect(omissions.omitted_requests).toBe(4);
  expect(omissions.requests_by_resource_type.script.omitted).toBe(1);
  expect((await store.loadManifest(sessionId)).ai_ready_status).toBe("READY");
  const session = await readJson<{ manifest: { ai_ready_status: string } }>(path.join(root, "session.json"));
  expect(session.manifest.ai_ready_status).toBe("READY");
});

test("interaction windows group observed URL changes, new tabs, and primary requests without causal fields", async () => {
  const { store, generator, sessionId } = await createSealedSession("windows");
  const at0 = "2026-07-05T00:00:00.000Z";
  await appendEvents(store, [
    { type: "tab_created", at: at0, tab: { tab_id: "tab-0001", created_at: at0, current_url: "http://127.0.0.1:5174/list", first_target_url: "http://127.0.0.1:5174/list" } },
    interaction("interaction-0001", at0, "tab-0001", "http://127.0.0.1:5174/list"),
    { type: "url_changed", at: "2026-07-05T00:00:00.100Z", tab_id: "tab-0001", before_url: "/list", after_url: "/detail", change_type: "pushState" },
    { type: "tab_created", at: "2026-07-05T00:00:00.145Z", tab: { tab_id: "tab-0002", created_at: "2026-07-05T00:00:00.145Z", first_target_url: "http://127.0.0.1:5174/trace", current_url: "http://127.0.0.1:5174/trace" } },
    { type: "url_changed", at: "2026-07-05T00:00:00.200Z", tab_id: "tab-0002", after_url: "http://127.0.0.1:5174/trace", change_type: "navigation" },
    interaction("interaction-0002", "2026-07-05T00:00:02.000Z", "tab-0001", "http://127.0.0.1:5174/detail")
  ]);
  await appendCompletedRequest(store, "request-0001", "xhr", "/trace/api", await responseBody(store, "request-0001", "application/json", { traceGuid: "abc" }), {
    tab_id: "tab-0002",
    started_at: "2026-07-05T00:00:00.300Z"
  });
  await appendCompletedRequest(store, "request-0002", "xhr", "/too-late", await responseBody(store, "request-0002", "application/json", { late: true }), {
    tab_id: "tab-0001",
    started_at: "2026-07-05T00:00:03.000Z"
  });

  await generator.generate(sessionId);

  const windows = await readJsonl<Record<string, unknown>>(path.join(store.pathsFor(sessionId).aiReady, "interaction-windows.jsonl"));
  expect(windows).toHaveLength(2);
  expect(windows[0].association_basis).toEqual(["temporal_proximity", "time_window"]);
  expect(JSON.stringify(windows[0])).toContain("tab-0002");
  expect(JSON.stringify(windows[0])).toContain("request-0001");
  expect(JSON.stringify(windows[0])).not.toContain("request-0002");
  expect(JSON.stringify(windows[0])).not.toMatch(/caused_by|triggered_request|this click caused/);
  const journey = await fs.promises.readFile(path.join(store.pathsFor(sessionId).aiReady, "journey.md"), "utf8");
  expect(journey).toContain("observed_in_window");
  expect(journey).toContain("temporal_proximity");
});

test("legacy submit windows without trigger are filtered from AI-ready events", async () => {
  const { store, generator, sessionId } = await createSealedSession("legacy submit");
  await appendEvents(store, [
    interaction("interaction-0001", "2026-07-05T00:00:00.000Z", "tab-0001", "http://127.0.0.1:5174/nav"),
    { type: "form_state_recorded", at: "2026-07-05T00:00:00.010Z", form_state_id: "form-state-0001", context: "before_submit", state: [] },
    { type: "submit_window_opened", at: "2026-07-05T00:00:00.020Z", submit_window_id: "submit-window-0001", form_state_id: "form-state-0001", closes_at: "2026-07-05T00:00:05.020Z" }
  ]);

  await generator.generate(sessionId);

  const aiEvents = await readJsonl<RawEvent>(path.join(store.pathsFor(sessionId).aiReady, "events.jsonl"));
  expect(aiEvents.some((event) => event.type === "submit_window_opened")).toBe(false);
  expect(aiEvents.some((event) => event.type === "form_state_recorded")).toBe(false);
});

test("validation failure marks AI-ready failed and does not publish a READY bundle", async () => {
  const { store, generator, sessionId } = await createSealedSession("broken refs");
  await appendCompletedRequest(store, "request-0001", "xhr", "/api/broken", {
    ref: "raw/bodies/responses/missing.json",
    kind: "json",
    content_type: "application/json",
    size_bytes: 2,
    save_status: "saved"
  });

  await expect(generator.generate(sessionId)).rejects.toThrow();
  expect((await store.loadManifest(sessionId)).ai_ready_status).toBe("FAILED");
  await expect(fs.promises.access(store.pathsFor(sessionId).aiReady)).rejects.toThrow();
});

async function createSealedSession(name: string): Promise<{ store: RawStore; generator: AiReadyGenerator; sessionId: string }> {
  const config = buildConfig({ targetOrigin: "http://127.0.0.1:5174", outputDir: tmp, openSidecar: false });
  const store = new RawStore(config);
  const generator = new AiReadyGenerator(config, store);
  const manifest = await store.createSession(name);
  await store.updateManifest((current) => ({ ...current, status: "SEALED", sealed_time: "2026-07-05T00:00:10.000Z" }));
  return { store, generator, sessionId: manifest.session_id };
}

async function responseBody(store: RawStore, requestId: string, contentType: string, body: unknown): Promise<BodyRef> {
  return store.saveBody({
    direction: "response",
    requestId,
    contentType,
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

async function appendCompletedRequest(
  store: RawStore,
  requestId: string,
  resourceType: string,
  urlPath: string,
  responseBodyRef: BodyRef,
  overrides: Partial<RequestRecord> = {}
): Promise<void> {
  const startedAt = overrides.started_at ?? "2026-07-05T00:00:00.000Z";
  const completedAt = overrides.completed_at ?? new Date(Date.parse(startedAt) + 20).toISOString();
  const request: RequestRecord = {
    request_id: requestId,
    started_at: startedAt,
    method: "GET",
    url: `http://127.0.0.1:5174${urlPath}`,
    resource_type: resourceType,
    tab_id: overrides.tab_id ?? "tab-0001",
    lifecycle: "completed",
    status: 200,
    response_received_at: completedAt,
    completed_at: completedAt,
    duration_ms: 20,
    response_body: responseBodyRef,
    ...overrides
  };
  await appendEvents(store, [
    { type: "request_started", at: startedAt, request: { ...request, lifecycle: "pending", status: undefined, response_body: undefined } },
    { type: "request_completed", at: completedAt, request }
  ]);
}

async function appendEvents(store: RawStore, events: RawEvent[]): Promise<void> {
  for (const event of events) await store.append(event);
}

function interaction(interactionId: string, at: string, tabId: string, url: string): RawEvent {
  return {
    type: "interaction_recorded",
    at,
    interaction_id: interactionId,
    interaction: {
      tab_id: tabId,
      interaction_type: "click",
      control: { tag: "button", text: "Open" },
      url,
      title: "Page"
    }
  };
}
