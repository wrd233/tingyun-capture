import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { readJsonl } from "./jsonl";
import { readJson, writeJson } from "./raw-store";
import { StableTokenizer, hasHighRiskSecrets, sanitizeShareable, scanDirectory, scanZip, sha256, type SecurityReport } from "./package-security";
import { TaskManager, type ResearchTask } from "./task-manager";
import { buildInteractionWindows, type ObservationEvent } from "./interaction-window";
import { buildNavigationObservations } from "./navigation-observation";
import { buildCorrelationCandidates } from "./correlation";
import { buildEndpointObservations, type EndpointInput } from "./endpoint-observation";
import { normalizeDownload } from "./download-normalizer";
import type { RawEvent, RequestRecord } from "../shared/types";

export interface ExportResult {
  type: "private" | "shareable";
  zip_path: string;
  files: string[];
  core_hashes: Record<string, string>;
  security: SecurityReport;
}

export class ResearchPackageBuilder {
  private readonly tasks: TaskManager;
  constructor(readonly dataRoot: string) {
    this.tasks = new TaskManager(dataRoot);
  }

  async aggregate(taskId: string): Promise<void> {
    const task = await this.tasks.readTask(taskId);
    const sessions = await this.tasks.listSessions(taskId);
    const research = this.tasks.taskPaths(taskId).research;
    await fs.promises.mkdir(research, { recursive: true, mode: 0o700 });
    const derived: Array<{ windows: unknown[]; navigation: unknown[]; correlations: unknown[]; endpoints: unknown[]; downloads: unknown[] }> = [];
    for (const session of sessions) derived.push(await this.deriveSession(taskId, session.session_id));
    const sessionIndex = sessions.map((session) => ({ session_id: session.session_id, status: session.status, started_at: session.started_at, closed_at: session.closed_at, interruption_reason: session.interruption_reason }));
    await writeJson(path.join(research, "session-index.json"), sessionIndex);
    await writeJsonlFile(path.join(research, "task-timeline.jsonl"), derived.flatMap((item) => item.windows));
    await writeJsonlFile(path.join(research, "navigation-index.jsonl"), derived.flatMap((item) => item.navigation));
    await writeJsonlFile(path.join(research, "endpoint-index.jsonl"), derived.flatMap((item) => item.endpoints));
    await writeJsonlFile(path.join(research, "correlation-index.jsonl"), derived.flatMap((item) => item.correlations));
    await writeJson(path.join(research, "evidence-gaps.json"), { gaps: sessions.filter((session) => session.status !== "CLOSED").map((session) => ({ type: "session_not_closed", session_id: session.session_id, status: session.status })) });
    await writeJson(path.join(research, "success-criteria-evidence.json"), task.success_criteria.map((criterion) => criterionEvidence(criterion, derived)));
    await writeJson(path.join(research, "task-summary.json"), { schema_version: 1, task_id: taskId, session_count: sessions.length, closed_session_count: sessions.filter((session) => session.status === "CLOSED").length });
    const promotion = path.join(research, "promotion-input");
    await fs.promises.mkdir(promotion, { recursive: true, mode: 0o700 });
    for (const name of ["relevant-endpoint-observations.jsonl", "relevant-navigation-observations.jsonl", "relevant-correlation-candidates.jsonl"]) await fs.promises.writeFile(path.join(promotion, name), "", { mode: 0o600 });
    await writeJson(path.join(promotion, "evidence-refs.json"), { refs: [] });
    await writeJson(path.join(promotion, "research-gaps.json"), { gaps: [] });
    await fs.promises.writeFile(path.join(promotion, "README.md"), "# Promotion Input\n\nAnalysis input only. It does not modify tingyun-cli or promote any endpoint.\n", { mode: 0o600 });
  }

