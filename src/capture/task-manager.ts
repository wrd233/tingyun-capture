import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { JsonlWriter } from "./jsonl";
import { writeJson, readJson } from "./raw-store";

export const researchTaskSchema = z.object({
  schema_version: z.literal(1).default(1),
  task_id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  title: z.string().min(1),
  goal: z.string().min(1),
  success_criteria: z.array(z.string().min(1)),
  do_not_assume: z.array(z.string().min(1)),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional(),
  source_file: z.string().optional()
});

export type ResearchTask = z.infer<typeof researchTaskSchema>;
export type V2SessionStatus = "RUNNING" | "CLOSED" | "INTERRUPTED";

export interface V2SessionManifest {
  schema_version: 1;
  session_id: string;
  task_id: string;
  status: V2SessionStatus;
  started_at: string;
  closed_at?: string;
  interrupted_at?: string;
  interruption_reason?: string;
  compatibility?: { source_schema: string; source_path?: string };
}

export interface V2SessionHandle extends V2SessionManifest {
  raw_dir: string;
  derived_dir: string;
  root_dir: string;
}

const RAW_FILES = [
  "browser-events.jsonl",
  "network-requests.jsonl",
  "network-responses.jsonl",
  "navigations.jsonl",
  "downloads.jsonl",
  "annotations.jsonl",
  "omissions.jsonl"
];

export class TaskManager {
  constructor(readonly dataRoot: string) {}

  taskRoot(taskId: string): string {
    return path.join(this.dataRoot, "tasks", taskId);
  }

  async createTask(input: Omit<ResearchTask, "schema_version"> & { schema_version?: 1 }): Promise<ResearchTask> {
    const task = researchTaskSchema.parse({ schema_version: 1, ...input });
    const root = this.taskRoot(task.task_id);
    await fs.promises.mkdir(path.join(root, "sessions"), { recursive: true, mode: 0o700 });
    await fs.promises.mkdir(path.join(root, "research"), { recursive: true, mode: 0o700 });
    await fs.promises.mkdir(path.join(root, "exports", "private"), { recursive: true, mode: 0o700 });
    await fs.promises.mkdir(path.join(root, "exports", "shareable"), { recursive: true, mode: 0o700 });
    await writeJson(path.join(root, "task.json"), task);
    await new JsonlWriter(path.join(root, "task-events.jsonl")).append({ type: "task_created", at: task.created_at, task_id: task.task_id });
    return task;
  }

  async importTask(filePath: string): Promise<ResearchTask> {
    const input = await readJson<ResearchTask>(filePath);
    return this.createTask({ ...input, schema_version: 1, source_file: filePath });
  }

  async createAdHocTask(title = "Ad-hoc Research", at = new Date().toISOString()): Promise<ResearchTask> {
    const suffix = at.replace(/\D/g, "").slice(0, 14);
    return this.createTask({ task_id: `adhoc-${suffix}`, title, goal: "Record an ad-hoc browser research session", success_criteria: [], do_not_assume: [], created_at: at });
  }

  async readTask(taskId: string): Promise<ResearchTask> {
    return readJson<ResearchTask>(this.taskPaths(taskId).task);
  }

