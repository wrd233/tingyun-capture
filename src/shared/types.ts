export type SessionStatus = "IDLE" | "ACTIVE" | "FINALIZING" | "SEALED" | "INTERRUPTED";
export type AiReadyStatus = "READY" | "FAILED" | "STALE" | "NOT_GENERATED";
export type RequestLifecycle = "pending" | "completed" | "failed" | "canceled" | "incomplete";
export type BodyKind = "json" | "text" | "html" | "binary" | "not_saved";

export interface CaptureConfig {
  targetOrigin: string;
  outputDir: string;
  profileDir: string;
  port: number;
  sidecarOrigin: string;
  finalizationTimeoutMs: number;
  submitObservationMs: number;
  bodyLimitBytes: number;
  lowDiskBytes: number;
  criticalDiskBytes: number;
  extraSensitiveFields: string[];
  openSidecar: boolean;
}

export interface AnnotationState {
  sessionName: string;
  sessionSummary?: string;
  steps: Record<string, { intent?: string; result?: string }>;
  notes: Record<string, { text: string }>;
}

export interface RawManifest {
  session_id: string;
  capture_schema_version: string;
  capture_version: string;
  status: SessionStatus;
  target_origin: string;
  created_at: string;
  start_time?: string;
  end_time?: string;
  sealed_time?: string;
  interruption_reason?: string;
  ai_ready_status: AiReadyStatus;
}

export interface StepRecord {
  step_id: string;
  intent: string;
  started_at: string;
  ended_at?: string;
}

export interface TabRecord {
  tab_id: string;
  created_at: string;
  opener_tab_id?: string;
  first_target_url?: string;
  current_url?: string;
  title?: string;
  closed_at?: string;
}

export interface FrameRecord {
  frame_id: string;
  tab_id: string;
  parent_frame_id?: string;
  url?: string;
  created_at: string;
  destroyed_at?: string;
}

export interface BodyRef {
  ref?: string;
  kind: BodyKind;
  content_type?: string;
  size_bytes?: number;
  save_status: "saved" | "too_large" | "failed" | "not_available" | "metadata_only";
  reason?: string;
}

export interface RequestRecord {
  request_id: string;
  started_at: string;
  method: string;
  url: string;
  resource_type?: string;
  tab_id?: string;
  frame_id?: string;
  step_id?: string;
  lifecycle: RequestLifecycle;
  status?: number;
  response_received_at?: string;
  completed_at?: string;
  duration_ms?: number;
  failure_text?: string;
  completed_after_step?: boolean;
  headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  request_body?: BodyRef;
  response_body?: BodyRef;
  initiator?: unknown;
  timing?: unknown;
  from_cache?: boolean;
  from_service_worker?: boolean;
  redirect_chain_id?: string;
  redirected_from?: string;
  redirected_to?: string;
}

export interface IntegrityGap {
  type: string;
  id?: string;
  reason?: string;
  at: string;
}

export interface IntegritySummary {
  capture_complete: boolean;
  business_requests_total: number;
  completed: number;
  failed: number;
  canceled: number;
  incomplete: number;
  body_too_large: number;
  body_save_failed: number;
  download_failed: number;
  persistence_errors: number;
  interruption_reason?: string;
  gaps: IntegrityGap[];
}

export type RawEvent =
  | { type: "session_started"; at: string; session_id: string; name: string }
  | { type: "session_end_requested"; at: string; session_id: string }
  | { type: "session_sealed"; at: string; session_id: string }
  | { type: "session_interrupted"; at: string; session_id: string; reason: string }
  | { type: "step_started"; at: string; step: StepRecord }
  | { type: "step_ended"; at: string; step_id: string }
  | { type: "note_created"; at: string; note_id: string; text: string; step_id?: string; tab_id?: string; url?: string; title?: string }
  | { type: "tab_created"; at: string; tab: TabRecord }
  | { type: "tab_activated"; at: string; tab_id: string; url?: string; title?: string }
  | { type: "tab_closed"; at: string; tab_id: string }
  | { type: "frame_created"; at: string; frame: FrameRecord }
  | { type: "frame_destroyed"; at: string; frame_id: string; tab_id: string }
  | { type: "url_changed"; at: string; tab_id?: string; frame_id?: string; before_url?: string; after_url: string; change_type: string; step_id?: string }
  | { type: "interaction_recorded"; at: string; interaction_id: string; interaction: Record<string, unknown> }
  | { type: "form_state_recorded"; at: string; form_state_id: string; context: string; state: unknown; related_interaction_id?: string }
  | { type: "submit_window_opened"; at: string; submit_window_id: string; form_state_id?: string; interaction_id?: string; closes_at: string }
  | { type: "request_started"; at: string; request: RequestRecord }
  | { type: "response_received"; at: string; request_id: string; status: number; headers: Record<string, string>; body?: BodyRef }
  | { type: "request_completed"; at: string; request: RequestRecord }
  | { type: "request_failed"; at: string; request: RequestRecord }
  | { type: "download_started"; at: string; download_id: string; data: Record<string, unknown> }
  | { type: "download_completed"; at: string; download_id: string; data: Record<string, unknown> }
  | { type: "websocket_opened"; at: string; websocket_id: string; tab_id?: string; url: string; step_id?: string }
  | { type: "websocket_message"; at: string; websocket_id: string; direction: "incoming" | "outgoing"; opcode?: number; text?: string; binary_ref?: string }
  | { type: "websocket_closed"; at: string; websocket_id: string }
  | { type: "integrity_gap"; at: string; gap: IntegrityGap };
