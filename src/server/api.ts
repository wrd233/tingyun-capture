import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";
import type { CaptureConfig, RawEvent, RequestRecord } from "../shared/types";
import { buildCurl } from "../capture/curl";
import { AiReadyGenerator } from "../capture/ai-ready";
import { RawStore, readJson } from "../capture/raw-store";
import { SessionManager } from "../capture/session-manager";
import { BrowserController } from "../capture/browser-controller";
import { TaskManager } from "../capture/task-manager";
import { ResearchPackageBuilder } from "../capture/research-package";
import { validateTask } from "../capture/validator";
import { JsonlWriter, readJsonl } from "../capture/jsonl";

export interface AppDeps {
  config: CaptureConfig;
  store: RawStore;
  sessions: SessionManager;
  browser: BrowserController;
  aiReady: AiReadyGenerator;
  tasks?: TaskManager;
  taskId?: string;
  defaultSessionId?: string;
}

export function createApi(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  const staticDir = path.resolve("dist/sidecar");
  if (fs.existsSync(staticDir)) app.use(express.static(staticDir));

  app.get("/api/health", (_req, res) => res.json({ ok: true, target_origin: deps.config.targetOrigin }));
  app.get("/api/state", async (_req, res, next) => {
    try {
      res.json({ ...deps.sessions.state(), currentTask: deps.taskId ? await deps.tasks?.readTask(deps.taskId) : undefined, currentPage: await deps.browser.activeTabContext(), captureHealth: { ok: true }, recentSessions: await enrichSessions(deps.store) });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/session/start", async (req, res, next) => {
    try {
      const manifest = await deps.sessions.startSession(String(req.body.name ?? ""), req.body.session_id ? String(req.body.session_id) : deps.defaultSessionId);
      if (deps.tasks && deps.taskId) await deps.tasks.createSession(deps.taskId, { session_id: manifest.session_id, started_at: manifest.start_time });
      await deps.browser.recordBaseline();
      res.json(manifest);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/session/end", async (req, res, next) => {
    try {
      const ended = await deps.sessions.endSession(req.body.summary ? String(req.body.summary) : undefined);
      if (deps.tasks && deps.taskId) await deps.tasks.closeSession(deps.taskId, ended.session_id, ended.end_time);
      res.json(ended);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/session/:sessionId/seal-interrupted", async (req, res, next) => {
    try {
      res.json(await deps.sessions.sealInterruptedSession(req.params.sessionId));
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/session/:sessionId", async (req, res, next) => {
    try {
      const manifest = await deps.store.loadManifest(req.params.sessionId);
      if (!["SEALED", "INTERRUPTED"].includes(manifest.status)) throw new Error("Only SEALED or INTERRUPTED sessions can be deleted");
      await fs.promises.rm(deps.store.pathsFor(req.params.sessionId).root, { recursive: true, force: true });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/step/start", async (req, res, next) => {
    try {
      res.json(await deps.sessions.startStep(String(req.body.intent ?? "")));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/step/end", async (req, res, next) => {
    try {
      await deps.sessions.endStep(req.body.result ? String(req.body.result) : undefined);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/note", async (req, res, next) => {
    try {
      await deps.sessions.addNote(String(req.body.text ?? ""), await deps.browser.activeTabContext());
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/annotation", async (req, res, next) => {
    try {
      if (!deps.tasks || !deps.taskId) throw new Error("Research Task runtime is not configured");
      const sessionId = deps.sessions.activeSessionId();
      if (!sessionId) throw new Error("A RUNNING Session is required");
      const kind = String(req.body.kind ?? "") as "MARK" | "NOTE" | "FINISH";
      if (!["MARK", "NOTE", "FINISH"].includes(kind)) throw new Error("kind must be MARK, NOTE, or FINISH");
      const page = await deps.browser.activeTabContext();
      await deps.tasks.appendAnnotation(deps.taskId, sessionId, {
        annotation_id: deps.sessions.ids.next("annotation"),
        kind,
        content: String(req.body.content ?? ""),
        page_id: page.tab_id,
        current_url: page.url
      });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  app.post("/api/navigation/record-current-url", async (req, res, next) => {
    try {
      if (!deps.tasks || !deps.taskId) throw new Error("Research Task runtime is not configured");
      const sessionId = deps.sessions.activeSessionId();
      if (!sessionId) throw new Error("A RUNNING Session is required");
      const page = await deps.browser.activeTabContext();
      await deps.tasks.appendAnnotation(deps.taskId, sessionId, { annotation_id: deps.sessions.ids.next("annotation"), kind: "NOTE", content: String(req.body.content ?? "Record Current URL"), page_id: page.tab_id, current_url: page.url });
      res.json({ status: "OBSERVED", page });
    } catch (error) { next(error); }
  });
  app.post("/api/navigation/reload-verify", async (_req, res, next) => {
    try { res.json(await recordVerification(deps, await deps.browser.reloadVerify())); } catch (error) { next(error); }
  });
  app.post("/api/navigation/new-tab-verify", async (_req, res, next) => {
    try { res.json(await recordVerification(deps, await deps.browser.newTabVerify())); } catch (error) { next(error); }
  });
  app.post("/api/navigation/cross-session-verify", async (req, res, next) => {
    try {
      if (!deps.tasks || !deps.taskId) throw new Error("Research Task runtime is not configured");
      const sessionId = deps.sessions.activeSessionId();
      if (!sessionId) throw new Error("A new RUNNING Session is required");
      const page = await deps.browser.activeTabContext();
      const expectedUrl = req.body.expected_url ? String(req.body.expected_url) : undefined;
      const result = {
        type: "cross_session_verify_result",
        event_id: deps.sessions.ids.next("verification"),
        at: new Date().toISOString(),
        prior_navigation_id: String(req.body.navigation_id ?? ""),
        prior_session_id: req.body.prior_session_id ? String(req.body.prior_session_id) : undefined,
        page_id: page.tab_id,
        url: page.url,
        title: page.title,
        status: expectedUrl && page.url !== expectedUrl ? "UNSTABLE" : "PASS"
      };
      await new JsonlWriter(path.join(deps.tasks.sessionPaths(deps.taskId, sessionId).raw, "navigations.jsonl")).append(result);
      res.json(result);
    } catch (error) { next(error); }
  });
  app.post("/api/validate", async (_req, res, next) => {
    try {
      if (!deps.tasks || !deps.taskId) throw new Error("Research Task runtime is not configured");
      res.json(await validateTask(deps.tasks.dataRoot, deps.taskId, new Date().toISOString()));
    } catch (error) { next(error); }
  });
  app.post("/api/export/:type", async (req, res, next) => {
    try {
      if (!deps.tasks || !deps.taskId) throw new Error("Research Task runtime is not configured");
      if (req.params.type !== "private" && req.params.type !== "shareable") throw new Error("type must be private or shareable");
      res.json(await new ResearchPackageBuilder(deps.tasks.dataRoot).exportTask(deps.taskId, req.params.type));
    } catch (error) { next(error); }
  });
  app.get("/api/session/:sessionId/review", async (req, res, next) => {
    try {
      res.json(await buildReview(deps.store, req.params.sessionId));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/session/:sessionId/request/:requestId/curl", async (req, res, next) => {
    try {
      const review = await buildReview(deps.store, req.params.sessionId);
      const request = review.requests.find((item) => item.request_id === req.params.requestId);
      if (!request) throw new Error("Request not found");
      res.type("text/plain").send(buildCurl(request, { redacted: req.query.raw !== "1" }));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/session/:sessionId/ai-ready/regenerate", async (req, res, next) => {
    try {
      await deps.aiReady.generate(req.params.sessionId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/session/:sessionId/ai-ready/zip", async (req, res, next) => {
    try {
      res.json({ zipPath: await deps.aiReady.zip(req.params.sessionId) });
    } catch (error) {
      next(error);
    }
  });

  app.get("*", (_req, res) => {
    if (fs.existsSync(path.join(staticDir, "index.html"))) {
      res.sendFile(path.join(staticDir, "index.html"));
      return;
    }
    res.type("html").send("<!doctype html><meta charset=utf-8><title>tingyun-capture</title><p>Sidecar build not found. Run <code>npm run build</code>, then start Capture again.</p>");
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  });
  return app;
}

export function listenLocalhost(app: express.Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

async function enrichSessions(store: RawStore): Promise<unknown[]> {
  return Promise.all(
    (await store.listSessions()).slice(0, 20).map(async (manifest) => {
      const events = await store.events(manifest.session_id);
      const annotations = await store.loadAnnotations(manifest.session_id).catch(() => undefined);
      return {
        ...manifest,
        name: annotations?.sessionName ?? manifest.session_id,
        step_count: events.filter((event) => event.type === "step_started").length,
        duration_ms: manifest.start_time && manifest.end_time ? new Date(manifest.end_time).getTime() - new Date(manifest.start_time).getTime() : undefined
      };
    })
  );
}

async function buildReview(store: RawStore, sessionId: string): Promise<{
  manifest: unknown;
  annotations: unknown;
  events: RawEvent[];
  requests: RequestRecord[];
  integrity?: unknown;
  bodies: Record<string, string>;
}> {
  const paths = store.pathsFor(sessionId);
  const manifest = await store.loadManifest(sessionId);
  const annotations = await store.loadAnnotations(sessionId);
  const events = await store.events(sessionId);
  const requestMap = new Map<string, RequestRecord>();
  for (const event of events) {
    if (event.type === "request_started") requestMap.set(event.request.request_id, event.request);
    if (event.type === "request_completed" || event.type === "request_failed") requestMap.set(event.request.request_id, event.request);
  }
  const bodies: Record<string, string> = {};
  for (const request of requestMap.values()) {
    for (const body of [request.request_body, request.response_body]) {
      if (body?.ref && body.kind !== "binary" && body.save_status === "saved") {
        bodies[body.ref] = await fs.promises.readFile(path.join(paths.root, body.ref), "utf8").catch(() => "");
      }
    }
  }
  const integrity = await readJson(paths.integrity).catch(() => undefined);
  const derived = await readV2Derived(paths.derived);
  return { manifest, annotations, events, requests: [...requestMap.values()], integrity, bodies, ...derived };
}

async function recordVerification(deps: AppDeps, result: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sessionId = deps.sessions.activeSessionId();
  if (deps.tasks && deps.taskId && sessionId) {
    await new JsonlWriter(path.join(deps.tasks.sessionPaths(deps.taskId, sessionId).raw, "navigations.jsonl")).append({ schema_version: 1, ...result });
  }
  return result;
}

async function readV2Derived(root: string): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const [key, name] of Object.entries({ interactionWindows: "interaction-windows.jsonl", navigationObservations: "navigation-observations.jsonl", correlationCandidates: "correlation-candidates.jsonl", downloadIndex: "download-index.jsonl", endpointObservations: "endpoint-observations.jsonl" })) {
    result[key] = await readJsonl(path.join(root, name)).catch(() => []);
  }
  return result;
}
