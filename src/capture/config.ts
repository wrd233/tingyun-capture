import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { CaptureConfig } from "../shared/types";

const DEFAULT_PORT = 43127;
const DEFAULT_BODY_LIMIT = 10 * 1024 * 1024;

const fileConfigSchema = z
  .object({
    target_origin: z.string().url().optional(),
    output_dir: z.string().optional(),
    profile_dir: z.string().optional(),
    port: z.number().int().positive().optional(),
    body_limit_bytes: z.number().int().positive().optional(),
    finalization_timeout_ms: z.number().int().positive().optional(),
    submit_observation_ms: z.number().int().positive().optional(),
    low_disk_bytes: z.number().int().positive().optional(),
    critical_disk_bytes: z.number().int().positive().optional(),
    extra_sensitive_fields: z.array(z.string()).optional()
  })
  .passthrough();

export function buildConfig(input: {
  targetOrigin: string;
  outputDir?: string;
  profileDir?: string;
  port?: number;
  bodyLimitBytes?: number;
  openSidecar?: boolean;
  fileConfig?: unknown;
}): CaptureConfig {
  const parsed = fileConfigSchema.parse(input.fileConfig ?? {});
  const outputDir = path.resolve(input.outputDir ?? parsed.output_dir ?? "capture-data");
  const port = input.port ?? parsed.port ?? DEFAULT_PORT;
  const targetOrigin = normalizeOrigin(input.targetOrigin || parsed.target_origin || "");
  if (!targetOrigin) {
    throw new Error("target_origin is required. Pass --target-origin <scheme://host:port>.");
  }
  return {
    targetOrigin,
    outputDir,
    profileDir: path.resolve(input.profileDir ?? parsed.profile_dir ?? path.join(os.homedir(), ".tingyun-capture", "browser-profile")),
    port,
    sidecarOrigin: `http://127.0.0.1:${port}`,
    finalizationTimeoutMs: parsed.finalization_timeout_ms ?? 10_000,
    submitObservationMs: parsed.submit_observation_ms ?? 5_000,
    bodyLimitBytes: input.bodyLimitBytes ?? parsed.body_limit_bytes ?? DEFAULT_BODY_LIMIT,
    lowDiskBytes: parsed.low_disk_bytes ?? 5 * 1024 * 1024 * 1024,
    criticalDiskBytes: parsed.critical_disk_bytes ?? 1024 * 1024 * 1024,
    extraSensitiveFields: parsed.extra_sensitive_fields ?? [],
    openSidecar: input.openSidecar ?? true
  };
}

export function normalizeOrigin(value: string): string {
  if (!value) return "";
  const url = new URL(value);
  return url.origin;
}

export function isTargetUrl(config: Pick<CaptureConfig, "targetOrigin" | "sidecarOrigin">, rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.origin === config.targetOrigin && url.origin !== config.sidecarOrigin;
  } catch {
    return false;
  }
}
