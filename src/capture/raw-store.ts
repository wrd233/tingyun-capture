import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  AnnotationState,
  BodyKind,
  BodyRef,
  CaptureConfig,
  IntegrityGap,
  IntegritySummary,
  RawEvent,
  RawManifest,
  RequestRecord
} from "../shared/types";
import { newSessionId } from "../shared/ids";
import { nowIso } from "../shared/time";
import { JsonlWriter, readJsonl } from "./jsonl";

export const RAW_SCHEMA_VERSION = "tingyun-capture.raw.v1";
export const CAPTURE_VERSION = "1.0.0";

export interface SessionPaths {
  root: string;
  raw: string;
  annotations: string;
  derived: string;
  manifest: string;
  events: string;
  integrity: string;
  annotationsCurrent: string;
  requestBodies: string;
  responseBodies: string;
  downloads: string;
  aiReady: string;
}

export class PersistenceFailure extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "PersistenceFailure";
  }
}

export class RawStore {
  private writer?: JsonlWriter<RawEvent>;
  private paths?: SessionPaths;
  private manifest?: RawManifest;
  private annotations?: AnnotationState;
  private gaps: IntegrityGap[] = [];

  constructor(private readonly config: CaptureConfig) {}

  async recoverInterruptedSessions(): Promise<RawManifest[]> {
    await fs.promises.mkdir(this.config.outputDir, { recursive: true, mode: 0o700 });
    const manifests = await this.listSessions();
    const changed: RawManifest[] = [];
    for (const manifest of manifests) {
      if (manifest.status === "ACTIVE" || manifest.status === "FINALIZING") {
        const paths = this.pathsFor(manifest.session_id);
        const updated: RawManifest = {
          ...manifest,
          status: "INTERRUPTED",
          interruption_reason: "capture_restarted"
        };
        await writeJson(paths.manifest, updated, 0o600);
        await new JsonlWriter<RawEvent>(paths.events).append({
          type: "session_interrupted",
          at: nowIso(),
          session_id: manifest.session_id,
          reason: "capture_restarted"
        });
        changed.push(updated);
      }
    }
    return changed;
  }

  async createSession(name: string, requestedSessionId?: string): Promise<RawManifest> {
    const sessionId = requestedSessionId ?? newSessionId();
    if (!/^session-[A-Za-z0-9._-]+$/.test(sessionId)) throw new Error("session_id must be filesystem-safe and start with session-");
    this.paths = this.pathsFor(sessionId);
    await createSessionDirs(this.paths);
    this.writer = new JsonlWriter<RawEvent>(this.paths.events);
    this.manifest = {
      session_id: sessionId,
      capture_schema_version: RAW_SCHEMA_VERSION,
      capture_version: CAPTURE_VERSION,
      status: "ACTIVE",
      target_origin: this.config.targetOrigin,
      created_at: nowIso(),
      start_time: nowIso(),
      ai_ready_status: "NOT_GENERATED"
    };
    this.annotations = { sessionName: name, steps: {}, notes: {} };
    this.gaps = [];
    await this.writeManifest();
    await this.writeAnnotations();
    await this.append({ type: "session_started", at: this.manifest.start_time!, session_id: sessionId, name });
    return this.manifest;
  }

  attach(sessionId: string): void {
    this.paths = this.pathsFor(sessionId);
    this.writer = new JsonlWriter<RawEvent>(this.paths.events);
  }

  async loadManifest(sessionId: string): Promise<RawManifest> {
    return readJson<RawManifest>(this.pathsFor(sessionId).manifest);
  }

  async loadAnnotations(sessionId: string): Promise<AnnotationState> {
    return readJson<AnnotationState>(this.pathsFor(sessionId).annotationsCurrent);
  }

  async updateManifest(mutator: (manifest: RawManifest) => RawManifest): Promise<RawManifest> {
    const manifest = await this.currentManifest();
    this.manifest = mutator(manifest);
    await this.writeManifest();
    return this.manifest;
  }

  async updateAnnotations(mutator: (annotations: AnnotationState) => AnnotationState): Promise<AnnotationState> {
    if (!this.annotations) {
      const manifest = await this.currentManifest();
      this.annotations = await this.loadAnnotations(manifest.session_id);
    }
    this.annotations = mutator(this.annotations);
    await this.writeAnnotations();
    await this.markAiReadyStaleIfSealed();
    return this.annotations;
  }

