import fs from "node:fs";
import { execFile } from "node:child_process";
import { Command } from "commander";
import { buildConfig } from "./capture/config";
import { RawStore, readJson } from "./capture/raw-store";
import { AiReadyGenerator } from "./capture/ai-ready";
import { SessionManager } from "./capture/session-manager";
import { BrowserController } from "./capture/browser-controller";
import { createApi, listenLocalhost } from "./server/api";

const program = new Command();

program
  .command("start")
  .requiredOption("--target-origin <origin>", "target Origin to capture, e.g. http://127.0.0.1:5174")
  .option("--output-dir <dir>", "Raw/derived output directory")
  .option("--profile-dir <dir>", "persistent Chromium profile directory")
  .option("--port <port>", "Sidecar/API port", (value) => Number(value))
  .option("--body-limit-bytes <bytes>", "single body hard limit", (value) => Number(value))
  .option("--config <file>", "optional YAML/JSON-like config file; JSON is supported in v1")
  .option("--no-open-sidecar", "do not open Sidecar URL in default browser")
  .action(async (options) => {
    const fileConfig = options.config ? await loadConfigFile(options.config) : undefined;
    const config = buildConfig({
      targetOrigin: options.targetOrigin,
      outputDir: options.outputDir,
      profileDir: options.profileDir,
      port: options.port,
      bodyLimitBytes: options.bodyLimitBytes,
      openSidecar: options.openSidecar,
      fileConfig
    });
    const store = new RawStore(config);
    const aiReady = new AiReadyGenerator(config, store);
    const sessions = new SessionManager(config, store, aiReady);
    const browser = new BrowserController(config, store, sessions);
    await sessions.initialize();
    await browser.start();
    const app = createApi({ config, store, sessions, browser, aiReady });
    const server = await listenLocalhost(app, config.port);
    const url = `http://127.0.0.1:${config.port}`;
    console.log(`tingyun-capture listening on ${url}`);
    console.log(`target_origin=${config.targetOrigin}`);
    if (config.openSidecar) openUrl(url);
    const shutdown = async () => {
      await sessions.interrupt("engine_stopped").catch(() => undefined);
      await browser.stop().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function openUrl(url: string): void {
  if (process.platform === "darwin") execFile("open", [url]);
}

async function loadConfigFile(filePath: string): Promise<unknown> {
  try {
    return await readJson(filePath);
  } catch {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  }
}
