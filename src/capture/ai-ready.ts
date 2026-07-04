import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import type { CaptureConfig, RawEvent, RequestRecord } from "../shared/types";
import { readJsonl } from "./jsonl";
import { buildIntegrity, RawStore, readJson, writeJson } from "./raw-store";
import { redactFormText, redactHeaders, redactStructuredBody, redactUrl } from "./redaction";

export class AiReadyGenerator {
  constructor(
    private readonly config: CaptureConfig,
    private readonly store: RawStore
  ) {}

  async generate(sessionId: string): Promise<void> {
    const paths = this.store.pathsFor(sessionId);
    const manifest = await this.store.loadManifest(sessionId);
    const annotations = await this.store.loadAnnotations(sessionId);
    const events = await readJsonl<RawEvent>(paths.events);
    await fs.promises.rm(paths.aiReady, { recursive: true, force: true });
    await fs.promises.mkdir(path.join(paths.aiReady, "evidence", "requests"), { recursive: true, mode: 0o700 });
    await fs.promises.mkdir(path.join(paths.aiReady, "evidence", "responses"), { recursive: true, mode: 0o700 });
    const redactedEvents = events.map((event) => redactEvent(event, this.config.extraSensitiveFields));
    const requests = collectRequests(redactedEvents);
    const integrity = buildIntegrity(events, manifest);
    await writeJson(path.join(paths.aiReady, "session.json"), { manifest, annotations, steps: collectSteps(events) }, 0o600);
    await writeJson(path.join(paths.aiReady, "integrity.json"), integrity, 0o600);
    await fs.promises.writeFile(path.join(paths.aiReady, "events.jsonl"), redactedEvents.map((event) => JSON.stringify(event)).join("\n") + "\n", {
      mode: 0o600
    });
    await fs.promises.writeFile(
      path.join(paths.aiReady, "network-index.jsonl"),
      requests.map((request) => JSON.stringify(toNetworkIndex(request))).join("\n") + "\n",
      { mode: 0o600 }
    );
    await copyEvidenceBodies(paths.root, paths.aiReady, requests, this.config.extraSensitiveFields);
    await fs.promises.writeFile(path.join(paths.aiReady, "timeline.md"), buildTimeline(events, annotations), { mode: 0o600 });
    await fs.promises.writeFile(path.join(paths.aiReady, "README_FOR_AI.md"), buildReadme(manifest, annotations, integrity), { mode: 0o600 });
  }

  async zip(sessionId: string): Promise<string> {
    const paths = this.store.pathsFor(sessionId);
    const zipPath = path.join(paths.derived, `${sessionId}-ai-ready.zip`);
    await fs.promises.mkdir(paths.derived, { recursive: true, mode: 0o700 });
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath, { mode: 0o600 });
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", () => resolve());
      archive.on("error", reject);
      archive.pipe(output);
      archive.directory(paths.aiReady, false);
      void archive.finalize();
    });
    return zipPath;
  }
}

function redactEvent(event: RawEvent, extraSensitiveFields: string[]): RawEvent {
  if (event.type === "request_started" || event.type === "request_completed" || event.type === "request_failed") {
    return {
      ...event,
      request: {
        ...event.request,
        url: redactUrl(event.request.url, { extraSensitiveFields }),
        headers: redactHeaders(event.request.headers),
        response_headers: redactHeaders(event.request.response_headers)
      }
    } as RawEvent;
  }
  if (event.type === "response_received") {
    return { ...event, headers: redactHeaders(event.headers) ?? {} };
  }
  return event;
}

function collectRequests(events: RawEvent[]): RequestRecord[] {
  const records = new Map<string, RequestRecord>();
  for (const event of events) {
    if (event.type === "request_started") records.set(event.request.request_id, event.request);
    if (event.type === "request_completed" || event.type === "request_failed") records.set(event.request.request_id, event.request);
  }
  return [...records.values()];
}

function collectSteps(events: RawEvent[]): unknown[] {
  return events.filter((event) => event.type === "step_started" || event.type === "step_ended");
}

function toNetworkIndex(request: RequestRecord): Record<string, unknown> {
  return {
    request_id: request.request_id,
    method: request.method,
    url: request.url,
    status: request.status,
    lifecycle: request.lifecycle,
    step_id: request.step_id,
    tab_id: request.tab_id,
    frame_id: request.frame_id,
    started_at: request.started_at,
    response_received_at: request.response_received_at,
    completed_at: request.completed_at,
    duration_ms: request.duration_ms,
    request_body: request.request_body,
    response_body: request.response_body,
    integrity_flags: [request.request_body, request.response_body].filter((body) => body && body.save_status !== "saved")
  };
}

