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

function listenRandomPort(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const app = createTestSiteApp();
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
    next.on("error", reject);
  });
}
