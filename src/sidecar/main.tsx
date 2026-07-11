import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type CaptureState = {
  status: string;
  manifest?: { session_id: string; start_time?: string; status: string; ai_ready_status: string; interruption_reason?: string };
  currentStep?: { step_id: string; intent: string; started_at: string };
  counters: { dynamicRequests: number; failedRequests: number; newTabs: number; urlChanges: number };
  recentEvents: Array<Record<string, unknown>>;
  recentSessions: Array<Record<string, unknown>>;
  currentTask?: { task_id: string; title: string; goal: string };
  currentPage?: { tab_id?: string; url?: string; title?: string };
  captureHealth?: { ok: boolean };
};

type Review = {
  manifest: Record<string, unknown>;
  annotations: { sessionName: string; sessionSummary?: string; steps: Record<string, unknown>; notes: Record<string, unknown> };
  events: Array<Record<string, unknown>>;
  requests: Array<Record<string, unknown>>;
  integrity?: Record<string, unknown>;
  bodies: Record<string, string>;
  interactionWindows?: Array<Record<string, unknown>>;
  navigationObservations?: Array<Record<string, unknown>>;
  correlationCandidates?: Array<Record<string, unknown>>;
  downloadIndex?: Array<Record<string, unknown>>;
  endpointObservations?: Array<Record<string, unknown>>;
};

