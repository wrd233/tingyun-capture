import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import type { AnnotationState, BodyRef, CaptureConfig, RawEvent, RawManifest, RequestRecord } from "../shared/types";
import { readJsonl } from "./jsonl";
import {
  AI_READY_EVIDENCE_POLICY_VERSION,
  AI_READY_INTERACTION_WINDOW_MAX_MS,
  AI_READY_LEGACY_NEW_TAB_PROXIMITY_MS,
  aiReadyOmissionReason,
  aiReadyPrimaryResourceTypes,
  aiReadyStaticResourceTypes,
  isAiReadyPrimaryEvidenceRequest
} from "./ai-ready-policy";
import { buildIntegrity, RawStore, readJson, writeJson } from "./raw-store";
import { redactFormText, redactHeaders, redactStructuredBody, redactUrl } from "./redaction";

interface CopyStats {
  copiedBodyBytes: number;
}

interface OmissionSummary {
  policy_version: string;
  reason: string;
  total_requests: number;
  ai_ready_retained_requests: number;
  omitted_requests: number;
  copied_body_bytes: number;
  omitted_body_bytes: number;
  body_bytes_by_resource_type: Record<string, number>;
  requests_by_resource_type: Record<string, { total: number; retained: number; omitted: number; body_bytes: number; omission_reason?: string }>;
  retained_resource_types: string[];
  static_resource_types_kept_in_raw_only: string[];
}

interface InteractionWindow {
  interaction_id: string;
  source_tab_id?: string;
  start_at: string;
  end_at: string;
  interaction: {
    type?: unknown;
    control?: unknown;
    page_url?: unknown;
    title?: unknown;
  };
  observed_url_changes: Array<{ at: string; tab_id?: string; before_url?: string; after_url: string; change_type: string }>;
  observed_new_tabs: Array<{ at: string; tab_id: string; opener_tab_id?: string; first_target_url?: string; title?: string; association_basis: string[] }>;
  observed_requests: Array<ReturnType<typeof toNetworkIndex>>;
  association_basis: string[];
}

export class AiReadyGenerator {
  constructor(
    private readonly config: CaptureConfig,
    private readonly store: RawStore
  ) {}