  async append(event: RawEvent): Promise<void> {
    if (!this.writer) throw new PersistenceFailure("No active JSONL writer");
    try {
      await this.writer.append(event);
      await this.appendV2SplitFact(event);
    } catch (error) {
      throw new PersistenceFailure("Failed to append Raw event", error);
    }
  }

  private async appendV2SplitFact(event: RawEvent): Promise<void> {
    if (!this.paths || !fs.existsSync(path.join(this.paths.root, "session.json"))) return;
    let file = "browser-events.jsonl";
    if (event.type === "request_started" || event.type === "request_completed" || event.type === "request_failed") file = "network-requests.jsonl";
    if (event.type === "response_received") file = "network-responses.jsonl";
    if (event.type === "url_changed") file = "navigations.jsonl";
    if (event.type === "download_started" || event.type === "download_completed") file = "downloads.jsonl";
    if (event.type === "note_created") file = "annotations.jsonl";
    if (event.type === "integrity_gap") file = "omissions.jsonl";
    await new JsonlWriter<RawEvent>(path.join(this.paths.raw, file)).append(event);
  }

  async recordGap(gap: Omit<IntegrityGap, "at">): Promise<void> {
    const fullGap = { ...gap, at: nowIso() };
    this.gaps.push(fullGap);
    await this.append({ type: "integrity_gap", at: fullGap.at, gap: fullGap });
  }

  async saveBody(input: {
    direction: "request" | "response";
    requestId: string;
    contentType?: string;
    body?: Buffer | string | null;
  }): Promise<BodyRef> {
    if (input.body == null) {
      return { kind: "not_saved", save_status: "not_available", content_type: input.contentType };
    }
    const buffer = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
    if (buffer.byteLength > this.config.bodyLimitBytes) {
      const ref: BodyRef = {
        kind: "not_saved",
        content_type: input.contentType,
        size_bytes: buffer.byteLength,
        save_status: "too_large",
        reason: `body exceeds limit ${this.config.bodyLimitBytes}`
      };
      await this.recordGap({ type: "body_too_large", id: input.requestId, reason: ref.reason });
      return ref;
    }
    const paths = this.requirePaths();
    const dir = input.direction === "request" ? paths.requestBodies : paths.responseBodies;
    const kind = bodyKind(input.contentType, buffer);
    const ext = extensionFor(kind);
    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
    const filename = `${input.requestId}-${input.direction}-${hash}${ext}`;
    const absolute = path.join(dir, filename);
    try {
      await fs.promises.writeFile(absolute, serializeBody(kind, buffer), { mode: 0o600 });
      return {
        ref: path.relative(paths.root, absolute),
        kind,
        content_type: input.contentType,
        size_bytes: buffer.byteLength,
        save_status: "saved"
      };
    } catch (error) {
      await this.recordGap({ type: "body_save_failed", id: input.requestId, reason: String(error) });
      throw new PersistenceFailure("Failed to write Body file", error);
    }
  }

  async writeIntegrity(summary: IntegritySummary): Promise<void> {
    const paths = this.requirePaths();
    await writeJson(paths.integrity, summary, 0o600);
  }