  private async deriveSession(taskId: string, sessionId: string): Promise<{ windows: unknown[]; navigation: unknown[]; correlations: unknown[]; endpoints: unknown[]; downloads: unknown[] }> {
    const session = this.tasks.sessionPaths(taskId, sessionId);
    const v1Events = await readJsonl<RawEvent>(path.join(session.raw, "events.jsonl")).catch(() => []);
    const browserEvents = await readJsonl<ObservationEvent>(path.join(session.raw, "browser-events.jsonl")).catch(() => []);
    const navigationFacts = await readJsonl<Record<string, unknown>>(path.join(session.raw, "navigations.jsonl")).catch(() => []);
    const annotations = await readJsonl<Record<string, unknown>>(path.join(session.raw, "annotations.jsonl")).catch(() => []);
    const observations = [...browserEvents, ...v1Events.flatMap(mapV1Event), ...annotations.map(mapAnnotation), ...navigationFacts.filter(isVerificationFact).map(mapVerification)].sort((a, b) => a.at.localeCompare(b.at) || String(a.event_id ?? "").localeCompare(String(b.event_id ?? "")));
    const windows = buildInteractionWindows(observations);
    const navigation = buildNavigationObservations(windows, observations).map((item) => ({ ...item, session_id: sessionId }));
    const requests = collectV1Requests(v1Events);
    const responseBodies = await Promise.all(requests.map(async (request) => ({ event_id: `response-${request.request_id}`, body: await readBody(session.root, request.response_body?.ref) })));
    const requestBodies = await Promise.all(requests.map(async (request) => ({ event_id: request.request_id, url: request.url, body: await readBody(session.root, request.request_body?.ref) })));
    const correlations = buildCorrelationCandidates({ windows: windows.map((window) => ({ window_id: window.window_id, response_refs: window.response_refs, request_refs: window.request_refs })), responses: responseBodies, requests: requestBodies }).map((item) => ({ ...item, session_id: sessionId }));
    const endpoints = buildEndpointObservations(await Promise.all(requests.map(async (request): Promise<EndpointInput> => ({ request_id: request.request_id, session_id: sessionId, window_id: windows.find((window) => window.request_refs.includes(request.request_id))?.window_id, method: request.method, url: request.url, request_content_type: request.request_body?.content_type, request_body: await readBody(session.root, request.request_body?.ref), response_content_type: request.response_body?.content_type, response_body: await readBody(session.root, request.response_body?.ref), status: request.status, resource_type: request.resource_type }))));
    const downloads = await deriveDownloads(sessionId, session.raw, session.derived, v1Events);
    await Promise.all([
      writeJsonlFile(path.join(session.derived, "interaction-windows.jsonl"), windows),
      writeJsonlFile(path.join(session.derived, "navigation-observations.jsonl"), navigation),
      writeJsonlFile(path.join(session.derived, "correlation-candidates.jsonl"), correlations),
      writeJsonlFile(path.join(session.derived, "endpoint-observations.jsonl"), endpoints),
      writeJsonlFile(path.join(session.derived, "download-index.jsonl"), downloads),
      writeJson(path.join(session.derived, "session-summary.json"), { schema_version: 1, session_id: sessionId, interaction_window_count: windows.length, navigation_observation_count: navigation.length, correlation_candidate_count: correlations.length, endpoint_observation_count: endpoints.length, download_count: downloads.length })
    ]);
    const aiReady = path.join(session.derived, "ai-ready");
    if (await exists(aiReady)) {
      await Promise.all([
        writeJsonlFile(path.join(aiReady, "navigation-observations.jsonl"), navigation),
        writeJsonlFile(path.join(aiReady, "correlation-candidates.jsonl"), correlations),
        writeJsonlFile(path.join(aiReady, "endpoint-observations.jsonl"), endpoints),
        writeJsonlFile(path.join(aiReady, "download-index.jsonl"), downloads),
        writeJson(path.join(aiReady, "task-context.json"), { schema_version: 1, task_id: taskId, session_id: sessionId })
      ]);
    }
    return { windows, navigation, correlations, endpoints, downloads };
  }

