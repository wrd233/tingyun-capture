import { createHash } from "node:crypto";

export interface ObservationEvent {
  type: string;
  at: string;
  event_id?: string;
  page_id?: string;
  opener_page_id?: string;
  url?: string;
  title?: string;
  before_url?: string;
  after_url?: string;
  interaction_type?: string;
  target?: { text?: string; href?: string };
  [key: string]: unknown;
}

export interface InteractionWindowV2 {
  schema_version: 1;
  window_id: string;
  start_time: string;
  end_time: string;
  trigger_event_id: string;
  trigger_kind: string;
  source_page_id?: string;
  page_before: { page_id?: string; url?: string; title?: string };
  page_after: { page_id?: string; url?: string; title?: string };
  event_refs: string[];
  request_refs: string[];
  response_refs: string[];
  navigation_refs: string[];
  download_refs: string[];
  annotation_refs: string[];
  association_basis: "same_page_or_opener" | "temporal_proximity";
}

const TRIGGERS = new Set(["interaction_recorded", "submit", "select", "navigation_explicit", "annotation_mark", "annotation_finish", "url_verify"]);

export function buildInteractionWindows(events: ObservationEvent[], maxMs = 5_000): InteractionWindowV2[] {
  const ordered = [...events].sort(compareEvent);
  const triggers = ordered.filter((event) => TRIGGERS.has(event.type));
  return triggers.map((trigger, index) => {
    const start = Date.parse(trigger.at);
    const nextSamePage = triggers.slice(index + 1).find((event) => !trigger.page_id || event.page_id === trigger.page_id);
    const end = Math.min(start + maxMs, nextSamePage ? Date.parse(nextSamePage.at) : start + maxMs);
    const openerPages = new Set(
      ordered.filter((event) => event.type === "page_created" && event.opener_page_id === trigger.page_id && inRange(event.at, start, end)).map((event) => event.page_id).filter(Boolean)
    );
    let basis: InteractionWindowV2["association_basis"] = "same_page_or_opener";
    const associated = ordered.filter((event) => {
      if (!inRange(event.at, start, end)) return false;
      if (!trigger.page_id || !event.page_id || event.page_id === trigger.page_id || openerPages.has(event.page_id)) return true;
      return false;
    });
    if (openerPages.size === 0 && associated.every((event) => !event.page_id || event.page_id !== trigger.page_id)) basis = "temporal_proximity";
    const after = [...associated].reverse().find((event) => event.type === "navigation" || event.type === "page_created");
    return {
      schema_version: 1,
      window_id: stableId("iw", `${trigger.event_id ?? trigger.at}|${trigger.page_id ?? ""}`),
      start_time: trigger.at,
      end_time: new Date(end).toISOString(),
      trigger_event_id: trigger.event_id ?? stableId("event", JSON.stringify(trigger)),
      trigger_kind: trigger.interaction_type ?? trigger.type,
      source_page_id: trigger.page_id,
      page_before: { page_id: trigger.page_id, url: trigger.url ?? trigger.before_url, title: trigger.title },
      page_after: { page_id: after?.page_id ?? trigger.page_id, url: after?.after_url ?? after?.url ?? trigger.url, title: after?.title ?? trigger.title },
      event_refs: refs(associated, () => true),
      request_refs: refs(associated, (event) => event.type === "request" || event.type === "request_started"),
      response_refs: refs(associated, (event) => event.type === "response" || event.type === "response_received"),
      navigation_refs: refs(associated, (event) => event.type === "navigation" || event.type === "url_changed"),
      download_refs: refs(associated, (event) => event.type.startsWith("download")),
      annotation_refs: refs(associated, (event) => event.type.startsWith("annotation")),
      association_basis: basis
    };
  });
}

function refs(events: ObservationEvent[], predicate: (event: ObservationEvent) => boolean): string[] {
  return events.filter(predicate).map((event) => event.event_id).filter((value): value is string => Boolean(value)).sort();
}

function compareEvent(a: ObservationEvent, b: ObservationEvent): number {
  return a.at.localeCompare(b.at) || String(a.event_id ?? "").localeCompare(String(b.event_id ?? ""));
}

function inRange(at: string, start: number, end: number): boolean {
  const value = Date.parse(at);
  return value >= start && value <= end;
}

export function stableId(prefix: string, source: string): string {
  return `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;
}