  async generate(sessionId: string): Promise<void> {
    this.store.attach(sessionId);
    const paths = this.store.pathsFor(sessionId);
    const tempAiReady = path.join(paths.derived, `.ai-ready-${process.pid}-${Date.now()}.tmp`);
    try {
      await fs.promises.rm(tempAiReady, { recursive: true, force: true });
      await fs.promises.mkdir(path.join(tempAiReady, "evidence", "requests"), { recursive: true, mode: 0o700 });
      await fs.promises.mkdir(path.join(tempAiReady, "evidence", "responses"), { recursive: true, mode: 0o700 });

      const manifest = await this.store.loadManifest(sessionId);
      const finalManifest: RawManifest = { ...manifest, ai_ready_status: "READY" };
      const annotations = await this.store.loadAnnotations(sessionId);
      const rawEvents = await readJsonl<RawEvent>(paths.events);
      const redactedEvents = rawEvents.map((event) => redactEvent(event, this.config.extraSensitiveFields));
      const redactedRequests = collectRequests(redactedEvents);
      const primaryRequests = redactedRequests.filter(isAiReadyPrimaryEvidenceRequest);
      const copyStats: CopyStats = { copiedBodyBytes: 0 };
      const aiReadyRequests = await copyEvidenceBodies(paths.root, tempAiReady, primaryRequests, this.config.extraSensitiveFields, copyStats);
      const omissionSummary = buildOmissionSummary(redactedRequests, aiReadyRequests, copyStats);
      const networkIndex = aiReadyRequests.map((request) => toNetworkIndex(request));
      const interactionWindows = buildInteractionWindows(rawEvents, aiReadyRequests);
      const aiReadyEvents = selectAiReadyEvents(redactedEvents);
      const rawIntegrity = buildIntegrity(rawEvents, finalManifest);
      const integrity = {
        raw: rawIntegrity,
        ai_ready: {
          status: "READY",
          policy_version: AI_READY_EVIDENCE_POLICY_VERSION,
          generated_at: new Date().toISOString(),
          self_contained: true,
          state_consistent: true,
          reference_integrity: { ok: true }
        },
        omissions: omissionSummary
      };

      await writeJson(path.join(tempAiReady, "session.json"), {
        manifest: finalManifest,
        annotations,
        steps: collectSteps(rawEvents),
        notes: collectNotes(rawEvents),
        ai_ready_policy_version: AI_READY_EVIDENCE_POLICY_VERSION
      }, 0o600);
      await writeJson(path.join(tempAiReady, "integrity.json"), integrity, 0o600);
      await writeJson(path.join(tempAiReady, "omissions.json"), omissionSummary, 0o600);
      await fs.promises.writeFile(path.join(tempAiReady, "events.jsonl"), jsonl(aiReadyEvents), { mode: 0o600 });
      await fs.promises.writeFile(path.join(tempAiReady, "network-index.jsonl"), jsonl(networkIndex), { mode: 0o600 });
      await fs.promises.writeFile(path.join(tempAiReady, "interaction-windows.jsonl"), jsonl(interactionWindows), { mode: 0o600 });
      await fs.promises.writeFile(path.join(tempAiReady, "journey.md"), buildJourney(annotations, interactionWindows), { mode: 0o600 });
      await fs.promises.writeFile(path.join(tempAiReady, "README_FOR_AI.md"), buildReadme(finalManifest, annotations, rawIntegrity, omissionSummary), { mode: 0o600 });

      const validation = await validateAiReadyBundle(tempAiReady);
      if (!validation.ok) throw new Error(`AI-ready validation failed: ${validation.errors.join("; ")}`);
      await fs.promises.rm(paths.aiReady, { recursive: true, force: true });
      await fs.promises.rename(tempAiReady, paths.aiReady);
      await this.store.updateManifest((current) => ({ ...current, ai_ready_status: "READY" }));
    } catch (error) {
      await fs.promises.rm(tempAiReady, { recursive: true, force: true }).catch(() => undefined);
      await this.store.updateManifest((current) => ({ ...current, ai_ready_status: "FAILED" })).catch(() => undefined);
      throw error;
    }
  }

  async zip(sessionId: string): Promise<string> {
    const paths = this.store.pathsFor(sessionId);
    const validation = await validateAiReadyBundle(paths.aiReady);
    if (!validation.ok) throw new Error(`AI-ready validation failed: ${validation.errors.join("; ")}`);
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
  if (event.type === "response_received") return { ...event, headers: redactHeaders(event.headers) ?? {} };
  return event;
}

function collectRequests(events: RawEvent[]): RequestRecord[] {
  const records = new Map<string, RequestRecord>();
  for (const event of events) {
    if (event.type === "request_started") records.set(event.request.request_id, event.request);
    if (event.type === "request_completed" || event.type === "request_failed") records.set(event.request.request_id, event.request);
  }
  return [...records.values()].sort((a, b) => a.started_at.localeCompare(b.started_at) || a.request_id.localeCompare(b.request_id));
}

function collectSteps(events: RawEvent[]): unknown[] {
  return events.filter((event) => event.type === "step_started" || event.type === "step_ended");
}

function collectNotes(events: RawEvent[]): unknown[] {
  return events.filter((event) => event.type === "note_created");
}

function selectAiReadyEvents(events: RawEvent[]): RawEvent[] {
  const reliableSubmitWindows = new Set(
    events
      .filter((event) => event.type === "submit_window_opened" && Boolean(event.trigger))
      .map((event) => (event.type === "submit_window_opened" ? event.submit_window_id : ""))
  );
  const reliableFormStates = new Set(
    events
      .filter((event) => event.type === "submit_window_opened" && Boolean(event.trigger) && event.form_state_id)
      .map((event) => (event.type === "submit_window_opened" ? event.form_state_id : ""))
  );
  return events.filter((event) => {
    if (event.type.startsWith("request_") || event.type === "response_received") return false;
    if (event.type === "form_state_recorded") return reliableFormStates.has(event.form_state_id);
    if (event.type === "submit_window_opened") return reliableSubmitWindows.has(event.submit_window_id);
    return [
      "session_started",
      "session_end_requested",
      "session_sealed",
      "session_interrupted",
      "step_started",
      "step_ended",
      "note_created",
      "tab_created",
      "tab_activated",
      "tab_closed",
      "url_changed",
      "interaction_recorded",
      "download_started",
      "download_completed",
      "integrity_gap"
    ].includes(event.type);
  });
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
    resource_type: request.resource_type,
    started_at: request.started_at,
    response_received_at: request.response_received_at,
    completed_at: request.completed_at,
    duration_ms: request.duration_ms,
    request_body: request.request_body,
    response_body: request.response_body,
    integrity_flags: [request.request_body, request.response_body].filter((body) => body && body.save_status !== "saved")
  };
}