  async exportTask(taskId: string, type: "private" | "shareable"): Promise<ExportResult> {
    await this.aggregate(taskId);
    const taskPaths = this.tasks.taskPaths(taskId);
    const exportRoot = path.join(taskPaths.exports, type);
    const staging = path.join(exportRoot, `.staging-${process.pid}`);
    await fs.promises.rm(staging, { recursive: true, force: true });
    await fs.promises.mkdir(staging, { recursive: true, mode: 0o700 });
    try {
      if (type === "private") await this.buildPrivate(taskId, staging);
      else await this.buildShareable(taskId, staging);
      const preZip = await scanDirectory(staging);
      if (preZip.status === "BLOCKED") throw new Error(`BLOCKED: ${preZip.findings.map((finding) => `${finding.kind}:${finding.file}`).join(", ")}`);
      await writeJson(path.join(staging, "security-report.json"), preZip);
      await fs.promises.writeFile(path.join(staging, "security-report.md"), securityMarkdown(preZip), { mode: 0o600 });
      const files = await relativeFiles(staging);
      const coreHashes = Object.fromEntries(await Promise.all(files.filter((file) => !file.startsWith("security-report.")).map(async (file) => [file, sha256(await fs.promises.readFile(path.join(staging, file)))])));
      const zipPath = path.join(exportRoot, `${taskId}-${type}.zip`);
      await zipDirectory(staging, zipPath);
      const postZip = await scanZip(zipPath);
      if (postZip.status === "BLOCKED") {
        await fs.promises.rm(zipPath, { force: true });
        throw new Error(`BLOCKED after ZIP rescan: ${postZip.findings.map((finding) => finding.kind).join(", ")}`);
      }
      return { type, zip_path: zipPath, files: await relativeFiles(staging), core_hashes: coreHashes, security: postZip };
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true });
    }
  }

  private async buildPrivate(taskId: string, staging: string): Promise<void> {
    const source = this.tasks.taskPaths(taskId);
    await fs.promises.copyFile(source.task, path.join(staging, "task.json"));
    await fs.promises.copyFile(source.events, path.join(staging, "task-events.jsonl"));
    await fs.promises.cp(source.research, path.join(staging, "research"), { recursive: true });
    await fs.promises.cp(source.sessions, path.join(staging, "sessions"), { recursive: true, filter: (candidate) => !forbiddenPrivatePath(candidate) });
    await this.writeResearchReadme(taskId, staging, "PRIVATE");
  }

  private async buildShareable(taskId: string, staging: string): Promise<void> {
    const task = await this.tasks.readTask(taskId);
    const tokenizer = new StableTokenizer();
    const safeTask = sanitizeShareable(task, tokenizer) as ResearchTask;
    await writeJson(path.join(staging, "task.json"), safeTask);
    await fs.promises.writeFile(path.join(staging, "README_FOR_RESEARCH.md"), String(sanitizeShareable(readme(task, (await this.tasks.listSessions(taskId)).map((session) => session.session_id), "SHAREABLE"), tokenizer)), { mode: 0o600 });
    const researchSource = this.tasks.taskPaths(taskId).research;
    for (const file of await relativeFiles(researchSource)) {
      const source = path.join(researchSource, file);
      const text = await fs.promises.readFile(source, "utf8");
      const target = path.join(staging, "research", sanitizeFileName(file, tokenizer));
      await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      if (file.endsWith(".json")) await writeJson(target, sanitizeShareable(JSON.parse(text), tokenizer));
      else if (file.endsWith(".jsonl")) await fs.promises.writeFile(target, (await parseJsonlText(text)).map((item) => JSON.stringify(sanitizeShareable(item, tokenizer))).join("\n") + (text.trim() ? "\n" : ""), { mode: 0o600 });
      else await fs.promises.writeFile(target, String(sanitizeShareable(text, tokenizer)), { mode: 0o600 });
    }
    for (const session of await this.tasks.listSessions(taskId)) {
      const sessionPaths = this.tasks.sessionPaths(taskId, session.session_id);
      const sourceSecurity = await scanDirectory(sessionPaths.raw);
      if (sourceSecurity.status === "BLOCKED") throw new Error(`BLOCKED: high-risk source facts in ${session.session_id}: ${sourceSecurity.findings.map((finding) => finding.kind).join(", ")}`);
      const requestsPath = path.join(sessionPaths.raw, "network-requests.jsonl");
      const requestText = await fs.promises.readFile(requestsPath, "utf8").catch(() => "");
      if (hasHighRiskSecrets(requestText)) throw new Error(`BLOCKED: high-risk secret in ${session.session_id}/network-requests.jsonl`);
      const requests = await parseJsonlText(requestText);
      const sessionTarget = path.join(staging, "sessions", sanitizeFileName(session.session_id, tokenizer), "ai-ready");
      await fs.promises.mkdir(sessionTarget, { recursive: true, mode: 0o700 });
      await fs.promises.writeFile(path.join(sessionTarget, "network-index.jsonl"), requests.map((item) => JSON.stringify(sanitizeShareable(item, tokenizer))).join("\n") + (requests.length ? "\n" : ""), { mode: 0o600 });
      await writeJson(path.join(sessionTarget, "session.json"), sanitizeShareable(session, tokenizer));
      for (const sourceRoot of [sessionPaths.derived, path.join(sessionPaths.derived, "ai-ready")]) {
        if (!(await exists(sourceRoot))) continue;
        for (const file of await relativeFiles(sourceRoot)) {
          if (!/\.(?:json|jsonl|md|txt|csv)$/i.test(file)) continue;
          if (sourceRoot.endsWith("ai-ready") && file === "network-index.jsonl") continue;
          const target = path.join(sessionTarget, sourceRoot.endsWith("ai-ready") ? "ai-ready" : "derived", sanitizeFileName(file, tokenizer));
          await writeSanitizedFile(path.join(sourceRoot, file), target, tokenizer);
        }
      }
    }
    await writeJson(path.join(staging, "tokenization-report.json"), tokenizer.publicReport());
  }

  private async writeResearchReadme(taskId: string, root: string, security: "PRIVATE" | "SHAREABLE"): Promise<void> {
    const task = await this.tasks.readTask(taskId);
    const sessions = await this.tasks.listSessions(taskId);
    await fs.promises.writeFile(path.join(root, "README_FOR_RESEARCH.md"), readme(task, sessions.map((session) => session.session_id), security), { mode: 0o600 });
  }
}

