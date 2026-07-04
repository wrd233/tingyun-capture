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

export interface AppDeps {
  config: CaptureConfig;
  store: RawStore;
  sessions: SessionManager;
  browser: BrowserController;
  aiReady: AiReadyGenerator;
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
      res.json({ ...deps.sessions.state(), recentSessions: await enrichSessions(deps.store) });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/session/start", async (req, res, next) => {
    try {
      const manifest = await deps.sessions.startSession(String(req.body.name ?? ""));
      await deps.browser.recordBaseline();
      res.json(manifest);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/session/end", async (req, res, next) => {
    try {
      res.json(await deps.sessions.endSession(req.body.summary ? String(req.body.summary) : undefined));
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
  return { manifest, annotations, events, requests: [...requestMap.values()], integrity, bodies };
}
