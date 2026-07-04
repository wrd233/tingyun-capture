import type { RequestRecord } from "../shared/types";
import { redactHeaders, redactUrl } from "./redaction";

export function buildCurl(record: RequestRecord, options: { redacted: boolean; body?: string } = { redacted: true }): string {
  const headers = options.redacted ? redactHeaders(record.headers) : record.headers;
  const url = options.redacted ? redactUrl(record.url) : record.url;
  const parts = ["curl", "-X", shellQuote(record.method), shellQuote(url)];
  for (const [key, value] of Object.entries(headers ?? {})) {
    parts.push("-H", shellQuote(`${key}: ${value}`));
  }
  if (options.body) parts.push("--data-raw", shellQuote(options.body));
  return parts.join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
