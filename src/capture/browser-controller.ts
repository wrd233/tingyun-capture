import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Download, type Frame, type Page, type Request, type Response } from "playwright";
import type { CaptureConfig, BodyRef, RequestRecord } from "../shared/types";
import { nowIso } from "../shared/time";
import { isTargetUrl } from "./config";
import { injectedObserverSource } from "./injected";
import { RawStore } from "./raw-store";
import { SessionManager } from "./session-manager";

interface PageInfo {
  tabId: string;
  lastUrl?: string;
  openerTabId?: string;
  targetTabRecorded?: boolean;
}

export class BrowserController {
  private context?: BrowserContext;
  private pages = new Map<Page, PageInfo>();
  private frames = new Map<Frame, string>();
  private requests = new Map<Request, string>();
  private clientInteractions = new Map<string, string>();
  private closing = false;

  constructor(
    private readonly config: CaptureConfig,
    private readonly store: RawStore,
    private readonly sessions: SessionManager
  ) {}

  async start(): Promise<void> {
    await fs.promises.mkdir(this.config.profileDir, { recursive: true, mode: 0o700 });
    this.context = await chromium.launchPersistentContext(this.config.profileDir, {
      headless: process.env.CAPTURE_HEADLESS === "1",
      viewport: null,
      acceptDownloads: true
    });
    await this.context.exposeBinding("tyCaptureEvent", async (source, payload) => {
      await this.handleInjectedEvent(source.page, payload as Record<string, unknown>);
    });
    await this.context.addInitScript(injectedObserverSource());
    this.context.on("page", (page) => void this.attachPage(page));
    this.context.on("close", () => {
      if (!this.closing) void this.sessions.interrupt("browser_closed");
    });
    for (const page of this.context.pages()) await this.attachPage(page);
    if (this.context.pages().length === 0) await this.context.newPage();
  }

  async stop(): Promise<void> {
    this.closing = true;
    await this.context?.close();
  }

  async activeTabContext(): Promise<{ tab_id?: string; url?: string; title?: string }> {
    for (const [page, info] of this.pages) {
      if (page.isClosed()) continue;
      if (isTargetUrl(this.config, page.url())) {
        return { tab_id: info.tabId, url: page.url(), title: await page.title().catch(() => undefined) };
      }
    }
    return {};
  }

