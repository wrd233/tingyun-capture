import fs from "node:fs";
import path from "node:path";
import { readJsonl } from "./jsonl";
import { writeJson } from "./raw-store";
import { researchTaskSchema, TaskManager } from "./task-manager";

export type ValidationStatus = "PASS" | "PARTIAL" | "FAILED";
export interface ValidationReport { status: ValidationStatus; task_id: string; checked_at: string; errors: string[]; partial_reasons: string[] }

export async function validateTask(dataRoot: string, taskId: string, checkedAt = "deterministic"): Promise<ValidationReport> {
  const tasks = new TaskManager(dataRoot);
  const errors: string[] = [];
  const partial: string[] = [];
  try {
    researchTaskSchema.parse(await tasks.readTask(taskId));
  } catch (error) {
    errors.push(`task metadata: ${String(error)}`);
  }
  const sessions = await tasks.listSessions(taskId).catch((error) => {
    errors.push(`session list: ${String(error)}`);
    return [];
  });
  for (const session of sessions) {
    if (session.task_id !== taskId) errors.push(`${session.session_id}: task_id mismatch`);
    if (session.status === "RUNNING") errors.push(`${session.session_id}: RUNNING session is not closed`);
    if (session.status === "INTERRUPTED") partial.push(`${session.session_id}: interrupted`);
    const paths = tasks.sessionPaths(taskId, session.session_id);
    const rawRecords: unknown[] = [];
    for (const name of ["browser-events.jsonl", "network-requests.jsonl", "network-responses.jsonl", "navigations.jsonl", "downloads.jsonl", "annotations.jsonl", "omissions.jsonl"]) {
      const file = path.join(paths.raw, name);
      try {
        await fs.promises.access(file);
        const records = await readJsonl(file);
        rawRecords.push(...records);
        if (name === "omissions.jsonl" && records.length > 0) partial.push(`${session.session_id}: policy omissions recorded`);
      } catch (error) {
        errors.push(`${session.session_id}/${name}: ${String(error)}`);
      }
    }
    const legacyEvents = await readJsonl<Record<string, unknown>>(path.join(paths.raw, "events.jsonl")).catch(() => []);
    rawRecords.push(...legacyEvents);
    const rawIds = collectRawIds(rawRecords);
    const savedRefs = collectSavedRefs(rawRecords);
    for (const ref of savedRefs) {
      const resolved = path.resolve(paths.root, ref);
      if (!resolved.startsWith(`${path.resolve(paths.root)}${path.sep}`)) errors.push(`${session.session_id}: body ref escapes Session: ${ref}`);
      else await fs.promises.access(resolved).catch(() => errors.push(`${session.session_id}: missing body ref ${ref}`));
    }
    const bodyRoot = path.join(paths.raw, "bodies");
    const referenced = new Set(savedRefs.map((ref) => path.normalize(ref)));
    for (const file of await listFiles(bodyRoot)) {
      const relative = path.relative(paths.root, file);
      if (!referenced.has(path.normalize(relative))) errors.push(`${session.session_id}: orphan body file ${relative}`);
    }
    const windowFile = path.join(paths.derived, "interaction-windows.jsonl");
    const windows = await readJsonl<Record<string, unknown>>(windowFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") errors.push(`${session.session_id}/interaction-windows.jsonl: ${String(error)}`);
      return [];
    });
    const windowIds = new Set(windows.map((window) => String(window.window_id ?? "")).filter(Boolean));
    for (const window of windows) {
      for (const key of ["event_refs", "request_refs", "response_refs", "navigation_refs", "download_refs", "annotation_refs"]) {
        for (const ref of arrayStrings(window[key])) if (!rawIds.has(ref)) errors.push(`${session.session_id}/${String(window.window_id)}: missing ${key} ref ${ref}`);
      }
    }
    for (const observation of await readJsonl<Record<string, unknown>>(path.join(paths.derived, "navigation-observations.jsonl")).catch(() => [])) {
      const windowId = String(observation.interaction_window_id ?? "");
      if (windowId && !windowIds.has(windowId)) errors.push(`${session.session_id}/${String(observation.navigation_id)}: missing interaction window ${windowId}`);
    }
    for (const candidate of await readJsonl<Record<string, unknown>>(path.join(paths.derived, "correlation-candidates.jsonl")).catch(() => [])) {
      for (const side of ["source", "target"]) {
        const value = candidate[side];
        const ref = value && typeof value === "object" ? String((value as Record<string, unknown>).event_id ?? "") : "";
        if (ref && !rawIds.has(ref)) errors.push(`${session.session_id}/${String(candidate.candidate_id)}: missing ${side} event ${ref}`);
      }
      if (candidate.relation_status !== "CANDIDATE_ONLY") errors.push(`${session.session_id}/${String(candidate.candidate_id)}: invalid relation status`);
    }
    const aiReady = path.join(paths.derived, "ai-ready");
    const aiIndex = await readJsonl<Record<string, unknown>>(path.join(aiReady, "network-index.jsonl")).catch(() => []);
    for (const request of aiIndex) {
      for (const key of ["request_body", "response_body"]) {
        const body = request[key];
        if (!body || typeof body !== "object") continue;
        const ref = String((body as Record<string, unknown>).ref ?? "");
        if (!ref) continue;
        const resolved = path.resolve(aiReady, ref);
        if (!resolved.startsWith(`${path.resolve(aiReady)}${path.sep}`)) errors.push(`${session.session_id}: AI-ready ref escapes bundle: ${ref}`);
        else if ((body as Record<string, unknown>).save_status === "saved") await fs.promises.access(resolved).catch(() => errors.push(`${session.session_id}: missing AI-ready ref ${ref}`));
      }
    }
  }
  const status: ValidationStatus = errors.length ? "FAILED" : partial.length ? "PARTIAL" : "PASS";
  const report: ValidationReport = { status, task_id: taskId, checked_at: checkedAt, errors, partial_reasons: partial };
  const research = tasks.taskPaths(taskId).research;
  await fs.promises.mkdir(research, { recursive: true, mode: 0o700 });
  await writeJson(path.join(research, "validation.json"), report);
  await fs.promises.writeFile(path.join(research, "validation.md"), `# Validation\n\nStatus: ${status}\n\n${errors.map((error) => `- ERROR: ${error}`).join("\n")}${partial.map((reason) => `- PARTIAL: ${reason}`).join("\n")}\n`, { mode: 0o600 });
  return report;
}