async function copyEvidenceBodies(
  root: string,
  aiReady: string,
  requests: RequestRecord[],
  extraSensitiveFields: string[],
  stats: CopyStats
): Promise<RequestRecord[]> {
  const copied: RequestRecord[] = [];
  for (const request of requests) {
    copied.push({
      ...request,
      request_body: await copyBody(root, aiReady, "requests", request.request_id, request.request_body, extraSensitiveFields, stats),
      response_body: await copyBody(root, aiReady, "responses", request.request_id, request.response_body, extraSensitiveFields, stats)
    });
  }
  return copied;
}

async function copyBody(
  root: string,
  aiReady: string,
  direction: "requests" | "responses",
  requestId: string,
  body: BodyRef | undefined,
  extraSensitiveFields: string[],
  stats: CopyStats
): Promise<BodyRef | undefined> {
  if (!body?.ref || body.save_status !== "saved") return body;
  if (body.kind === "binary") {
    const ref = path.posix.join("evidence", direction, `${requestId}.metadata.json`);
    await writeJson(path.join(aiReady, ref), {
      request_id: requestId,
      content_type: body.content_type,
      size_bytes: body.size_bytes,
      not_included_reason: "binary content cannot be deterministically redacted"
    });
    return { ...body, ref, save_status: "metadata_only", reason: "binary content cannot be deterministically redacted" };
  }
  const source = path.join(root, body.ref);
  const ref = path.posix.join("evidence", direction, path.basename(body.ref));
  const target = path.join(aiReady, ref);
  const text = await fs.promises.readFile(source, "utf8");
  if (body.kind === "json") {
    try {
      await fs.promises.writeFile(target, `${JSON.stringify(redactStructuredBody(JSON.parse(text), { extraSensitiveFields }), null, 2)}\n`, {
        mode: 0o600
      });
      stats.copiedBodyBytes += (await fs.promises.stat(target)).size;
      return { ...body, ref };
    } catch {
      // Malformed JSON is still textual evidence; fall through to text handling.
    }
  }
  if ((body.content_type ?? "").toLowerCase().includes("application/x-www-form-urlencoded")) {
    await fs.promises.writeFile(target, redactFormText(text, { extraSensitiveFields }), { mode: 0o600 });
  } else {
    await fs.promises.writeFile(target, text, { mode: 0o600 });
  }
  stats.copiedBodyBytes += (await fs.promises.stat(target)).size;
  return { ...body, ref };
}

