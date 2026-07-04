import { expect, test } from "vitest";
import { buildCurl } from "../../src/capture/curl";
import { redactHeaders, redactStructuredBody, redactUrl } from "../../src/capture/redaction";

test("redaction keeps business IDs but removes high-confidence secrets", () => {
  expect(redactUrl("http://x.test/path?applicationId=2033&access_token=secret&name=oa")).toBe(
    "http://x.test/path?applicationId=2033&access_token=***REDACTED***&name=oa"
  );
  expect(redactHeaders({ Authorization: "Bearer abc", "X-Business": "traceGuid" })).toEqual({
    Authorization: "***REDACTED***",
    "X-Business": "traceGuid"
  });
  expect(redactStructuredBody({ password: "secret", applicationId: 2033, nested: { api_key: "k" } })).toEqual({
    password: "***REDACTED***",
    applicationId: 2033,
    nested: { api_key: "***REDACTED***" }
  });
});

test("reference curl is redacted by default", () => {
  const curl = buildCurl({
    request_id: "request-0001",
    started_at: new Date().toISOString(),
    method: "POST",
    url: "http://x.test/save?access_token=secret&traceGuid=t",
    lifecycle: "completed",
    headers: { Cookie: "sid=secret", "content-type": "application/json" }
  });
  expect(curl).toContain("access_token=***REDACTED***");
  expect(curl).toContain("Cookie: ***REDACTED***");
  expect(curl).toContain("traceGuid=t");
});