  async reloadVerify(): Promise<Record<string, unknown>> {
    const page = this.activeTargetPage();
    if (!page) return { status: "FAILED", reason: "no_target_page", at: nowIso() };
    const before = await this.activeTabContext();
    const eventId = this.sessions.ids.next("interaction");
    await this.sessions.recordEvent({
      type: "interaction_recorded",
      at: nowIso(),
      interaction_id: eventId,
      interaction: { tab_id: before.tab_id, interaction_type: "url_verify", verification_kind: "reload", url: before.url, title: before.title }
    });
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
      const after = await this.activeTabContext();
      return { status: "PASS", kind: "reload", event_id: eventId, before, after, at: nowIso() };
    } catch (error) {
      return { status: "FAILED", kind: "reload", event_id: eventId, before, error: String(error), at: nowIso() };
    }
  }

  async newTabVerify(): Promise<Record<string, unknown>> {
    const page = this.activeTargetPage();
    if (!page || !this.context) return { status: "FAILED", reason: "no_target_page", at: nowIso() };
    const before = await this.activeTabContext();
    const eventId = this.sessions.ids.next("interaction");
    await this.sessions.recordEvent({
      type: "interaction_recorded",
      at: nowIso(),
      interaction_id: eventId,
      interaction: { tab_id: before.tab_id, interaction_type: "url_verify", verification_kind: "new_tab", url: before.url, title: before.title }
    });
    try {
      const targetUrl = page.url();
      const created = this.context.waitForEvent("page", { timeout: 5_000 });
      await page.evaluate((url) => window.open(url, "_blank"), targetUrl);
      const newPage = await created;
      await newPage.waitForLoadState("domcontentloaded", { timeout: 15_000 });
      const info = this.pages.get(newPage);
      return { status: "PASS", kind: "new_tab", event_id: eventId, source: before, target: { page_id: info?.tabId, url: newPage.url(), title: await newPage.title().catch(() => undefined) }, at: nowIso() };
    } catch (error) {
      return { status: "FAILED", kind: "new_tab", event_id: eventId, source: before, error: String(error), at: nowIso() };
    }
  }

  async openPageForTest(url: string): Promise<Page> {
    if (!this.context) throw new Error("BrowserController is not started");
    const page = await this.context.newPage();
    await page.goto(url);
    return page;
  }

  private activeTargetPage(): Page | undefined {
    return [...this.pages.keys()].find((page) => !page.isClosed() && isTargetUrl(this.config, page.url()));
  }

  async recordBaseline(): Promise<void> {
    if (!this.context) return;
    for (const page of this.context.pages()) {
      if (!isTargetUrl(this.config, page.url())) continue;
      const info = this.pages.get(page) ?? (await this.attachPage(page));
      await this.sessions.recordEvent({
        type: "form_state_recorded",
        at: nowIso(),
        form_state_id: this.sessions.ids.next("form-state"),
        context: "session_start_baseline",
        state: await safeEvaluate(page, "() => Array.from(document.querySelectorAll('input,select,textarea')).slice(0,100).map(el => ({ tag: el.tagName.toLowerCase(), name: el.getAttribute('name'), id: el.id, value: el.type === 'password' ? '***NOT_CAPTURED***' : el.value }))"),
      });
      await this.sessions.recordEvent({
        type: "tab_activated",
        at: nowIso(),
        tab_id: info.tabId,
        url: page.url(),
        title: await page.title().catch(() => undefined)
      });
    }
  }

  private async attachPage(page: Page): Promise<PageInfo> {
    let info = this.pages.get(page);
    if (info) return info;
    const opener = await page.opener().catch(() => null);
    const openerTabId = opener ? this.pages.get(opener)?.tabId : undefined;
    info = { tabId: this.sessions.ids.next("tab"), lastUrl: page.url(), openerTabId };
    this.pages.set(page, info);
    if (isTargetUrl(this.config, page.url())) {
      await this.recordTargetTabCreated(page, info, page.url());
    }
    page.on("close", () => void this.onPageClosed(page));
    page.on("framenavigated", (frame) => void this.onFrameNavigated(page, frame));
    page.on("frameattached", (frame) => void this.onFrameAttached(page, frame));
    page.on("framedetached", (frame) => void this.onFrameDetached(page, frame));
    page.on("request", (request) => void this.onRequest(page, request));
    page.on("response", (response) => void this.onResponse(response));
    page.on("requestfinished", (request) => void this.onRequestFinished(request));
    page.on("requestfailed", (request) => void this.onRequestFailed(request));
    page.on("download", (download) => void this.onDownload(page, download));
    page.on("websocket", (websocket) => {
      const wsId = this.sessions.ids.next("websocket");
      const pageInfo = this.pages.get(page);
      if (!isTargetUrl(this.config, websocket.url())) return;
      void this.sessions.recordEvent({ type: "websocket_opened", at: nowIso(), websocket_id: wsId, tab_id: pageInfo?.tabId, url: websocket.url(), step_id: this.sessions.activeStepId() });
      websocket.on("framesent", (frame) => {
        void this.sessions.recordEvent({ type: "websocket_message", at: nowIso(), websocket_id: wsId, direction: "outgoing", text: typeof frame.payload === "string" ? frame.payload : undefined });
      });
      websocket.on("framereceived", (frame) => {
        void this.sessions.recordEvent({ type: "websocket_message", at: nowIso(), websocket_id: wsId, direction: "incoming", text: typeof frame.payload === "string" ? frame.payload : undefined });
      });
      websocket.on("close", () => {
        void this.sessions.recordEvent({ type: "websocket_closed", at: nowIso(), websocket_id: wsId });
      });
    });
    return info;
  }

  private async onPageClosed(page: Page): Promise<void> {
    const info = this.pages.get(page);
    if (!info) return;
    await this.sessions.recordEvent({ type: "tab_closed", at: nowIso(), tab_id: info.tabId });
    this.pages.delete(page);
  }

  private async onFrameAttached(page: Page, frame: Frame): Promise<void> {
    const info = this.pages.get(page);
    if (!info || !isTargetUrl(this.config, frame.url() || page.url())) return;
    const frameId = this.sessions.ids.next("frame");
    this.frames.set(frame, frameId);
    await this.sessions.recordEvent({
      type: "frame_created",
      at: nowIso(),
      frame: {
        frame_id: frameId,
        tab_id: info.tabId,
        parent_frame_id: frame.parentFrame() ? this.frames.get(frame.parentFrame()!) : undefined,
        url: frame.url(),
        created_at: nowIso()
      }
    });
  }

  private async onFrameDetached(page: Page, frame: Frame): Promise<void> {
    const info = this.pages.get(page);
    const frameId = this.frames.get(frame);
    if (!info || !frameId) return;
    this.frames.delete(frame);
    await this.sessions.recordEvent({ type: "frame_destroyed", at: nowIso(), frame_id: frameId, tab_id: info.tabId });
  }

  private async onFrameNavigated(page: Page, frame: Frame): Promise<void> {
    const info = this.pages.get(page);
    if (!info || !isTargetUrl(this.config, frame.url())) return;
    if (frame === page.mainFrame() && !info.targetTabRecorded) await this.recordTargetTabCreated(page, info, frame.url());
    const before = frame === page.mainFrame() ? info.lastUrl : undefined;
    if (frame === page.mainFrame()) info.lastUrl = frame.url();
    await this.sessions.recordEvent({
      type: "url_changed",
      at: nowIso(),
      tab_id: info.tabId,
      frame_id: this.frames.get(frame),
      before_url: before,
      after_url: frame.url(),
      change_type: "navigation",
      step_id: this.sessions.activeStepId()
    });
  }

  private async recordTargetTabCreated(page: Page, info: PageInfo, url: string): Promise<void> {
    if (info.targetTabRecorded) return;
    info.targetTabRecorded = true;
    const at = nowIso();
    await this.sessions.recordEvent({
      type: "tab_created",
      at,
      tab: {
        tab_id: info.tabId,
        created_at: at,
        opener_tab_id: info.openerTabId,
        first_target_url: url,
        current_url: url,
        title: await page.title().catch(() => undefined)
      }
    });
  }

  private async onRequest(page: Page, request: Request): Promise<void> {
    if (!isTargetUrl(this.config, request.url()) || !this.sessions.isRecordingNewRequests()) return;
    const pageInfo = this.pages.get(page);
    const requestId = this.sessions.ids.next("request");
    this.requests.set(request, requestId);
    const postData = request.postDataBuffer();
    const bodyRef = await this.store.saveBody({
      direction: "request",
      requestId,
      contentType: request.headers()["content-type"],
      body: postData
    });
    const record: RequestRecord = {
      request_id: requestId,
      started_at: nowIso(),
      method: request.method(),
      url: request.url(),
      resource_type: request.resourceType(),
      tab_id: pageInfo?.tabId,
      frame_id: this.frames.get(request.frame()),
      step_id: this.sessions.activeStepId(),
      lifecycle: "pending",
      headers: request.headers(),
      request_body: bodyRef,
      redirect_chain_id: redirectChainId(request),
      redirected_from: request.redirectedFrom() ? this.requests.get(request.redirectedFrom()!) : undefined,
      redirected_to: request.redirectedTo() ? this.requests.get(request.redirectedTo()!) : undefined
    };
    await this.sessions.recordRequestStarted(record);
  }

  private async onResponse(response: Response): Promise<void> {
    const requestId = this.requests.get(response.request());
    if (!requestId) return;
    await this.sessions.recordEvent({
      type: "response_received",
      at: nowIso(),
      request_id: requestId,
      status: response.status(),
      headers: response.headers()
    });
  }

  private async onRequestFinished(request: Request): Promise<void> {
    const requestId = this.requests.get(request);
    if (!requestId) return;
    const response = await request.response();
    let responseBody: BodyRef = { kind: "not_saved", save_status: "not_available" };
    if (response) {
      try {
        responseBody = await this.store.saveBody({
          direction: "response",
          requestId,
          contentType: response.headers()["content-type"],
          body: await response.body()
        });
      } catch {
        responseBody = { kind: "not_saved", save_status: "failed", reason: "response body unavailable" };
      }
    }
    await this.sessions.recordRequestCompleted({
      request_id: requestId,
      started_at: nowIso(),
      method: request.method(),
      url: request.url(),
      resource_type: request.resourceType(),
      lifecycle: "completed",
      status: response?.status(),
      response_received_at: nowIso(),
      completed_at: nowIso(),
      response_headers: response?.headers(),
      response_body: responseBody,
      from_service_worker: response?.fromServiceWorker(),
      from_cache: response ? (await response.finished().then(() => false).catch(() => false)) : undefined
    });
  }

  private async onRequestFailed(request: Request): Promise<void> {
    const requestId = this.requests.get(request);
    if (!requestId) return;
    await this.sessions.recordRequestFailed({
      request_id: requestId,
      started_at: nowIso(),
      method: request.method(),
      url: request.url(),
      resource_type: request.resourceType(),
      lifecycle: "failed",
      completed_at: nowIso(),
      failure_text: request.failure()?.errorText
    });
  }

  private async onDownload(page: Page, download: Download): Promise<void> {
    const info = this.pages.get(page);
    if (!info || !isTargetUrl(this.config, page.url())) return;
    const downloadId = this.sessions.ids.next("download");
    await this.sessions.recordEvent({
      type: "download_started",
      at: nowIso(),
      download_id: downloadId,
      data: { tab_id: info.tabId, source_page_url: page.url(), suggested_filename: download.suggestedFilename() }
    });
    try {
      const paths = this.store.requirePaths();
      const target = path.join(paths.downloads, `${downloadId}-${download.suggestedFilename()}`);
      await download.saveAs(target);
      const stats = await fs.promises.stat(target);
      await this.sessions.recordEvent({
        type: "download_completed",
        at: nowIso(),
        download_id: downloadId,
        data: { status: "completed", actual_filename: path.basename(target), size: stats.size }
      });
    } catch (error) {
      await this.store.recordGap({ type: "download_failed", id: downloadId, reason: String(error) });
      await this.sessions.recordEvent({
        type: "download_completed",
        at: nowIso(),
        download_id: downloadId,
        data: { status: "failed", reason: String(error) }
      });
    }
  }

  private async handleInjectedEvent(page: Page | undefined, payload: Record<string, unknown>): Promise<void> {
    if (!page || !isTargetUrl(this.config, page.url())) return;
    const info = this.pages.get(page);
    if (!info) return;
    if (payload.kind === "url_change") {
      await this.sessions.recordEvent({
        type: "url_changed",
        at: nowIso(),
        tab_id: info.tabId,
        before_url: String(payload.before_url ?? ""),
        after_url: String(payload.after_url ?? page.url()),
        change_type: String(payload.change_type ?? "spa"),
        step_id: this.sessions.activeStepId()
      });
      return;
    }
    if (payload.kind === "form_state") {
      const formStateId = this.sessions.ids.next("form-state");
      const trigger = submitTriggerFromPayload(payload, this.clientInteractions);
      await this.sessions.recordEvent({
        type: "form_state_recorded",
        at: nowIso(),
        form_state_id: formStateId,
        context: String(payload.context ?? "observed"),
        state: payload.state,
        related_interaction_id: trigger?.interaction_id,
        trigger
      });
      if (payload.context === "before_submit" && trigger) {
        await this.sessions.recordEvent({
          type: "submit_window_opened",
          at: nowIso(),
          submit_window_id: this.sessions.ids.next("submit-window"),
          form_state_id: formStateId,
          interaction_id: trigger.interaction_id,
          trigger,
          closes_at: new Date(Date.now() + this.config.submitObservationMs).toISOString()
        });
      }
      return;
    }
    if (payload.kind === "interaction") {
      const interactionId = this.sessions.ids.next("interaction");
      const clientEventId = typeof payload.client_event_id === "string" ? payload.client_event_id : undefined;
      if (clientEventId) this.clientInteractions.set(clientEventId, interactionId);
      await this.sessions.recordEvent({
        type: "interaction_recorded",
        at: nowIso(),
        interaction_id: interactionId,
        interaction: {
          tab_id: info.tabId,
          step_id: this.sessions.activeStepId(),
          interaction_type: payload.interaction_type,
          control: payload.control,
          value: payload.value,
          options: payload.options,
          url: payload.url,
          title: payload.title
        }
      });
    }
  }
}