function collectRawIds(records: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const value of records) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    for (const key of ["event_id", "request_id", "response_id", "annotation_id", "download_id", "navigation_id"]) {
      if (typeof record[key] === "string") ids.add(record[key] as string);
    }
    if (record.request && typeof record.request === "object" && typeof (record.request as Record<string, unknown>).request_id === "string") ids.add(String((record.request as Record<string, unknown>).request_id));
    if (record.type === "interaction_recorded" && typeof record.interaction_id === "string") ids.add(record.interaction_id);
    if (record.type === "response_received" && typeof record.request_id === "string") ids.add(`response-${record.request_id}`);
    if (record.type === "tab_created" && record.tab && typeof record.tab === "object") ids.add(`page-created-${String((record.tab as Record<string, unknown>).tab_id)}`);
    if (record.type === "url_changed") ids.add(`navigation-${String(record.tab_id ?? "page")}-${String(record.at)}`);
  }
  return ids;
}

function collectSavedRefs(records: unknown[]): string[] {
  const refs: string[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.save_status === "saved" && typeof record.ref === "string") refs.push(record.ref);
    Object.values(record).forEach(visit);
  }
  records.forEach(visit);
  return [...new Set(refs)].sort();
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      if (entry.isFile()) output.push(full);
    }
  }
  await visit(root);
  return output.sort();
}
