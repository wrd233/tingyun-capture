import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, expect, test } from "vitest";
import { buildConfig } from "../../src/capture/config";
import { AiReadyGenerator } from "../../src/capture/ai-ready";
import { BrowserController } from "../../src/capture/browser-controller";
import { RawStore } from "../../src/capture/raw-store";
import { SessionManager } from "../../src/capture/session-manager";
import { createTestSiteApp } from "../../src/test-site/server";
import { TaskManager } from "../../src/capture/task-manager";
import { ResearchPackageBuilder } from "../../src/capture/research-package";
import { validateTask } from "../../src/capture/validator";
import { readJsonl } from "../../src/capture/jsonl";

let tmp = "";
let server: Server | undefined;
let origin = "";
let browser: BrowserController | undefined;

beforeEach(async () => {
  process.env.CAPTURE_HEADLESS = "1";
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ty-capture-e2e-"));
  server = await listenRandomPort();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind to TCP");
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await browser?.stop().catch(() => undefined);
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await fs.promises.rm(tmp, { recursive: true, force: true });
  delete process.env.CAPTURE_HEADLESS;
});

test("captures cascade form submit into Raw and AI-ready evidence", async () => {
  const config = buildConfig({ targetOrigin: origin, outputDir: tmp, profileDir: path.join(tmp, "profile"), openSidecar: false });
  config.finalizationTimeoutMs = 250;
  const store = new RawStore(config);
  const aiReady = new AiReadyGenerator(config, store);
  const sessions = new SessionManager(config, store, aiReady);
  browser = new BrowserController(config, store, sessions);
  await browser.start();

  const manifest = await sessions.startSession("级联表单提交");
  const page = await browser.openPageForTest(`${origin}/cascade`);
  await sessions.startStep("选择应用并保存");
  await page.selectOption("#app", "2033");
  await page.waitForSelector("#tx option[value=tx-login]", { state: "attached" });
  await page.fill("input[name=threshold]", "5000");
  await page.click("button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#result")?.textContent?.includes("saved"));
  await sessions.endStep("保存请求已发生");
  const sealed = await sessions.endSession("本地测试提交完成");

  expect(sealed.status).toBe("SEALED");
  const events = await store.events(manifest.session_id);
  expect(events.some((event) => event.type === "form_state_recorded" && event.context === "before_submit")).toBe(true);
  const saveRequest = events.find((event) => event.type === "request_completed" && event.request.url.endsWith("/save"));
  expect(saveRequest?.type).toBe("request_completed");
  if (!saveRequest || saveRequest.type !== "request_completed") throw new Error("save request was not captured");
  expect(saveRequest.request.request_body?.save_status).toBe("saved");
  expect(saveRequest.request.response_body?.save_status).toBe("saved");
  const readme = await fs.promises.readFile(path.join(tmp, manifest.session_id, "derived", "ai-ready", "README_FOR_AI.md"), "utf8");
  expect(readme).toContain("README_FOR_AI");
  const networkIndex = await fs.promises.readFile(path.join(tmp, manifest.session_id, "derived", "ai-ready", "network-index.jsonl"), "utf8");
  expect(networkIndex).toContain("/save");
});

test("does not open submit windows for navigation clicks with hidden submit controls", async () => {
  const config = buildConfig({ targetOrigin: origin, outputDir: tmp, profileDir: path.join(tmp, "profile"), openSidecar: false });
  config.finalizationTimeoutMs = 100;
  const store = new RawStore(config);
  const aiReady = new AiReadyGenerator(config, store);
  const sessions = new SessionManager(config, store, aiReady);
  browser = new BrowserController(config, store, sessions);
  await browser.start();

  const manifest = await sessions.startSession("导航点击");
  const page = await browser.openPageForTest(`${origin}/nav-submit`);
  await page.click("#plain-nav");
  await page.waitForURL(`${origin}/reliability`);
  await sessions.endSession("导航结束");

  const events = await store.events(manifest.session_id);
  expect(events.some((event) => event.type === "interaction_recorded" && event.interaction.interaction_type === "click")).toBe(true);
  expect(events.some((event) => event.type === "submit_window_opened")).toBe(false);
  const aiReadyEvents = await fs.promises.readFile(path.join(tmp, manifest.session_id, "derived", "ai-ready", "events.jsonl"), "utf8");
  expect(aiReadyEvents).not.toContain("submit_window_opened");
});