function buildOmissionSummary(allRequests: RequestRecord[], retainedRequests: RequestRecord[], stats: CopyStats): OmissionSummary {
  const retainedIds = new Set(retainedRequests.map((request) => request.request_id));
  const requestsByType: OmissionSummary["requests_by_resource_type"] = {};
  const bodyBytesByType: Record<string, number> = {};
  let omittedBodyBytes = 0;
  for (const request of allRequests) {
    const resourceType = request.resource_type ?? "unknown";
    const requestBodyBytes = savedBodyBytes(request.request_body) + savedBodyBytes(request.response_body);
    const retained = retainedIds.has(request.request_id);
    requestsByType[resourceType] ??= { total: 0, retained: 0, omitted: 0, body_bytes: 0, omission_reason: aiReadyOmissionReason(request) };
    requestsByType[resourceType].total += 1;
    requestsByType[resourceType].body_bytes += requestBodyBytes;
    bodyBytesByType[resourceType] = (bodyBytesByType[resourceType] ?? 0) + requestBodyBytes;
    if (retained) {
      requestsByType[resourceType].retained += 1;
    } else {
      requestsByType[resourceType].omitted += 1;
      omittedBodyBytes += requestBodyBytes;
    }
  }
  return {
    policy_version: AI_READY_EVIDENCE_POLICY_VERSION,
    reason: "static_resource_body_kept_in_raw_only",
    total_requests: allRequests.length,
    ai_ready_retained_requests: retainedRequests.length,
    omitted_requests: allRequests.length - retainedRequests.length,
    copied_body_bytes: stats.copiedBodyBytes,
    omitted_body_bytes: omittedBodyBytes,
    body_bytes_by_resource_type: bodyBytesByType,
    requests_by_resource_type: requestsByType,
    retained_resource_types: aiReadyPrimaryResourceTypes(),
    static_resource_types_kept_in_raw_only: aiReadyStaticResourceTypes()
  };
}

function savedBodyBytes(body: BodyRef | undefined): number {
  return body?.save_status === "saved" ? body.size_bytes ?? 0 : 0;
}

