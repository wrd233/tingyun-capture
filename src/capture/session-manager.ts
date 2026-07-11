import type { CaptureConfig, RawEvent, RawManifest, RequestRecord, StepRecord } from "../shared/types";
import { IdSequence } from "../shared/ids";
import { durationMs, nowIso } from "../shared/time";
import { AiReadyGenerator } from "./ai-ready";
import { buildIntegrity, PersistenceFailure, RawStore } from "./raw-store";

export interface LiveState {
  status: "IDLE" | "ACTIVE" | "FINALIZING" | "SEALED" | "INTERRUPTED";
  manifest?: RawManifest;
  currentStep?: StepRecord;
  recentEvents: RawEvent[];
  counters: {
    dynamicRequests: number;
    failedRequests: number;
    newTabs: number;
    urlChanges: number;
  };
  diskWarning?: string;
}

export class SessionManager {
  readonly ids = new IdSequence();
  private currentStep?: StepRecord;
  private manifest?: RawManifest;
  private recentEvents: RawEvent[] = [];
  private requestRecords = new Map<string, RequestRecord>();
  private pendingAtSessionEnd = new Set<string>();
  private finalizeTimer?: NodeJS.Timeout;
  private acceptingNewRequests = true;
  private counters = { dynamicRequests: 0, failedRequests: 0, newTabs: 0, urlChanges: 0 };

  constructor(
    private readonly config: CaptureConfig,
    private readonly store: RawStore,
    private readonly aiReady: AiReadyGenerator
  ) {}

  async initialize(): Promise<void> {
    const interrupted = await this.store.recoverInterruptedSessions();
    if (interrupted[0]) this.manifest = interrupted[0];
  }

  state(): LiveState {
    return {
      status: this.manifest?.status ?? "IDLE",
      manifest: this.manifest,
      currentStep: this.currentStep,
      recentEvents: this.recentEvents.slice(-20).reverse(),
      counters: this.counters
    };
  }

  activeSessionId(): string | undefined {
    return this.manifest?.status === "ACTIVE" || this.manifest?.status === "FINALIZING" ? this.manifest.session_id : undefined;
  }

  activeStepId(): string | undefined {
    return this.currentStep?.step_id;
  }

  isRecordingNewRequests(): boolean {
    return this.manifest?.status === "ACTIVE" && this.acceptingNewRequests;
  }

  async startSession(name: string, requestedSessionId?: string): Promise<RawManifest> {
    if (!name.trim()) throw new Error("Session name is required");
    await this.guardCanStartSession();
    this.manifest = await this.store.createSession(name.trim(), requestedSessionId);
    this.acceptingNewRequests = true;
    this.currentStep = undefined;
    this.recentEvents = [];
    this.requestRecords.clear();
    this.pendingAtSessionEnd.clear();
    this.counters = { dynamicRequests: 0, failedRequests: 0, newTabs: 0, urlChanges: 0 };
    return this.manifest;
  }

  async startStep(intent: string): Promise<StepRecord> {
    this.requireActive();
    if (!intent.trim()) throw new Error("Step intent is required");
    if (this.currentStep) throw new Error("An active Step already exists");
    const step: StepRecord = { step_id: this.ids.next("step"), intent: intent.trim(), started_at: nowIso() };
    this.currentStep = step;
    await this.append({ type: "step_started", at: step.started_at, step });
    await this.store.updateAnnotations((annotations) => ({
      ...annotations,
      steps: { ...annotations.steps, [step.step_id]: { intent: step.intent } }
    }));
    return step;
  }

  async endStep(result?: string): Promise<void> {
    this.requireActive();
    if (!this.currentStep) throw new Error("No active Step");
    const step = { ...this.currentStep, ended_at: nowIso() };
    this.currentStep = undefined;
    await this.append({ type: "step_ended", at: step.ended_at!, step_id: step.step_id });
    await this.store.updateAnnotations((annotations) => ({
      ...annotations,
      steps: {
        ...annotations.steps,
        [step.step_id]: { ...annotations.steps[step.step_id], result }
      }
    }));
  }

  async addNote(text: string, context: { tab_id?: string; url?: string; title?: string }): Promise<void> {
    this.requireActive();
    if (!text.trim()) throw new Error("Note text is required");
    const noteId = this.ids.next("note");
    const at = nowIso();
    await this.append({
      type: "note_created",
      at,
      note_id: noteId,
      text: text.trim(),
      step_id: this.currentStep?.step_id,
      tab_id: context.tab_id,
      url: context.url,
      title: context.title
    });
    await this.store.updateAnnotations((annotations) => ({
      ...annotations,
      notes: { ...annotations.notes, [noteId]: { text: text.trim() } }
    }));
  }

  async endSession(summary?: string): Promise<RawManifest> {
    this.requireActive();
    if (this.currentStep) await this.endStep();
    const endTime = nowIso();
    this.acceptingNewRequests = false;
    for (const [requestId, record] of this.requestRecords) {
      if (record.lifecycle === "pending") this.pendingAtSessionEnd.add(requestId);
    }
    await this.append({ type: "session_end_requested", at: endTime, session_id: this.manifest!.session_id });
    this.manifest = await this.store.updateManifest((manifest) => ({ ...manifest, status: "FINALIZING", end_time: endTime }));
    if (summary?.trim()) {
      await this.store.updateAnnotations((annotations) => ({ ...annotations, sessionSummary: summary.trim() }));
    }
    await new Promise<void>((resolve) => {
      this.finalizeTimer = setTimeout(() => resolve(), this.config.finalizationTimeoutMs);
    });
    await this.markIncompletePending();
    return this.sealCurrentSession();
  }