test("records opener_tab_id for target-origin tabs opened by the browser", async () => {
  const config = buildConfig({ targetOrigin: origin, outputDir: tmp, profileDir: path.join(tmp, "profile"), openSidecar: false });
  config.finalizationTimeoutMs = 100;
  const store = new RawStore(config);
  const aiReady = new AiReadyGenerator(config, store);
  const sessions = new SessionManager(config, store, aiReady);
  browser = new BrowserController(config, store, sessions);
  await browser.start();

  const manifest = await sessions.startSession("新标签页");
  const page = await browser.openPageForTest(`${origin}/`);
  await page.click('a[href="/new-tab"]');
  await new Promise((resolve) => setTimeout(resolve, 500));
  await sessions.endSession("新标签页结束");

  const tabEvents = (await store.events(manifest.session_id)).filter((event) => event.type === "tab_created");
  const rootTab = tabEvents.find((event) => event.type === "tab_created" && event.tab.first_target_url === `${origin}/`);
  const newTab = tabEvents.find((event) => event.type === "tab_created" && event.tab.first_target_url === `${origin}/new-tab`);
  expect(rootTab?.type).toBe("tab_created");
  expect(newTab?.type).toBe("tab_created");
  if (!rootTab || rootTab.type !== "tab_created" || !newTab || newTab.type !== "tab_created") throw new Error("missing tab facts");
  expect(newTab.tab.opener_tab_id).toBe(rootTab.tab.tab_id);
});

test("completes an evidence-first Task flow with observations downloads validation and both exports", async () => {
  const dataRoot = path.join(tmp, "capture-data");
  const tasks = new TaskManager(dataRoot);
  await tasks.createTask({ task_id: "fixture-research", title: "Fixture Research", goal: "Record navigation and actionId reuse", success_criteria: ["记录点击前后 URL", "记录路由参数候选来源", "下载 CSV 和 XLSX"], do_not_assume: ["不得把 HTTP 200 解释为业务成功"], created_at: "2026-07-11T00:00:00.000Z" });
  const config = buildConfig({ targetOrigin: origin, outputDir: tasks.taskPaths("fixture-research").sessions, profileDir: path.join(tmp, "profile"), openSidecar: false });
  config.finalizationTimeoutMs = 250;
  const store = new RawStore(config);
  const aiReady = new AiReadyGenerator(config, store);
  const sessions = new SessionManager(config, store, aiReady);
  browser = new BrowserController(config, store, sessions);
  await browser.start();

  const manifest = await sessions.startSession("Evidence-first fixture", "session-fixture-001");
  await tasks.createSession("fixture-research", { session_id: manifest.session_id, started_at: manifest.start_time });
  const page = await browser.openPageForTest(`${origin}/research-list`);
  await tasks.appendAnnotation("fixture-research", manifest.session_id, { annotation_id: "ann-001", kind: "MARK", content: "Open Trace detail", page_id: "page-list", current_url: page.url() });
  await page.click("#open-detail");
  await page.waitForURL(/research-detail/);
  await page.waitForFunction(() => document.querySelector("#detail-result")?.textContent?.includes("7788"));
  const popupPromise = page.waitForEvent("popup");
  await page.click("#open-popup");
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await tasks.appendAnnotation("fixture-research", manifest.session_id, { annotation_id: "ann-002", kind: "NOTE", content: "Popup observed", current_url: popup.url() });
  await page.click("#download-csv");
  await page.click("#download-xlsx");
  await browser.reloadVerify();
  await browser.newTabVerify();
  await tasks.appendAnnotation("fixture-research", manifest.session_id, { annotation_id: "ann-003", kind: "FINISH", content: "Fixture flow finished", current_url: page.url() });
  await sessions.endSession("Fixture complete");
  await tasks.closeSession("fixture-research", manifest.session_id);

  const packages = new ResearchPackageBuilder(dataRoot);
  await packages.aggregate("fixture-research");
  const paths = tasks.sessionPaths("fixture-research", manifest.session_id);
  const windows = await readJsonl<Record<string, unknown>>(path.join(paths.derived, "interaction-windows.jsonl"));
  const navigation = await readJsonl<Record<string, unknown>>(path.join(paths.derived, "navigation-observations.jsonl"));
  const correlations = await readJsonl<Record<string, unknown>>(path.join(paths.derived, "correlation-candidates.jsonl"));
  const downloads = await readJsonl<Record<string, unknown>>(path.join(paths.derived, "download-index.jsonl"));
  const splitRequests = await readJsonl<Record<string, unknown>>(path.join(paths.raw, "network-requests.jsonl"));
  const privateExport = await packages.exportTask("fixture-research", "private");
  const shareableExport = await packages.exportTask("fixture-research", "shareable");

  expect(windows.length).toBeGreaterThan(0);
  expect(navigation.length).toBeGreaterThan(0);
  expect(correlations.length).toBeGreaterThan(0);
  expect(downloads.filter((item) => item.status === "NORMALIZED")).toHaveLength(2);
  expect(splitRequests.length).toBeGreaterThan(0);
  const validation = await validateTask(dataRoot, "fixture-research");
  expect(validation.status, validation.errors.join("\n")).toBe("PASS");
  expect(privateExport.security.status).toBe("PASS");
  expect(shareableExport.security.status).toBe("PASS");
  expect(shareableExport.files.some((file) => file.includes("raw/"))).toBe(false);
});

function listenRandomPort(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const app = createTestSiteApp();
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
    next.on("error", reject);
  });
}