function buildInteractionWindows(events: RawEvent[], aiReadyRequests: RequestRecord[]): InteractionWindow[] {
  const interactions = events.filter((event): event is Extract<RawEvent, { type: "interaction_recorded" }> => event.type === "interaction_recorded");
  const urlChanges = events.filter((event): event is Extract<RawEvent, { type: "url_changed" }> => event.type === "url_changed");
  const tabCreated = events.filter((event): event is Extract<RawEvent, { type: "tab_created" }> => event.type === "tab_created");
  const windows: InteractionWindow[] = [];
  for (let index = 0; index < interactions.length; index += 1) {
    const event = interactions[index];
    const sourceTabId = stringValue(event.interaction.tab_id);
    const startMs = Date.parse(event.at);
    const nextSameTab = interactions.find((candidate, candidateIndex) => candidateIndex > index && stringValue(candidate.interaction.tab_id) === sourceTabId);
    const fixedEndMs = startMs + AI_READY_INTERACTION_WINDOW_MAX_MS;
    const endMs = Math.min(fixedEndMs, nextSameTab ? Date.parse(nextSameTab.at) : fixedEndMs);
    const associatedTabs = new Set<string>(sourceTabId ? [sourceTabId] : []);
    const basis = new Set<string>(["time_window"]);
    const observedNewTabs = tabCreated
      .filter((tabEvent) => inWindow(tabEvent.at, startMs, endMs))
      .map((tabEvent) => {
        const tabBasis: string[] = [];
        if (sourceTabId && tabEvent.tab.opener_tab_id === sourceTabId) {
          tabBasis.push("opener_tab_id");
          basis.add("opener_tab_id");
          associatedTabs.add(tabEvent.tab.tab_id);
        } else if (!tabEvent.tab.opener_tab_id && Date.parse(tabEvent.at) - startMs <= AI_READY_LEGACY_NEW_TAB_PROXIMITY_MS) {
          tabBasis.push("temporal_proximity");
          basis.add("temporal_proximity");
          associatedTabs.add(tabEvent.tab.tab_id);
        }
        if (tabBasis.length === 0) return undefined;
        return {
          at: tabEvent.at,
          tab_id: tabEvent.tab.tab_id,
          opener_tab_id: tabEvent.tab.opener_tab_id,
          first_target_url: tabEvent.tab.first_target_url,
          title: tabEvent.tab.title,
          association_basis: tabBasis
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const observedUrlChanges = urlChanges
      .filter((change) => inWindow(change.at, startMs, endMs) && (!change.tab_id || associatedTabs.has(change.tab_id)))
      .map((change) => ({
        at: change.at,
        tab_id: change.tab_id,
        before_url: change.before_url,
        after_url: change.after_url,
        change_type: change.change_type
      }));
    const observedRequests = aiReadyRequests
      .filter((request) => inWindow(request.started_at, startMs, endMs) && (!request.tab_id || associatedTabs.has(request.tab_id)))
      .map(toNetworkIndex);
    windows.push({
      interaction_id: event.interaction_id,
      source_tab_id: sourceTabId,
      start_at: event.at,
      end_at: new Date(endMs).toISOString(),
      interaction: {
        type: event.interaction.interaction_type,
        control: event.interaction.control,
        page_url: event.interaction.url,
        title: event.interaction.title
      },
      observed_url_changes: observedUrlChanges,
      observed_new_tabs: observedNewTabs,
      observed_requests: observedRequests,
      association_basis: [...basis].sort()
    });
  }
  return windows;
}

function buildJourney(annotations: AnnotationState, windows: InteractionWindow[]): string {
  const lines = [`# Journey`, "", `Session: ${annotations.sessionName}`, "", `Policy: ${AI_READY_EVIDENCE_POLICY_VERSION}`, ""];
  if (windows.length === 0) {
    lines.push("No human interactions were recorded in this Session.", "");
    return lines.join("\n");
  }
  for (const window of windows) {
    const control = controlLabel(window.interaction.control);
    lines.push(`## ${window.start_at} ${window.interaction_id}`);
    lines.push("");
    lines.push(`- interaction_type: ${String(window.interaction.type ?? "unknown")}`);
    lines.push(`- tab_id: ${window.source_tab_id ?? "unknown"}`);
    lines.push(`- page_url: ${String(window.interaction.page_url ?? "")}`);
    if (control) lines.push(`- control: ${control}`);
    lines.push(`- observed_in_window: ${window.start_at} to ${window.end_at}`);
    lines.push(`- association_basis: ${window.association_basis.join(", ")}`);
    lines.push("");
    if (window.observed_url_changes.length > 0) {
      lines.push("Observed URL Changes:");
      for (const change of window.observed_url_changes) {
        lines.push(`- ${change.at} ${change.tab_id ?? "unknown-tab"} ${change.change_type}: ${change.before_url ?? ""} -> ${change.after_url}`);
      }
      lines.push("");
    }
    if (window.observed_new_tabs.length > 0) {
      lines.push("Observed New Tabs:");
      for (const tab of window.observed_new_tabs) {
        lines.push(`- ${tab.at} ${tab.tab_id} opener=${tab.opener_tab_id ?? "unknown"} basis=${tab.association_basis.join(", ")} url=${tab.first_target_url ?? ""}`);
      }
      lines.push("");
    }
    if (window.observed_requests.length > 0) {
      lines.push("Observed Primary Requests:");
      for (const request of window.observed_requests) {
        lines.push(`- ${String(request.started_at)} ${String(request.request_id)} ${String(request.method)} ${String(request.url)} status=${String(request.status ?? "")} resource_type=${String(request.resource_type ?? "")}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n") + "\n";
}

function buildReadme(
  manifest: Pick<RawManifest, "session_id" | "status" | "start_time" | "end_time" | "target_origin" | "ai_ready_status">,
  annotations: AnnotationState,
  integrity: { capture_complete: boolean; gaps: unknown[] },
  omissions: OmissionSummary
): string {
  return `# README_FOR_AI

This is the only entry point for this AI-ready evidence package.

## Session

- session_id: ${manifest.session_id}
- name: ${annotations.sessionName}
- status: ${manifest.status}
- ai_ready_status: ${manifest.ai_ready_status}
- target_origin: ${manifest.target_origin}
- started_at: ${manifest.start_time ?? ""}
- ended_at: ${manifest.end_time ?? ""}
- user_summary: ${annotations.sessionSummary ?? "not provided"}
- capture_complete: ${String(integrity.capture_complete)}
- known_gaps: ${integrity.gaps.length}

## Reading Order

1. Read this file first.
2. Read \`journey.md\` for the human exploration path.
3. Read \`interaction-windows.jsonl\` for machine-readable observed_in_window groups.
4. Use \`network-index.jsonl\` to locate primary Request / Response evidence by stable ID.
5. Open files under \`evidence/requests/\` and \`evidence/responses/\` only when needed.

## Boundaries

Raw is the complete private fact source. AI-ready is a deterministic, redacted, self-contained derived package. Static resource bodies are not copied here by default; they remain in Raw and are summarized in \`omissions.json\`.

Interaction windows are observation groups. They use \`observed_after\`, \`observed_in_window\`, \`nearby_interaction\`, and \`association_basis\` semantics only. Capture did not infer endpoint importance, parameter lineage, cascade causality, URL stability, or business success.

## Evidence Policy

- policy_version: ${AI_READY_EVIDENCE_POLICY_VERSION}
- retained primary resource types: ${omissions.retained_resource_types.join(", ")}
- total_requests: ${omissions.total_requests}
- retained_requests: ${omissions.ai_ready_retained_requests}
- omitted_requests: ${omissions.omitted_requests}
- omitted_body_bytes: ${omissions.omitted_body_bytes}

Saved body refs in \`network-index.jsonl\` are relative to this AI-ready directory, for example \`evidence/responses/request-0001-response-abc.json\`. If deeper analysis needs JS, CSS, images, fonts, media, or other static resources, go back to Raw.

## Suggested External Analysis

- Identify candidate endpoints worth studying.
- Trace possible parameter sources using stable evidence IDs.
- Explain observed form cascade facts without assuming causality beyond the evidence.
- Locate final submit request/response candidates.
- Identify URLs that may need later manual validation.
- State which conclusions remain uncertain.
`;
}

async function validateAiReadyBundle(aiReadyRoot: string): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  const session = await readJson<{ manifest?: RawManifest }>(path.join(aiReadyRoot, "session.json")).catch((error) => {
    errors.push(`session.json unreadable: ${String(error)}`);
    return undefined;
  });
  if (session?.manifest?.ai_ready_status !== "READY") errors.push("session.json manifest ai_ready_status is not READY");
  const indexPath = path.join(aiReadyRoot, "network-index.jsonl");
  const requests = await readJsonl<Record<string, { ref?: string; save_status?: string } | undefined>>(indexPath).catch((error) => {
    errors.push(`network-index.jsonl unreadable: ${String(error)}`);
    return [];
  });
  for (const request of requests) {
    for (const key of ["request_body", "response_body"] as const) {
      const body = request[key];
      if (!body?.ref) continue;
      if (body.ref.includes("raw/bodies")) errors.push(`${String(request.request_id)} ${key} points to Raw: ${body.ref}`);
      const normalized = path.posix.normalize(body.ref);
      if (normalized.startsWith("../") || path.isAbsolute(body.ref)) errors.push(`${String(request.request_id)} ${key} escapes bundle: ${body.ref}`);
      if (body.save_status === "saved") {
        await fs.promises.access(path.join(aiReadyRoot, normalized)).catch(() => {
          errors.push(`${String(request.request_id)} ${key} missing evidence: ${body.ref}`);
        });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
}

function inWindow(at: string, startMs: number, endMs: number): boolean {
  const value = Date.parse(at);
  return value >= startMs && value <= endMs;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function controlLabel(control: unknown): string {
  if (!control || typeof control !== "object") return "";
  const item = control as Record<string, unknown>;
  return [item.tag, item.type, item.text, item.label, item.accessible_name].filter(Boolean).map(String).join(" ");
}