  async sealInterruptedSession(sessionId: string): Promise<RawManifest> {
    this.store.attach(sessionId);
    const manifest = await this.store.loadManifest(sessionId);
    if (manifest.status !== "INTERRUPTED") throw new Error("Only INTERRUPTED sessions can be sealed this way");
    this.manifest = manifest;
    return this.sealCurrentSession();
  }

  async interrupt(reason: string): Promise<void> {
    if (!this.manifest || this.manifest.status !== "ACTIVE") return;
    if (this.finalizeTimer) clearTimeout(this.finalizeTimer);
    if (this.currentStep) this.currentStep = undefined;
    this.acceptingNewRequests = false;
    const at = nowIso();
    this.manifest = await this.store.updateManifest((manifest) => ({
      ...manifest,
      status: "INTERRUPTED",
      end_time: manifest.end_time ?? at,
      interruption_reason: reason
    }));
    await this.append({ type: "session_interrupted", at, session_id: this.manifest.session_id, reason });
  }

  async recordEvent(event: RawEvent): Promise<void> {
    if (!this.manifest || this.manifest.status !== "ACTIVE") return;
    await this.append(event);
  }

  async recordRequestStarted(record: RequestRecord): Promise<void> {
    if (!this.isRecordingNewRequests()) return;
    this.requestRecords.set(record.request_id, record);
    if (!["script", "stylesheet", "image", "font"].includes(record.resource_type ?? "")) this.counters.dynamicRequests++;
    await this.append({ type: "request_started", at: record.started_at, request: record });
  }

  async recordRequestCompleted(record: RequestRecord): Promise<void> {
    if (!this.manifest) return;
    const existing = this.requestRecords.get(record.request_id);
    if (!existing) return;
    const stepEndedBeforeComplete = existing.step_id && !this.currentStep && record.completed_at;
    const completed = {
      ...existing,
      ...record,
      completed_after_step: Boolean(stepEndedBeforeComplete),
      duration_ms: record.completed_at ? durationMs(existing.started_at, record.completed_at) : undefined
    };
    this.requestRecords.set(record.request_id, completed);
    await this.append({ type: "request_completed", at: record.completed_at ?? nowIso(), request: completed });
  }

  async recordRequestFailed(record: RequestRecord): Promise<void> {
    const existing = this.requestRecords.get(record.request_id);
    if (!existing) return;
    const failed = { ...existing, ...record, lifecycle: record.lifecycle };
    this.requestRecords.set(record.request_id, failed);
    this.counters.failedRequests++;
    await this.append({ type: "request_failed", at: record.completed_at ?? nowIso(), request: failed });
  }

  incrementCounter(counter: keyof LiveState["counters"]): void {
    this.counters[counter]++;
  }

  async checkDisk(): Promise<"ok" | "low" | "critical"> {
    const free = await this.store.diskFreeBytes();
    if (free <= this.config.criticalDiskBytes) {
      await this.interrupt("low_disk_space");
      return "critical";
    }
    return free <= this.config.lowDiskBytes ? "low" : "ok";
  }

  private async sealCurrentSession(): Promise<RawManifest> {
    if (!this.manifest) throw new Error("No current session");
    const events = await this.store.events(this.manifest.session_id);
    const sealedAt = nowIso();
    this.manifest = await this.store.updateManifest((manifest) => ({
      ...manifest,
      status: "SEALED",
      sealed_time: sealedAt
    }));
    await this.append({ type: "session_sealed", at: sealedAt, session_id: this.manifest.session_id });
    const summary = buildIntegrity(await this.store.events(this.manifest.session_id), this.manifest);
    await this.store.writeIntegrity(summary);
    try {
      await this.aiReady.generate(this.manifest.session_id);
      this.manifest = await this.store.loadManifest(this.manifest.session_id);
    } catch (error) {
      await this.store.recordGap({ type: "ai_ready_failed", reason: String(error) });
      this.manifest = await this.store.loadManifest(this.manifest.session_id);
    }
    this.currentStep = undefined;
    this.acceptingNewRequests = true;
    return this.manifest;
  }

  private async markIncompletePending(): Promise<void> {
    for (const requestId of this.pendingAtSessionEnd) {
      const record = this.requestRecords.get(requestId);
      if (record?.lifecycle === "pending") {
        await this.recordRequestFailed({ ...record, lifecycle: "incomplete", completed_at: nowIso(), failure_text: "finalization_timeout" });
      }
    }
  }

  private async append(event: RawEvent): Promise<void> {
    try {
      await this.store.append(event);
      this.recentEvents.push(event);
      this.recentEvents = this.recentEvents.slice(-50);
      if (event.type === "tab_created") this.counters.newTabs++;
      if (event.type === "url_changed") this.counters.urlChanges++;
    } catch (error) {
      if (error instanceof PersistenceFailure) {
        await this.interrupt("persistence_failure");
      }
      throw error;
    }
  }

  private async guardCanStartSession(): Promise<void> {
    const manifests = await this.store.listSessions();
    const blocking = manifests.find((session) => ["ACTIVE", "FINALIZING", "INTERRUPTED"].includes(session.status));
    if (blocking) throw new Error(`Cannot start a new Session while ${blocking.session_id} is ${blocking.status}`);
  }

  private requireActive(): void {
    if (!this.manifest || this.manifest.status !== "ACTIVE") throw new Error("Session must be ACTIVE");
  }
}