function readme(task: ResearchTask, sessions: string[], security: string): string {
  return `# Research Package\n\n## Task Goal\n\n${task.goal}\n\n## Success Criteria\n\n${task.success_criteria.map((item) => `- ${item}`).join("\n") || "- none declared"}\n\n## Do Not Assume\n\n${task.do_not_assume.map((item) => `- ${item}`).join("\n") || "- no additional assumptions declared"}\n\n## Sessions\n\n${sessions.map((item) => `- ${item}`).join("\n") || "- none"}\n\n## Reading Order\n\n1. Read this file.\n2. Read task.json and research/task-summary.json.\n3. Read navigation, endpoint, and correlation indexes.\n4. Open session AI-ready evidence only as needed.\n\n## Evidence Boundaries\n\nRaw is private fact evidence. Derived indexes are deterministic observations. Researcher annotations are human statements. Protocol conclusions are external inference. Known gaps are in research/evidence-gaps.json.\n\nSecurity level: ${security}. This package does not answer the research question.\n`;
}

function forbiddenPrivatePath(candidate: string): boolean {
  const lower = candidate.toLowerCase();
  return /(?:^|\/)(?:\.env|env\.sh|\.zsh_history|\.bash_history)(?:$|\/)/.test(lower) || lower.includes("browser-profile") || lower.includes("/exports/");
}

function sanitizeFileName(file: string, tokenizer: StableTokenizer): string {
  return String(sanitizeShareable(file, tokenizer)).replace(/\.\.(?:\/|\\)/g, "");
}

async function parseJsonlText(text: string): Promise<unknown[]> {
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function relativeFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      if (entry.isFile()) output.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  await visit(root);
  return output.sort();
}

async function zipDirectory(source: string, target: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(target, { mode: 0o600 });
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(source, false);
    void archive.finalize();
  });
}

