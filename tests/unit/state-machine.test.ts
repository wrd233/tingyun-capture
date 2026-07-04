import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { buildConfig } from "../../src/capture/config";
import { AiReadyGenerator } from "../../src/capture/ai-ready";
import { RawStore } from "../../src/capture/raw-store";
import { SessionManager } from "../../src/capture/session-manager";

let tmp = "";

beforeEach(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ty-capture-state-"));
});

afterEach(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true });
});

test("session and step state machine rejects concurrent sessions and steps", async () => {
  const manager = createManager(tmp);
  await manager.startSession("告警配置探索");
  await expect(manager.startSession("第二个")).rejects.toThrow(/Cannot start/);
  await manager.startStep("选择应用");
  await expect(manager.startStep("嵌套")).rejects.toThrow(/active Step/);
  await manager.endStep("观察到事务变化");
  expect(manager.state().currentStep).toBeUndefined();
});

test("ending a session seals Raw and generates AI-ready deterministically", async () => {
  const manager = createManager(tmp, 5);
  const session = await manager.startSession("提交验证");
  await manager.startStep("点击保存");
  await manager.endStep();
  const sealed = await manager.endSession("已完成");
  expect(sealed.status).toBe("SEALED");
  expect(sealed.ai_ready_status).toBe("READY");
  await expect(fs.promises.access(path.join(tmp, session.session_id, "derived", "ai-ready", "README_FOR_AI.md"))).resolves.toBeUndefined();
});

test("restart recovery marks active sessions interrupted", async () => {
  const manager = createManager(tmp);
  const session = await manager.startSession("长 Session");
  const recoveredStore = new RawStore(buildConfig({ targetOrigin: "http://127.0.0.1:5174", outputDir: tmp, openSidecar: false }));
  const recovered = await recoveredStore.recoverInterruptedSessions();
  expect(recovered.map((item) => item.session_id)).toContain(session.session_id);
  expect((await recoveredStore.loadManifest(session.session_id)).status).toBe("INTERRUPTED");
});

function createManager(outputDir: string, finalizationTimeoutMs = 10): SessionManager {
  const config = buildConfig({ targetOrigin: "http://127.0.0.1:5174", outputDir, openSidecar: false });
  config.finalizationTimeoutMs = finalizationTimeoutMs;
  const store = new RawStore(config);
  const aiReady = new AiReadyGenerator(config, store);
  return new SessionManager(config, store, aiReady);
}
