import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { StableTokenizer, scanDirectory, scanZip } from "../../src/capture/package-security";
import { ResearchPackageBuilder } from "../../src/capture/research-package";
import { TaskManager } from "../../src/capture/task-manager";
import { validateTask } from "../../src/capture/validator";

let root = "";

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ty-capture-v2-security-"));
});

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

test("stable tokenizer maps the same values consistently without exposing its mapping", () => {
  const tokenizer = new StableTokenizer();
  expect(tokenizer.tokenize("traceGuid", "abc-123")).toBe("trace-guid-001");
  expect(tokenizer.tokenize("traceGuid", "abc-123")).toBe("trace-guid-001");
  expect(tokenizer.tokenize("traceGuid", "def-456")).toBe("trace-guid-002");
  expect(JSON.stringify(tokenizer.publicReport())).not.toContain("abc-123");
});

test("security scan blocks high-risk secrets, env files, profiles, and absolute home paths", async () => {
  const dir = path.join(root, "unsafe");
  await fs.promises.mkdir(path.join(dir, "browser-profile"), { recursive: true });
  await fs.promises.writeFile(path.join(dir, ".env"), "TOKEN=secret\n");
  await fs.promises.writeFile(path.join(dir, "facts.json"), JSON.stringify({ Authorization: "Bearer fake.jwt.token", path: "/Users/alice/private" }));
  const report = await scanDirectory(dir);
  expect(report.status).toBe("BLOCKED");
  expect(report.findings.map((finding) => finding.kind)).toEqual(expect.arrayContaining(["forbidden_file", "browser_profile", "authorization", "bearer_or_jwt", "absolute_home_path"]));
});

test("shareable export is allowlisted, rescanned, deterministic, and validates", async () => {
  const manager = new TaskManager(root);
  await manager.createTask({ task_id: "safe-task", title: "Safe", goal: "Record facts", success_criteria: ["navigation"], do_not_assume: [], created_at: "2026-07-11T00:00:00.000Z" });
  const session = await manager.createSession("safe-task", { session_id: "session-001", started_at: "2026-07-11T00:01:00.000Z" });
  await fs.promises.writeFile(path.join(session.raw_dir, "network-requests.jsonl"), JSON.stringify({ request_id: "r1", method: "GET", url: "http://10.0.0.2/detail?traceGuid=abc-123", headers: {} }) + "\n");
  await manager.closeSession("safe-task", "session-001", "2026-07-11T00:02:00.000Z");
  const builder = new ResearchPackageBuilder(root);

  const first = await builder.exportTask("safe-task", "shareable");
  const firstScan = await scanZip(first.zip_path);
  const second = await builder.exportTask("safe-task", "shareable");
  const validation = await validateTask(root, "safe-task");

  expect(first.security.status).toBe("PASS");
  expect(firstScan.status).toBe("PASS");
  expect(first.core_hashes).toEqual(second.core_hashes);
  expect(first.files).toContain("README_FOR_RESEARCH.md");
  expect(first.files.some((file) => file.includes("raw/"))).toBe(false);
  expect(validation.status).toBe("PASS");
});

test("shareable export refuses publication when source facts contain high-risk secrets", async () => {
  const manager = new TaskManager(root);
  await manager.createTask({ task_id: "blocked-task", title: "Blocked", goal: "Record facts", success_criteria: [], do_not_assume: [], created_at: "2026-07-11T00:00:00.000Z" });
  const session = await manager.createSession("blocked-task", { session_id: "session-001", started_at: "2026-07-11T00:01:00.000Z" });
  await fs.promises.writeFile(path.join(session.raw_dir, "network-requests.jsonl"), JSON.stringify({ headers: { Authorization: "Bearer fake.jwt.token" } }) + "\n");
  await manager.closeSession("blocked-task", "session-001", "2026-07-11T00:02:00.000Z");

  await expect(new ResearchPackageBuilder(root).exportTask("blocked-task", "shareable")).rejects.toThrow(/BLOCKED/);
});

test("validator fails broken derived references and missing body evidence", async () => {
  const manager = new TaskManager(root);
  await manager.createTask({ task_id: "broken-task", title: "Broken", goal: "Validate refs", success_criteria: [], do_not_assume: [], created_at: "2026-07-11T00:00:00.000Z" });
  const session = await manager.createSession("broken-task", { session_id: "session-001", started_at: "2026-07-11T00:01:00.000Z" });
  await fs.promises.writeFile(path.join(session.raw_dir, "network-requests.jsonl"), JSON.stringify({ type: "request_completed", request: { request_id: "request-1", request_body: { ref: "raw/bodies/requests/missing.json", save_status: "saved" } } }) + "\n");
  await fs.promises.writeFile(path.join(session.derived_dir, "interaction-windows.jsonl"), JSON.stringify({ window_id: "iw-1", event_refs: ["missing-event"], request_refs: ["request-1"], response_refs: [], navigation_refs: [], download_refs: [], annotation_refs: [] }) + "\n");
  await manager.closeSession("broken-task", "session-001", "2026-07-11T00:02:00.000Z");
  const report = await validateTask(root, "broken-task");
  expect(report.status).toBe("FAILED");
  expect(report.errors.join("\n")).toMatch(/missing-event|missing\.json/);
});