function securityMarkdown(report: SecurityReport): string {
  return `# Security Report\n\nStatus: ${report.status}\n\nScanned files: ${report.scanned_files}\n\n${report.findings.map((finding) => `- ${finding.kind}: ${finding.file}`).join("\n") || "No findings."}\n`;
}

function mapV1Event(event: RawEvent): ObservationEvent[] {
  if (event.type === "interaction_recorded") return [{ type: "interaction_recorded", at: event.at, event_id: event.interaction_id, page_id: stringValue(event.interaction.tab_id), interaction_type: stringValue(event.interaction.interaction_type), url: stringValue(event.interaction.url), title: stringValue(event.interaction.title), target: controlTarget(event.interaction.control) }];
  if (event.type === "tab_created") return [{ type: "page_created", at: event.at, event_id: `page-created-${event.tab.tab_id}`, page_id: event.tab.tab_id, opener_page_id: event.tab.opener_tab_id, url: event.tab.first_target_url ?? event.tab.current_url, title: event.tab.title }];
  if (event.type === "url_changed") return [{ type: "navigation", at: event.at, event_id: `navigation-${event.tab_id ?? "page"}-${event.at}`, page_id: event.tab_id, before_url: event.before_url, after_url: event.after_url }];
  if (event.type === "request_started") return [{ type: "request", at: event.at, event_id: event.request.request_id, page_id: event.request.tab_id }];
  if (event.type === "response_received") return [{ type: "response", at: event.at, event_id: `response-${event.request_id}` }];
  if (event.type === "download_started" || event.type === "download_completed") return [{ type: event.type, at: event.at, event_id: event.download_id, page_id: stringValue(event.data.tab_id) }];
  return [];
}

function mapAnnotation(annotation: Record<string, unknown>): ObservationEvent {
  const kind = String(annotation.kind ?? "NOTE").toLowerCase();
  return { type: `annotation_${kind}`, at: String(annotation.created_at ?? ""), event_id: String(annotation.annotation_id ?? ""), page_id: stringValue(annotation.page_id), url: stringValue(annotation.current_url) };
}

function mapVerification(fact: Record<string, unknown>): ObservationEvent {
  const nested = (fact.before ?? fact.source) as Record<string, unknown> | undefined;
  const rawType = String(fact.type ?? (fact.kind ? `${fact.kind}_verify_result` : "navigation_verification"));
  return { ...fact, type: rawType, at: String(fact.at ?? ""), event_id: String(fact.event_id ?? `verification-${String(fact.at ?? "")}`), page_id: stringValue(fact.page_id) ?? stringValue(nested?.tab_id), url: stringValue(fact.url) ?? stringValue(nested?.url) };
}

function isVerificationFact(fact: Record<string, unknown>): boolean {
  return typeof fact.kind === "string" || /verify_result$/.test(String(fact.type ?? ""));
}

function collectV1Requests(events: RawEvent[]): RequestRecord[] {
  const records = new Map<string, RequestRecord>();
  for (const event of events) {
    if (event.type === "request_started" || event.type === "request_completed" || event.type === "request_failed") records.set(event.request.request_id, { ...(records.get(event.request.request_id) ?? {}), ...event.request } as RequestRecord);
  }
  return [...records.values()].sort((a, b) => a.started_at.localeCompare(b.started_at) || a.request_id.localeCompare(b.request_id));
}

async function readBody(root: string, ref?: string): Promise<unknown> {
  if (!ref) return undefined;
  const file = path.resolve(root, ref);
  if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) return undefined;
  const content = await fs.promises.readFile(file, "utf8").catch(() => undefined);
  if (content === undefined) return undefined;
  try { return JSON.parse(content); } catch { return content; }
}

