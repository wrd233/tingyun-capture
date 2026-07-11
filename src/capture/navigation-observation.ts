import type { InteractionWindowV2, ObservationEvent } from "./interaction-window";
import { stableId } from "./interaction-window";

export interface NavigationObservation {
  schema_version: 1;
  navigation_id: string;
  interaction_window_id: string;
  source: { page_id?: string; url?: string; title?: string };
  action: { event_id: string; type: string; target_text?: string; target_href?: string };
  target: { page_id?: string; url?: string; title?: string };
  object_hint?: { display_text?: string };
  validation: { observed: true; reload_verified: boolean; new_tab_verified: boolean; cross_session_verified: boolean; unstable: boolean };
  request_refs: string[];
  correlation_candidate_refs: string[];
}

export function buildNavigationObservations(windows: InteractionWindowV2[], events: ObservationEvent[]): NavigationObservation[] {
  const byId = new Map(events.map((event) => [event.event_id, event]));
  return windows
    .filter((window) => window.navigation_refs.length > 0 || window.page_after.url !== window.page_before.url || window.page_after.page_id !== window.page_before.page_id)
    .map((window) => {
      const trigger = byId.get(window.trigger_event_id);
      const verificationEvents = window.event_refs.map((ref) => byId.get(ref)).filter(Boolean) as ObservationEvent[];
      return {
        schema_version: 1 as const,
        navigation_id: stableId("navobs", window.window_id),
        interaction_window_id: window.window_id,
        source: window.page_before,
        action: { event_id: window.trigger_event_id, type: window.trigger_kind, target_text: trigger?.target?.text, target_href: trigger?.target?.href },
        target: window.page_after,
        object_hint: trigger?.target?.text ? { display_text: trigger.target.text } : undefined,
        validation: {
          observed: true as const,
          reload_verified: verificationEvents.some((event) => event.type === "reload_verify_result" && event.status === "PASS"),
          new_tab_verified: verificationEvents.some((event) => event.type === "new_tab_verify_result" && event.status === "PASS"),
          cross_session_verified: verificationEvents.some((event) => event.type === "cross_session_verify_result" && event.status === "PASS"),
          unstable: verificationEvents.some((event) => String(event.status) === "UNSTABLE")
        },
        request_refs: [...window.request_refs],
        correlation_candidate_refs: []
      };
    })
    .sort((a, b) => a.navigation_id.localeCompare(b.navigation_id));
}