  async listTasks(): Promise<ResearchTask[]> {
    const tasksRoot = path.join(this.dataRoot, "tasks");
    const entries = await fs.promises.readdir(tasksRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const tasks = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => this.readTask(entry.name).catch(() => undefined)));
    return tasks.filter((task): task is ResearchTask => Boolean(task)).sort((a, b) => a.task_id.localeCompare(b.task_id));
  }

  async createSession(taskId: string, input: { session_id: string; started_at?: string }): Promise<V2SessionHandle> {
    await this.readTask(taskId);
    validateTaskId(input.session_id);
    const paths = this.sessionPaths(taskId, input.session_id);
    await Promise.all([
      fs.promises.mkdir(path.join(paths.raw, "bodies"), { recursive: true, mode: 0o700 }),
      fs.promises.mkdir(path.join(paths.raw, "screenshots"), { recursive: true, mode: 0o700 }),
      fs.promises.mkdir(path.join(paths.raw, "downloads"), { recursive: true, mode: 0o700 }),
      fs.promises.mkdir(paths.derived, { recursive: true, mode: 0o700 })
    ]);
    for (const file of RAW_FILES) await fs.promises.appendFile(path.join(paths.raw, file), "", { mode: 0o600 });
    const manifest: V2SessionManifest = {
      schema_version: 1,
      task_id: taskId,
      session_id: input.session_id,
      status: "RUNNING",
      started_at: input.started_at ?? new Date().toISOString()
    };
    await writeJson(paths.manifest, manifest, 0o600);
    await new JsonlWriter(this.taskPaths(taskId).events).append({ type: "session_started", at: manifest.started_at, task_id: taskId, session_id: manifest.session_id });
    return withPaths(manifest, paths);
  }

  async readSession(taskId: string, sessionId: string): Promise<V2SessionManifest> {
    return readJson<V2SessionManifest>(this.sessionPaths(taskId, sessionId).manifest);
  }

  async listSessions(taskId: string): Promise<V2SessionManifest[]> {
    const sessionsRoot = this.taskPaths(taskId).sessions;
    const entries = await fs.promises.readdir(sessionsRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const sessions = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => this.readSession(taskId, entry.name).catch(() => undefined)));
    return sessions.filter((session): session is V2SessionManifest => Boolean(session)).sort((a, b) => a.started_at.localeCompare(b.started_at) || a.session_id.localeCompare(b.session_id));
  }

  async closeSession(taskId: string, sessionId: string, at = new Date().toISOString()): Promise<V2SessionManifest> {
    const current = await this.readSession(taskId, sessionId);
    if (current.status !== "RUNNING") throw new Error("Only RUNNING sessions can be closed");
    const next: V2SessionManifest = { ...current, status: "CLOSED", closed_at: at };
    await writeJson(this.sessionPaths(taskId, sessionId).manifest, next, 0o600);
    await new JsonlWriter(this.taskPaths(taskId).events).append({ type: "session_closed", at, task_id: taskId, session_id: sessionId });
    return next;
  }

  async appendAnnotation(taskId: string, sessionId: string, input: {
    annotation_id: string;
    kind: "MARK" | "NOTE" | "FINISH";
    content: string;
    created_at?: string;
    page_id?: string;
    current_url?: string;
  }): Promise<void> {
    const session = await this.readSession(taskId, sessionId);
    if (session.status !== "RUNNING") throw new Error("Annotations require a RUNNING session");
    await new JsonlWriter(path.join(this.sessionPaths(taskId, sessionId).raw, "annotations.jsonl")).append({
      schema_version: 1,
      annotation_id: input.annotation_id,
      session_id: sessionId,
      kind: input.kind,
      content: input.content,
      page_id: input.page_id,
      current_url: input.current_url,
      created_at: input.created_at ?? new Date().toISOString()
    });
  }

  async interruptStaleSessions(taskId: string, at = new Date().toISOString()): Promise<V2SessionManifest[]> {
    const changed: V2SessionManifest[] = [];
    for (const session of await this.listSessions(taskId)) {
      if (session.status !== "RUNNING") continue;
      const next: V2SessionManifest = { ...session, status: "INTERRUPTED", interrupted_at: at, interruption_reason: "capture_restarted" };
      await writeJson(this.sessionPaths(taskId, session.session_id).manifest, next, 0o600);
      await new JsonlWriter(this.taskPaths(taskId).events).append({ type: "session_interrupted", at, task_id: taskId, session_id: session.session_id, reason: "capture_restarted" });
      changed.push(next);
    }
    return changed;
  }

  taskPaths(taskId: string) {
    validateTaskId(taskId);
    const root = path.join(this.dataRoot, "tasks", taskId);
    return { root, task: path.join(root, "task.json"), events: path.join(root, "task-events.jsonl"), sessions: path.join(root, "sessions"), research: path.join(root, "research"), exports: path.join(root, "exports") };
  }

  sessionPaths(taskId: string, sessionId: string) {
    validateTaskId(sessionId);
    const root = path.join(this.taskPaths(taskId).sessions, sessionId);
    return { root, manifest: path.join(root, "session.json"), raw: path.join(root, "raw"), derived: path.join(root, "derived") };
  }
}

function validateTaskId(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(`Invalid filesystem-safe id: ${value}`);
}

function withPaths(manifest: V2SessionManifest, paths: ReturnType<TaskManager["sessionPaths"]>): V2SessionHandle {
  return { ...manifest, root_dir: paths.root, raw_dir: paths.raw, derived_dir: paths.derived };
}