async function deriveDownloads(sessionId: string, raw: string, derived: string, events: RawEvent[]): Promise<unknown[]> {
  const completed = events.filter((event): event is Extract<RawEvent, { type: "download_completed" }> => event.type === "download_completed" && event.data.status === "completed");
  const started = new Map(events.filter((event): event is Extract<RawEvent, { type: "download_started" }> => event.type === "download_started").map((event) => [event.download_id, event]));
  const output: unknown[] = [];
  for (const event of completed) {
    const filename = stringValue(event.data.actual_filename);
    if (!filename) continue;
    const source = path.join(raw, "downloads", filename);
    const normalized = await normalizeDownload({ download_id: event.download_id, source_path: source, output_dir: path.join(derived, "normalized-downloads") });
    const start = started.get(event.download_id);
    output.push({ ...normalized, session_id: sessionId, page_id: stringValue(start?.data.tab_id), source_url: stringValue(start?.data.source_page_url), suggested_filename: stringValue(start?.data.suggested_filename), final_filename: filename, started_at: start?.at, completed_at: event.at });
  }
  return output.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function criterionEvidence(criterion: string, derived: Array<{ windows: unknown[]; navigation: unknown[]; correlations: unknown[]; endpoints: unknown[]; downloads: unknown[] }>): Record<string, unknown> {
  const lower = criterion.toLowerCase();
  const groups: Array<[RegExp, unknown[], string]> = [
    [/url|导航|页面|route|navigation/, derived.flatMap((item) => item.navigation), "navigation_id"],
    [/参数|来源|correlation|identity|身份/, derived.flatMap((item) => item.correlations), "candidate_id"],
    [/接口|endpoint|request|请求/, derived.flatMap((item) => item.endpoints), "endpoint_observation_id"],
    [/下载|csv|excel|xlsx/, derived.flatMap((item) => item.downloads), "download_id"],
    [/交互|window|操作/, derived.flatMap((item) => item.windows), "window_id"]
  ];
  const matched = groups.find(([pattern]) => pattern.test(lower));
  if (!matched) return { criterion, status: "UNKNOWN", evidence_refs: [] };
  const refs = matched[1].map((item) => String((item as Record<string, unknown>)[matched[2]] ?? "")).filter(Boolean).sort();
  return { criterion, status: refs.length ? "EVIDENCE_PRESENT" : "EVIDENCE_MISSING", evidence_refs: refs };
}

function controlTarget(value: unknown): { text?: string; href?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const control = value as Record<string, unknown>;
  const attrs = control.attrs && typeof control.attrs === "object" ? control.attrs as Record<string, unknown> : {};
  return { text: stringValue(control.text) ?? stringValue(control.label), href: stringValue(attrs.href) };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

async function writeJsonlFile(file: string, records: unknown[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(file, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""), { mode: 0o600 });
}

async function exists(file: string): Promise<boolean> {
  return fs.promises.access(file).then(() => true, () => false);
}

async function writeSanitizedFile(source: string, target: string, tokenizer: StableTokenizer): Promise<void> {
  const text = await fs.promises.readFile(source, "utf8");
  await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  if (source.endsWith(".json")) return writeJson(target, sanitizeShareable(JSON.parse(text), tokenizer));
  if (source.endsWith(".jsonl")) {
    const records = await parseJsonlText(text);
    await fs.promises.writeFile(target, records.map((record) => JSON.stringify(sanitizeShareable(record, tokenizer))).join("\n") + (records.length ? "\n" : ""), { mode: 0o600 });
    return;
  }
  if (source.endsWith(".csv")) {
    await fs.promises.writeFile(target, sanitizeCsv(text, tokenizer), { mode: 0o600 });
    return;
  }
  await fs.promises.writeFile(target, String(sanitizeShareable(text, tokenizer)), { mode: 0o600 });
}

function sanitizeCsv(text: string, tokenizer: StableTokenizer): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const headers = (lines.shift() ?? "").split(",").map((value) => value.replace(/^"|"$/g, ""));
  const sensitive = headers.map((header) => /(?:traceguid|actionguid|traceid|actionid|applicationid|instanceid|userid|agreementid|contractid)$/i.test(header));
  const output = [headers.join(",")];
  for (const line of lines) {
    if (!line) continue;
    const values = line.split(",");
    output.push(values.map((value, index) => sensitive[index] ? tokenizer.tokenize(headers[index], value.replace(/^"|"$/g, "")) : String(sanitizeShareable(value, tokenizer, headers[index] ?? "csv"))).join(","));
  }
  return `${output.join("\n")}\n`;
}
