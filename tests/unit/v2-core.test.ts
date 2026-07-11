import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { TaskManager } from "../../src/capture/task-manager";
import { buildInteractionWindows } from "../../src/capture/interaction-window";
import { buildNavigationObservations } from "../../src/capture/navigation-observation";
import { buildCorrelationCandidates } from "../../src/capture/correlation";
import { buildEndpointObservations } from "../../src/capture/endpoint-observation";

let root = "";

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ty-capture-v2-core-"));
});

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

test("TaskManager persists minimal tasks and interrupts stale running sessions without rewriting Raw", async () => {
  const manager = new TaskManager(root);
  const task = await manager.createTask({
    task_id: "trace-direct-url",
    title: "Trace URL",
    goal: "Record observed navigation",
    success_criteria: ["record source and target"],
    do_not_assume: ["do not guess the route"],
    created_at: "2026-07-11T00:00:00.000Z"
  });
  const first = await manager.createSession(task.task_id, { session_id: "session-001", started_at: "2026-07-11T00:01:00.000Z" });
  await fs.promises.appendFile(path.join(first.raw_dir, "browser-events.jsonl"), '{"type":"fact"}\n');
  const before = await fs.promises.readFile(path.join(first.raw_dir, "browser-events.jsonl"), "utf8");

  await manager.interruptStaleSessions(task.task_id, "2026-07-11T00:02:00.000Z");

  expect((await manager.readTask(task.task_id)).schema_version).toBe(1);
  expect((await manager.readSession(task.task_id, first.session_id)).status).toBe("INTERRUPTED");
  expect(await fs.promises.readFile(path.join(first.raw_dir, "browser-events.jsonl"), "utf8")).toBe(before);
  expect(Object.keys(task).sort()).toEqual(["created_at", "do_not_assume", "goal", "schema_version", "success_criteria", "task_id", "title"]);
});

test("annotations append MARK NOTE and FINISH without changing browser facts", async () => {
  const manager = new TaskManager(root);
  await manager.createTask({ task_id: "annotations", title: "Annotations", goal: "Record researcher context", success_criteria: [], do_not_assume: [], created_at: "2026-07-11T00:00:00.000Z" });
  const session = await manager.createSession("annotations", { session_id: "session-001", started_at: "2026-07-11T00:01:00.000Z" });
  for (const [index, kind] of ["MARK", "NOTE", "FINISH"].entries()) {
    await manager.appendAnnotation("annotations", "session-001", { annotation_id: `ann-${index + 1}`, kind: kind as "MARK" | "NOTE" | "FINISH", content: kind, created_at: `2026-07-11T00:01:0${index}.000Z`, page_id: "page-1", current_url: "http://example.test/list" });
  }
  const lines = (await fs.promises.readFile(path.join(session.raw_dir, "annotations.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(lines.map((line) => line.kind)).toEqual(["MARK", "NOTE", "FINISH"]);
  expect(lines.every((line) => line.session_id === "session-001")).toBe(true);
});

test("windows and navigation prefer opener association and use observation-only language", () => {
  const events = [
    { type: "interaction_recorded", at: "2026-07-11T00:00:00.000Z", event_id: "event-1", page_id: "page-1", interaction_type: "click", url: "http://example.test/list", title: "List", target: { text: "Trace", href: "/trace/abc" } },
    { type: "page_created", at: "2026-07-11T00:00:00.100Z", event_id: "event-2", page_id: "page-2", opener_page_id: "page-1", url: "http://example.test/trace/abc", title: "Trace" },
    { type: "navigation", at: "2026-07-11T00:00:00.200Z", event_id: "event-3", page_id: "page-2", before_url: "about:blank", after_url: "http://example.test/trace/abc", title: "Trace" },
    { type: "request", at: "2026-07-11T00:00:00.300Z", event_id: "request-1", page_id: "page-2" }
  ];
  const windows = buildInteractionWindows(events);
  const observations = buildNavigationObservations(windows, events);

  expect(windows[0].association_basis).toBe("same_page_or_opener");
  expect(windows[0].event_refs).toContain("event-3");
  expect(observations[0].source.page_id).toBe("page-1");
  expect(observations[0].target.page_id).toBe("page-2");
  expect(JSON.stringify({ windows, observations })).not.toMatch(/caused_by|root_cause|provided_parameter/);
});

test("correlation candidates filter low-value scalars and are deterministic", () => {
  const input = {
    windows: [{ window_id: "iw-001", response_refs: ["response-1"], request_refs: ["request-2"] }],
    responses: [{ event_id: "response-1", body: { data: { actionId: 7788, enabled: true, page: 1, empty: "" } } }],
    requests: [{ event_id: "request-2", url: "http://example.test/detail?actionId=7788&page=1", body: { actionId: 7788 } }]
  };
  const first = buildCorrelationCandidates(input);
  const second = buildCorrelationCandidates(input);

  expect(first).toEqual(second);
  expect(first).toHaveLength(2);
  expect(first.every((candidate) => candidate.relation_status === "CANDIDATE_ONLY")).toBe(true);
  expect(first.some((candidate) => candidate.value_token.includes("7788"))).toBe(false);
  expect(JSON.stringify(first)).not.toContain('"value":7788');
});

test("endpoint observations aggregate exact URLs and shapes without semantic classification", () => {
  const observations = buildEndpointObservations([
    { request_id: "r1", session_id: "s1", window_id: "w1", method: "POST", url: "http://example.test/api/save?actionId=7", request_content_type: "application/json", request_body: { actionId: 7, enabled: true }, response_content_type: "application/json", response_body: { code: -1, data: [] }, status: 200, resource_type: "fetch" },
    { request_id: "r2", session_id: "s1", window_id: "w2", method: "POST", url: "http://example.test/api/save?actionId=7", request_content_type: "application/json", request_body: { actionId: 8, enabled: false }, response_content_type: "application/json", response_body: { code: 0, data: [{}] }, status: 200, resource_type: "fetch" }
  ]);

  expect(observations).toHaveLength(1);
  expect(observations[0].occurrence_count).toBe(2);
  expect(observations[0].query_field_names).toEqual(["actionId"]);
  expect(observations[0].request_body_shape).toEqual({ actionId: "number", enabled: "boolean" });
  expect(JSON.stringify(observations[0])).not.toMatch(/path_template|READ|WRITE|capability|important/);
});
