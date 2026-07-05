import type { RequestRecord } from "../shared/types";

export const AI_READY_EVIDENCE_POLICY_VERSION = "ai-ready-evidence.v2";
export const AI_READY_INTERACTION_WINDOW_MAX_MS = 5_000;
export const AI_READY_LEGACY_NEW_TAB_PROXIMITY_MS = 1_000;

const PRIMARY_RESOURCE_TYPES = new Set(["xhr", "fetch", "document"]);
const STATIC_RESOURCE_TYPES = new Set(["script", "stylesheet", "image", "font", "media", "manifest", "other"]);

export function isAiReadyPrimaryEvidenceRequest(request: Pick<RequestRecord, "resource_type">): boolean {
  return PRIMARY_RESOURCE_TYPES.has((request.resource_type ?? "").toLowerCase());
}

export function aiReadyOmissionReason(request: Pick<RequestRecord, "resource_type">): string | undefined {
  const resourceType = (request.resource_type ?? "unknown").toLowerCase();
  if (PRIMARY_RESOURCE_TYPES.has(resourceType)) return undefined;
  if (STATIC_RESOURCE_TYPES.has(resourceType)) return "static_resource_body_kept_in_raw_only";
  return "non_primary_resource_body_kept_in_raw_only";
}

export function aiReadyPrimaryResourceTypes(): string[] {
  return [...PRIMARY_RESOURCE_TYPES].sort();
}

export function aiReadyStaticResourceTypes(): string[] {
  return [...STATIC_RESOURCE_TYPES].sort();
}