function submitTriggerFromPayload(payload: Record<string, unknown>, interactions: Map<string, string>) {
  if (payload.context !== "before_submit" || !payload.trigger || typeof payload.trigger !== "object") return undefined;
  const trigger = payload.trigger as Record<string, unknown>;
  const kind = trigger.kind;
  if (kind !== "submit_event" && kind !== "submit_control_click" && kind !== "enter_key_submit") return undefined;
  const clientEventId = typeof payload.related_client_event_id === "string" ? payload.related_client_event_id : undefined;
  return {
    kind,
    interaction_id: clientEventId ? interactions.get(clientEventId) : undefined,
    form_id: typeof trigger.form_id === "string" ? trigger.form_id : undefined,
    form_name: typeof trigger.form_name === "string" ? trigger.form_name : undefined,
    control: trigger.control
  } as const;
}

async function safeEvaluate(page: Page, source: string): Promise<unknown> {
  try {
    return await page.evaluate(source);
  } catch {
    return [];
  }
}

function redirectChainId(request: Request): string | undefined {
  let current: Request = request;
  while (current.redirectedFrom()) current = current.redirectedFrom()!;
  return current === request && !request.redirectedTo() ? undefined : `redirect-${stableUrlPart(current.url())}`;
}

function stableUrlPart(url: string): string {
  return Buffer.from(url).toString("base64url").slice(0, 16);
}