async function copyEvidenceBodies(root: string, aiReady: string, requests: RequestRecord[], extraSensitiveFields: string[]): Promise<void> {
  for (const request of requests) {
    await copyBody(root, aiReady, "requests", request.request_id, request.request_body, extraSensitiveFields);
    await copyBody(root, aiReady, "responses", request.request_id, request.response_body, extraSensitiveFields);
  }
}

async function copyBody(
  root: string,
  aiReady: string,
  direction: "requests" | "responses",
  requestId: string,
  body: RequestRecord["request_body"],
  extraSensitiveFields: string[]
): Promise<void> {
  if (!body?.ref || body.save_status !== "saved") return;
  if (body.kind === "binary") {
    await writeJson(path.join(aiReady, "evidence", direction, `${requestId}.metadata.json`), {
      request_id: requestId,
      raw_ref: body.ref,
      content_type: body.content_type,
      size_bytes: body.size_bytes,
      not_included_reason: "binary content cannot be deterministically redacted"
    });
    return;
  }
  const source = path.join(root, body.ref);
  const target = path.join(aiReady, "evidence", direction, path.basename(body.ref));
  const text = await fs.promises.readFile(source, "utf8");
  if (body.kind === "json") {
    try {
      await fs.promises.writeFile(target, `${JSON.stringify(redactStructuredBody(JSON.parse(text), { extraSensitiveFields }), null, 2)}\n`, {
        mode: 0o600
      });
      return;
    } catch {
      // Fall through to copying text; malformed JSON is still evidence.
    }
  }
  if ((body.content_type ?? "").toLowerCase().includes("application/x-www-form-urlencoded")) {
    await fs.promises.writeFile(target, redactFormText(text, { extraSensitiveFields }), { mode: 0o600 });
    return;
  }
  await fs.promises.writeFile(target, text, { mode: 0o600 });
}

function buildTimeline(events: RawEvent[], annotations: { sessionName: string }): string {
  const lines = [`# Timeline`, "", `Session: ${annotations.sessionName}`, ""];
  for (const event of events) {
    if (["step_started", "note_created", "url_changed", "interaction_recorded", "request_started", "request_failed"].includes(event.type)) {
      lines.push(`- ${event.at} ${event.type} ${describeEvent(event)}`);
    }
  }
  return lines.join("\n") + "\n";
}

function buildReadme(
  manifest: { session_id: string; status: string; start_time?: string; end_time?: string; target_origin: string },
  annotations: { sessionName: string; sessionSummary?: string },
  integrity: { capture_complete: boolean; gaps: unknown[] }
): string {
  return `# README_FOR_AI

This is the only entry point for this AI-ready evidence package.

## Session

- session_id: ${manifest.session_id}
- name: ${annotations.sessionName}
- status: ${manifest.status}
- target_origin: ${manifest.target_origin}
- started_at: ${manifest.start_time ?? ""}
- ended_at: ${manifest.end_time ?? ""}
- user_summary: ${annotations.sessionSummary ?? "not provided"}
- capture_complete: ${String(integrity.capture_complete)}
- known_gaps: ${integrity.gaps.length}

## Reading Order

1. Read this file first.
2. Read \`timeline.md\` for the Session and Step path.
3. Use \`network-index.jsonl\` to locate Request / Response evidence by stable ID.
4. Open files under \`evidence/requests/\` and \`evidence/responses/\` only when needed.

## Fact Boundaries

Raw-derived facts are deterministic records from the browser/debugging layer. Human annotations are user-written text. Automatic groups and indexes are deterministic organization only. Capture did not infer endpoint importance, parameter lineage, cascade causality, URL stability, or business success.

## Suggested External Analysis

- Identify candidate endpoints worth studying.
- Trace possible parameter sources using stable evidence IDs.
- Explain observed form cascade facts without assuming causality beyond the evidence.
- Locate final submit request/response candidates.
- Identify URLs that may need later manual validation.
- State which conclusions remain uncertain.
`;
}

function describeEvent(event: RawEvent): string {
  if (event.type === "step_started") return event.step.intent;
  if (event.type === "note_created") return event.text;
  if (event.type === "url_changed") return `${event.change_type}: ${event.before_url ?? ""} -> ${event.after_url}`;
  if (event.type === "request_started") return `${event.request.method} ${event.request.url}`;
  if (event.type === "request_failed") return `${event.request.request_id} ${event.request.failure_text ?? event.request.lifecycle}`;
  return "";
}
