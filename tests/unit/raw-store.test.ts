import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { buildConfig } from "../../src/capture/config";
import { buildIntegrity, RawStore } from "../../src/capture/raw-store";
import { nowIso } from "../../src/shared/time";

let tmp = "";

beforeEach(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ty-capture-raw-"));
});

afterEach(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true });
});

test("body over the hard limit records an integrity gap without writing truncated content", async () => {
  const config = buildConfig({ targetOrigin: "http://127.0.0.1:5174", outputDir: tmp, bodyLimitBytes: 4, openSidecar: false });
  const store = new RawStore(config);
  const manifest = await store.createSession("body limit");
  const ref = await store.saveBody({ direction: "response", requestId: "request-0001", contentType: "text/plain", body: "12345" });
  expect(ref.save_status).toBe("too_large");
  const events = await store.events(manifest.session_id);
  expect(events.some((event) => event.type === "integrity_gap" && event.gap.type === "body_too_large")).toBe(true);
});

test("integrity summary counts request lifecycle states and gaps", async () => {
  const at = nowIso();
  const summary = buildIntegrity(
    [
      {
        type: "request_started",
        at,
        request: { request_id: "request-0001", started_at: at, method: "GET", url: "http://127.0.0.1:5174/api", lifecycle: "pending", resource_type: "fetch" }
      },
      {
        type: "request_completed",
        at,
        request: { request_id: "request-0001", started_at: at, method: "GET", url: "http://127.0.0.1:5174/api", lifecycle: "completed", resource_type: "fetch" }
      },
      { type: "integrity_gap", at, gap: { type: "body_too_large", id: "request-0001", at } }
    ],
    {
      session_id: "session-x",
      capture_schema_version: "v",
      capture_version: "v",
      status: "SEALED",
      target_origin: "http://127.0.0.1:5174",
      created_at: at,
      ai_ready_status: "READY"
    }
  );
  expect(summary.completed).toBe(1);
  expect(summary.body_too_large).toBe(1);
  expect(summary.capture_complete).toBe(false);
});