  async listSessions(): Promise<RawManifest[]> {
    try {
      const entries = await fs.promises.readdir(this.config.outputDir, { withFileTypes: true });
      const manifests: RawManifest[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith("session-")) continue;
        try {
          manifests.push(await readJson<RawManifest>(this.pathsFor(entry.name).manifest));
        } catch {
          // Ignore incomplete directories in the recent-session list.
        }
      }
      return manifests.sort((a, b) => (b.start_time ?? b.created_at).localeCompare(a.start_time ?? a.created_at));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async events(sessionId: string): Promise<RawEvent[]> {
    return readJsonl<RawEvent>(this.pathsFor(sessionId).events);
  }

  pathsFor(sessionId: string): SessionPaths {
    const root = path.join(this.config.outputDir, sessionId);
    const raw = path.join(root, "raw");
    const annotations = path.join(root, "annotations");
    const derived = path.join(root, "derived");
    return {
      root,
      raw,
      annotations,
      derived,
      manifest: path.join(raw, "manifest.json"),
      events: path.join(raw, "events.jsonl"),
      integrity: path.join(raw, "integrity.json"),
      annotationsCurrent: path.join(annotations, "current.json"),
      requestBodies: path.join(raw, "bodies", "requests"),
      responseBodies: path.join(raw, "bodies", "responses"),
      downloads: path.join(raw, "downloads"),
      aiReady: path.join(derived, "ai-ready")
    };
  }

  requirePaths(): SessionPaths {
    if (!this.paths) throw new PersistenceFailure("No active session paths");
    return this.paths;
  }

  async currentManifest(): Promise<RawManifest> {
    if (this.manifest) return this.manifest;
    if (!this.paths) throw new PersistenceFailure("No active manifest");
    this.manifest = await readJson<RawManifest>(this.paths.manifest);
    return this.manifest;
  }

  async diskFreeBytes(): Promise<number> {
    if ("statfs" in fs.promises) {
      const stats = await fs.promises.statfs(this.config.outputDir);
      return Number(stats.bavail) * Number(stats.bsize);
    }
    return os.freemem();
  }

  private async writeManifest(): Promise<void> {
    if (!this.manifest) throw new PersistenceFailure("No manifest to write");
    await writeJson(this.requirePaths().manifest, this.manifest, 0o600);
  }

  private async writeAnnotations(): Promise<void> {
    if (!this.annotations) throw new PersistenceFailure("No annotations to write");
    await writeJson(this.requirePaths().annotationsCurrent, this.annotations, 0o600);
  }

  private async markAiReadyStaleIfSealed(): Promise<void> {
    const manifest = await this.currentManifest();
    if (manifest.status === "SEALED" && manifest.ai_ready_status === "READY") {
      await this.updateManifest((current) => ({ ...current, ai_ready_status: "STALE" }));
    }
  }
}

export async function readJson<T>(filePath: string): Promise<T> {
  const text = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(text) as T;
}

export async function writeJson(filePath: string, value: unknown, mode = 0o600): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

export function buildIntegrity(events: RawEvent[], manifest: RawManifest): IntegritySummary {
  const requests = new Map<string, RequestRecord>();
  const gaps: IntegrityGap[] = [];
  for (const event of events) {
    if (event.type === "request_started") requests.set(event.request.request_id, event.request);
    if (event.type === "request_completed" || event.type === "request_failed") requests.set(event.request.request_id, event.request);
    if (event.type === "integrity_gap") gaps.push(event.gap);
  }
  const records = [...requests.values()];
  return {
    capture_complete: manifest.status === "SEALED" && gaps.length === 0 && !manifest.interruption_reason,
    business_requests_total: records.filter((r) => shouldSaveFullContent(r.resource_type)).length,
    completed: records.filter((r) => r.lifecycle === "completed").length,
    failed: records.filter((r) => r.lifecycle === "failed").length,
    canceled: records.filter((r) => r.lifecycle === "canceled").length,
    incomplete: records.filter((r) => r.lifecycle === "incomplete").length,
    body_too_large: gaps.filter((gap) => gap.type === "body_too_large").length,
    body_save_failed: gaps.filter((gap) => gap.type === "body_save_failed").length,
    download_failed: gaps.filter((gap) => gap.type === "download_failed").length,
    persistence_errors: gaps.filter((gap) => gap.type === "persistence_failure").length,
    interruption_reason: manifest.interruption_reason,
    gaps
  };
}

export function shouldSaveFullContent(resourceType?: string): boolean {
  return !["stylesheet", "image", "font", "script", "manifest", "other"].includes(resourceType ?? "");
}

async function createSessionDirs(paths: SessionPaths): Promise<void> {
  await Promise.all([
    fs.promises.mkdir(paths.requestBodies, { recursive: true, mode: 0o700 }),
    fs.promises.mkdir(paths.responseBodies, { recursive: true, mode: 0o700 }),
    fs.promises.mkdir(paths.downloads, { recursive: true, mode: 0o700 }),
    fs.promises.mkdir(paths.annotations, { recursive: true, mode: 0o700 }),
    fs.promises.mkdir(paths.derived, { recursive: true, mode: 0o700 })
  ]);
}

function bodyKind(contentType: string | undefined, buffer: Buffer): BodyKind {
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("json")) return "json";
  if (type.includes("html")) return "html";
  if (type.startsWith("text/") || type.includes("xml") || type.includes("javascript")) return "text";
  return buffer.includes(0) ? "binary" : "text";
}

function extensionFor(kind: BodyKind): string {
  if (kind === "json") return ".json";
  if (kind === "html") return ".html";
  if (kind === "text") return ".txt";
  return ".bin";
}

function serializeBody(kind: BodyKind, buffer: Buffer): Buffer | string {
  if (kind !== "json") return buffer;
  try {
    return `${JSON.stringify(JSON.parse(buffer.toString("utf8")), null, 2)}\n`;
  } catch {
    return buffer;
  }
}
