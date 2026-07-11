import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import yauzl from "yauzl";

export type SecurityStatus = "PASS" | "BLOCKED";
export interface SecurityFinding { kind: string; file: string; detail: string }
export interface SecurityReport { status: SecurityStatus; scanned_files: number; findings: SecurityFinding[] }

const FORBIDDEN_NAMES = new Set([".env", "env.sh", ".bash_history", ".zsh_history", "private-mapping.json"]);
const SECRET_KEY = /(?:authorization|proxy-authorization|cookie|set-cookie|access_token|refresh_token|api_key|apikey|client_secret|password|passwd)/i;

export class StableTokenizer {
  private counters = new Map<string, number>();
  private values = new Map<string, string>();

  tokenize(kind: string, value: string): string {
    const normalizedKind = kebab(kind);
    const key = `${normalizedKind}\0${value}`;
    const existing = this.values.get(key);
    if (existing) return existing;
    const next = (this.counters.get(normalizedKind) ?? 0) + 1;
    this.counters.set(normalizedKind, next);
    const token = `${normalizedKind}-${String(next).padStart(3, "0")}`;
    this.values.set(key, token);
    return token;
  }

  publicReport(): { token_counts: Record<string, number> } {
    return { token_counts: Object.fromEntries([...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b))) };
  }
}

export async function scanDirectory(root: string): Promise<SecurityReport> {
  const files = await listFiles(root);
  const findings: SecurityFinding[] = [];
  for (const entry of await listEntryNames(root)) findings.push(...scanName(entry));
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    findings.push(...scanName(relative));
    const stat = await fs.promises.stat(file);
    if (stat.size > 10 * 1024 * 1024) continue;
    const content = await fs.promises.readFile(file);
    if (!content.includes(0)) findings.push(...scanText(content.toString("utf8"), relative));
  }
  return report(files.length, findings);
}

export async function scanZip(zipPath: string): Promise<SecurityReport> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("Cannot open ZIP"));
      const findings: SecurityFinding[] = [];
      let scanned = 0;
      zip.readEntry();
      zip.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) return zip.readEntry();
        scanned += 1;
        findings.push(...scanName(entry.fileName));
        if (entry.uncompressedSize > 10 * 1024 * 1024) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error("Cannot read ZIP entry"));
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          stream.on("error", reject);
          stream.on("end", () => {
            const content = Buffer.concat(chunks);
            if (!content.includes(0)) findings.push(...scanText(content.toString("utf8"), entry.fileName));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(report(scanned, findings)));
      zip.on("error", reject);
    });
  });
}

export function scanText(text: string, file = "inline"): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  if (/['"]?(?:Authorization|Proxy-Authorization)['"]?\s*[:=]/i.test(text)) findings.push({ kind: "authorization", file, detail: "authorization field present" });
  if (/['"]?(?:Cookie|Set-Cookie)['"]?\s*[:=]/i.test(text)) findings.push({ kind: "cookie", file, detail: "cookie field present" });
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]{3,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{3,}/i.test(text)) findings.push({ kind: "bearer_or_jwt", file, detail: "Bearer or JWT-like value present" });
  if (/["']?(?:access_token|refresh_token|api_key|apikey|client_secret|password|passwd)["']?\s*[:=]/i.test(text)) findings.push({ kind: "secret_field", file, detail: "secret field present" });
  if (/(?:^|["'\s])\/Users\/[A-Za-z0-9._-]+\//m.test(text)) findings.push({ kind: "absolute_home_path", file, detail: "macOS home path present" });
  return dedupe(findings);
}

export function sanitizeShareable(value: unknown, tokenizer: StableTokenizer, key = "root"): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeShareable(item, tokenizer, key));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const childKey of Object.keys(value as object).sort()) {
      if (SECRET_KEY.test(childKey)) throw new Error(`BLOCKED: high-risk field ${childKey}`);
      output[childKey] = sanitizeShareable((value as Record<string, unknown>)[childKey], tokenizer, childKey);
    }
    return output;
  }
  if (typeof value !== "string") return value;
  if (/(?:traceguid|actionguid|traceid|actionid|applicationid|instanceid|userid|agreementid|contractid)$/i.test(key)) return tokenizer.tokenize(key, value);
  let text = value.replace(/(?<![\d.])(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}(?![\d.])/g, (match) => tokenizer.tokenize("ip", match));
  text = text.replace(/([?&](?:traceGuid|actionGuid|traceId|actionId|applicationId|instanceId|userId|agreementId|contractId)=)([^&#\s"']+)/gi, (_match, prefix: string, raw: string) => `${prefix}${tokenizer.tokenize(prefix.replace(/^[?&]|=$/g, ""), decodeURIComponent(raw))}`);
  text = text.replace(/https?:\/\/[A-Za-z0-9._:-]+/g, (origin) => {
    try {
      const host = new URL(origin).hostname;
      return /^(?:127\.0\.0\.1|localhost)$/.test(host) ? origin : `https://${tokenizer.tokenize("origin", origin)}`;
    } catch {
      return origin;
    }
  });
  text = text.replace(/\/Users\/[A-Za-z0-9._-]+\/[A-Za-z0-9_./-]*/g, "<local-path>");
  return text;
}

export function hasHighRiskSecrets(value: unknown): boolean {
  return scanText(typeof value === "string" ? value : JSON.stringify(value)).some((finding) => ["authorization", "cookie", "bearer_or_jwt", "secret_field"].includes(finding.kind));
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`BLOCKED: symbolic link in package: ${full}`);
      if (entry.isDirectory()) await visit(full);
      if (entry.isFile()) output.push(full);
    }
  }
  await visit(root);
  return output.sort();
}

async function listEntryNames(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      output.push(path.relative(root, full).split(path.sep).join("/"));
      if (entry.isDirectory()) await visit(full);
    }
  }
  await visit(root);
  return output.sort();
}

function scanName(file: string): SecurityFinding[] {
  const parts = file.toLowerCase().split("/");
  const findings: SecurityFinding[] = [];
  if (parts.some((part) => FORBIDDEN_NAMES.has(part))) findings.push({ kind: "forbidden_file", file, detail: "forbidden file name" });
  if (parts.some((part) => part.includes("browser-profile") || part === "default") && parts.some((part) => part.includes("profile") || part === "default")) findings.push({ kind: "browser_profile", file, detail: "browser profile marker" });
  return findings;
}

function report(scanned_files: number, findings: SecurityFinding[]): SecurityReport {
  const sorted = dedupe(findings).sort((a, b) => `${a.file}|${a.kind}`.localeCompare(`${b.file}|${b.kind}`));
  return { status: sorted.length === 0 ? "PASS" : "BLOCKED", scanned_files, findings: sorted };
}

function dedupe(findings: SecurityFinding[]): SecurityFinding[] {
  return [...new Map(findings.map((finding) => [`${finding.kind}|${finding.file}|${finding.detail}`, finding])).values()];
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}
