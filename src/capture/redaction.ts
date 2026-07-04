const DEFAULT_SECRET_FIELDS = new Set([
  "password",
  "passwd",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "client_secret"
]);

const SECRET_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);

export interface RedactionOptions {
  extraSensitiveFields?: string[];
}

export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, SECRET_HEADERS.has(key.toLowerCase()) ? "***REDACTED***" : value])
  );
}

export function redactUrl(rawUrl: string, options: RedactionOptions = {}): string {
  const url = new URL(rawUrl);
  const secrets = secretFields(options);
  for (const key of [...url.searchParams.keys()]) {
    if (secrets.has(key.toLowerCase())) url.searchParams.set(key, "***REDACTED***");
  }
  return url.toString();
}

export function redactStructuredBody(value: unknown, options: RedactionOptions = {}): unknown {
  const secrets = secretFields(options);
  if (Array.isArray(value)) return value.map((item) => redactStructuredBody(item, options));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        secrets.has(key.toLowerCase()) ? "***REDACTED***" : redactStructuredBody(child, options)
      ])
    );
  }
  return value;
}

export function redactFormText(text: string, options: RedactionOptions = {}): string {
  const params = new URLSearchParams(text);
  if ([...params.keys()].length === 0) return text;
  const secrets = secretFields(options);
  for (const key of [...params.keys()]) {
    if (secrets.has(key.toLowerCase())) params.set(key, "***REDACTED***");
  }
  return params.toString();
}

function secretFields(options: RedactionOptions): Set<string> {
  return new Set([...DEFAULT_SECRET_FIELDS, ...(options.extraSensitiveFields ?? []).map((field) => field.toLowerCase())]);
}