function App() {
  const [state, setState] = React.useState<CaptureState>();
  const [reviewId, setReviewId] = React.useState<string>();
  const [review, setReview] = React.useState<Review>();
  const [error, setError] = React.useState<string>();
  const [sessionName, setSessionName] = React.useState("");
  const [stepIntent, setStepIntent] = React.useState("");
  const [note, setNote] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [failedOnly, setFailedOnly] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const next = await api<CaptureState>("/api/state");
    setState(next);
  }, []);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  React.useEffect(() => {
    if (!reviewId) return;
    void api<Review>(`/api/session/${reviewId}/review`).then(setReview).catch((err) => setError(String(err)));
  }, [reviewId]);

  const status = state?.status ?? "IDLE";
  const active = status === "ACTIVE";
  const filteredRequests = (review?.requests ?? []).filter((request) => {
    const text = `${request.method} ${request.url} ${request.status ?? ""}`.toLowerCase();
    return (!failedOnly || request.lifecycle === "failed") && text.includes(query.toLowerCase());
  });

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>tingyun-capture</h1>
          <p>RAW / PRIVATE / LOCAL</p>
        </div>
        <span className={`status ${status.toLowerCase()}`}>{status}</span>
      </header>

      {error && <div className="alert" role="alert">{error}</div>}

      <section className="band">
        <div className="current">
          <div className="contextGrid" aria-label="Research context">
            <div><span>Current Task</span><strong>{state?.currentTask?.title ?? "—"}</strong><code>{state?.currentTask?.task_id ?? ""}</code></div>
            <div><span>Current Page</span><strong>{state?.currentPage?.title ?? "—"}</strong><code>{state?.currentPage?.url ?? ""}</code></div>
            <div><span>Current Window</span><strong>{state?.recentEvents?.find((event) => event.type === "interaction_recorded") ? "Observed" : "—"}</strong></div>
            <div><span>Capture Health</span><strong>{state?.captureHealth?.ok ? "Healthy" : "Check"}</strong></div>
          </div>
          <h2>当前 Session</h2>
          {active ? (
            <>
              <p className="primary">{state?.manifest?.session_id}</p>
              <div className="metrics">
                <Metric label="业务请求" value={state?.counters.dynamicRequests ?? 0} />
                <Metric label="失败请求" value={state?.counters.failedRequests ?? 0} />
                <Metric label="新 Tab" value={state?.counters.newTabs ?? 0} />
                <Metric label="URL 变化" value={state?.counters.urlChanges ?? 0} />
              </div>
              <div className="controls">
                {state?.currentStep ? (
                  <button onClick={() => action("/api/step/end", {}, refresh, setError)}>结束 Step</button>
                ) : (
                  <>
                    <input value={stepIntent} onChange={(e) => setStepIntent(e.target.value)} placeholder="操作意图" />
                    <button onClick={() => action("/api/step/start", { intent: stepIntent }, refresh, setError).then(() => setStepIntent(""))}>开始 Step</button>
                  </>
                )}
              </div>
              <div className="controls">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="记一下……" />
                <button onClick={() => action("/api/annotation", { kind: "MARK", content: note || "Mark" }, refresh, setError)}>Mark</button>
                <button onClick={() => action("/api/annotation", { kind: "NOTE", content: note }, refresh, setError).then(() => setNote(""))}>Note</button>
                <button onClick={() => action("/api/annotation", { kind: "FINISH", content: note || "Finish" }, refresh, setError)}>Finish</button>
              </div>
              <div className="controls">
                <button onClick={() => action("/api/navigation/record-current-url", {}, refresh, setError)}>Record Current URL</button>
                <button onClick={() => action("/api/navigation/reload-verify", {}, refresh, setError)}>Reload Verify</button>
                <button onClick={() => action("/api/navigation/new-tab-verify", {}, refresh, setError)}>New Tab Verify</button>
                <button onClick={() => action("/api/validate", {}, refresh, setError)}>Validate</button>
                <button onClick={() => action("/api/export/private", {}, refresh, setError)}>Export Private</button>
                <button onClick={() => action("/api/export/shareable", {}, refresh, setError)}>Export Shareable</button>
              </div>
              <div className="controls">
                <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="本次探索总结（可选）" />
                <button className="danger" onClick={() => action("/api/session/end", { summary }, refresh, setError)}>结束 Session</button>
              </div>
            </>
          ) : (
            <div className="controls">
              <input value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="Session 名称" />
              <button onClick={() => action("/api/session/start", { name: sessionName }, refresh, setError).then(() => setSessionName(""))}>开始 Session</button>
            </div>
          )}
          {status === "INTERRUPTED" && state?.manifest && (
            <div className="interrupted">
              <p>中断原因：{state.manifest.interruption_reason}</p>
              <button onClick={() => action(`/api/session/${state.manifest!.session_id}/seal-interrupted`, {}, refresh, setError)}>审阅后封存</button>
            </div>
          )}
        </div>
        <div className="recent">
          <h2>最近事件</h2>
          <ul>
            {(state?.recentEvents ?? []).slice(0, 8).map((event, index) => (
              <li key={index}><code>{String(event.type)}</code><span>{String(event.at ?? "")}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="band">
        <h2>最近 Session</h2>
        <div className="sessionList">
          {(state?.recentSessions ?? []).map((session) => (
            <button key={String(session.session_id)} className="sessionRow" onClick={() => setReviewId(String(session.session_id))}>
              <span>{String(session.name ?? session.session_id)}</span>
              <span>{String(session.status)}</span>
              <span>Steps {String(session.step_count ?? 0)}</span>
              <span>AI {String(session.ai_ready_status)}</span>
            </button>
          ))}
        </div>
      </section>

      {review && (
        <section className="review">
          <div className="reviewHead">
            <div>
              <h2>{review.annotations.sessionName}</h2>
              <p>RAW / PRIVATE / LOCAL · {String(review.manifest.session_id)}</p>
            </div>
            <div className="controls compact">
              <button onClick={() => action(`/api/session/${reviewId}/ai-ready/regenerate`, {}, refresh, setError)}>重新生成 AI-ready</button>
              <button onClick={() => action(`/api/session/${reviewId}/ai-ready/zip`, {}, refresh, setError)}>打包 ZIP</button>
              {["SEALED", "INTERRUPTED"].includes(String(review.manifest.status)) && (
                <button className="danger" onClick={() => removeSession(String(reviewId), refresh, setReviewId, setReview, setError)}>删除 Session</button>
              )}
            </div>
          </div>
          <div className="columns">
            <div>
              <h3>Step / 备注 / 页面变化</h3>
              <ul className="timeline">
                {review.events.filter((event) => ["step_started", "step_ended", "note_created", "url_changed", "interaction_recorded", "form_state_recorded"].includes(String(event.type))).map((event, index) => (
                  <li key={index}><code>{String(event.type)}</code><pre>{JSON.stringify(event, null, 2)}</pre></li>
                ))}
              </ul>
            </div>
            <div>
              <div className="filter">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索 URL / Path" />
                <label><input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> 失败</label>
              </div>
              <h3>Request / Response</h3>
              <ul className="requests">
                {filteredRequests.map((request) => (
                  <li key={String(request.request_id)}>
                    <details>
                      <summary><code>{String(request.method)}</code> {String(request.status ?? request.lifecycle)} {String(request.url)}</summary>
                      <button onClick={() => copyCurl(String(reviewId), String(request.request_id), false)}>复制参考 cURL</button>
                      <button className="danger" onClick={() => copyCurl(String(reviewId), String(request.request_id), true)}>复制原始 cURL</button>
                      <pre>{JSON.stringify(request, null, 2)}</pre>
                      {bodyBlock("Request Body", request.request_body as Record<string, unknown>, review.bodies)}
                      {bodyBlock("Response Body", request.response_body as Record<string, unknown>, review.bodies)}
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="researchReview">
            <ResearchList title="Interaction Windows" items={review.interactionWindows} />
            <ResearchList title="Navigation Observations" items={review.navigationObservations} />
            <ResearchList title="Correlation Candidates" items={review.correlationCandidates} />
            <ResearchList title="Endpoint Observations" items={review.endpointObservations} />
            <ResearchList title="Downloads" items={review.downloadIndex} />
            <section><h3>Security Status</h3><p>Shareable export requires a PASS result before ZIP publication.</p></section>
          </div>
        </section>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function ResearchList({ title, items = [] }: { title: string; items?: Array<Record<string, unknown>> }) {
  return <section><h3>{title}</h3>{items.length === 0 ? <p>No observations generated.</p> : <ul className="timeline">{items.map((item, index) => <li key={index}><pre>{JSON.stringify(item, null, 2)}</pre></li>)}</ul>}</section>;
}

function bodyBlock(title: string, ref: Record<string, unknown> | undefined, bodies: Record<string, string>) {
  if (!ref?.ref) return null;
  return <section className="body"><h4>{title}</h4><pre>{bodies[String(ref.ref)] ?? JSON.stringify(ref, null, 2)}</pre></section>;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error((await response.json()).error ?? response.statusText);
  return response.json() as Promise<T>;
}

async function action(url: string, body: unknown, refresh: () => Promise<void>, setError: (message: string | undefined) => void): Promise<void> {
  setError(undefined);
  await api(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await refresh();
}

async function copyCurl(sessionId: string, requestId: string, raw: boolean): Promise<void> {
  const response = await fetch(`/api/session/${sessionId}/request/${requestId}/curl${raw ? "?raw=1" : ""}`);
  await navigator.clipboard.writeText(await response.text());
}

async function removeSession(
  sessionId: string,
  refresh: () => Promise<void>,
  setReviewId: (id: string | undefined) => void,
  setReview: (review: Review | undefined) => void,
  setError: (message: string | undefined) => void
): Promise<void> {
  setError(undefined);
  const response = await fetch(`/api/session/${sessionId}`, { method: "DELETE" });
  if (!response.ok) {
    setError((await response.json()).error ?? response.statusText);
    return;
  }
  setReviewId(undefined);
  setReview(undefined);
  await refresh();
}

createRoot(document.getElementById("root")!).render(<App />);
