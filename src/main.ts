import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { Command } from "commander";
import { buildConfig } from "./capture/config";
import { RawStore, readJson } from "./capture/raw-store";
import { AiReadyGenerator } from "./capture/ai-ready";
import { SessionManager } from "./capture/session-manager";
import { BrowserController } from "./capture/browser-controller";
import { createApi, listenLocalhost } from "./server/api";
import { TaskManager } from "./capture/task-manager";
import { ResearchPackageBuilder } from "./capture/research-package";
import { validateTask } from "./capture/validator";
import { newSessionId } from "./shared/ids";

const program = new Command().name("tingyun-capture");

ensureDefaultCommand();

program
  .command("start")
  .requiredOption("--target-origin <origin>", "target Origin to capture, e.g. http://127.0.0.1:5174")
  .option("--output-dir <dir>", "Raw/derived output directory")
  .option("--data-root <dir>", "Task data root", "capture-data")
  .option("--task-id <id>", "Research Task id")
  .option("--session-id <id>", "requested Session id for the next Sidecar start")
  .option("--profile-dir <dir>", "persistent Chromium profile directory")
  .option("--port <port>", "Sidecar/API port", (value) => Number(value))
  .option("--body-limit-bytes <bytes>", "single body hard limit", (value) => Number(value))
  .option("--config <file>", "optional YAML/JSON-like config file; JSON is supported in v1")
  .option("--no-open-sidecar", "do not open Sidecar URL in default browser")
  .action(async (options) => {
    const fileConfig = options.config ? await loadConfigFile(options.config) : undefined;
    const dataRoot = pathResolve(options.dataRoot ?? options.outputDir ?? "capture-data");
    const tasks = new TaskManager(dataRoot);
    let taskId = options.taskId as string | undefined;
    if (taskId) {
      await tasks.readTask(taskId);
    } else {
      const adhoc = await tasks.createAdHocTask("Ad-hoc Capture");
      taskId = adhoc.task_id;
    }
    await tasks.interruptStaleSessions(taskId);
    const sessionOutput = tasks.taskPaths(taskId).sessions;
    const config = buildConfig({
      targetOrigin: options.targetOrigin,
      outputDir: sessionOutput,
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
    const app = createApi({ config, store, sessions, browser, aiReady, tasks, taskId, defaultSessionId: options.sessionId });
    const server = await listenLocalhost(app, config.port);
    const url = `http://127.0.0.1:${config.port}`;
    console.log(`tingyun-capture listening on ${url}`);
    console.log(`target_origin=${config.targetOrigin}`);
    console.log(`task_id=${taskId}`);
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

const task = program.command("task").description("manage Research Tasks");
task.command("init")
  .option("--task-id <id>")
  .option("--title <title>")
  .option("--goal <goal>")
  .option("--success-criterion <text>", "repeatable success criterion", collect, [])
  .option("--do-not-assume <text>", "repeatable prohibited assumption", collect, [])
  .option("--from <file>", "import task JSON")
  .option("--data-root <dir>", "Task data root", "capture-data")
  .action(async (options) => {
    const tasks = new TaskManager(pathResolve(options.dataRoot));
    const created = options.from
      ? await tasks.importTask(pathResolve(options.from))
      : await tasks.createTask({
          task_id: required(options.taskId, "--task-id"),
          title: required(options.title, "--title"),
          goal: required(options.goal, "--goal"),
          success_criteria: options.successCriterion,
          do_not_assume: options.doNotAssume,
          created_at: new Date().toISOString()
        });
    console.log(JSON.stringify(created, null, 2));
  });

const session = program.command("session").description("manage Task Sessions");
session.command("start")
  .requiredOption("--task-id <id>")
  .option("--session-id <id>")
  .option("--data-root <dir>", "Task data root", "capture-data")
  .action(async (options) => {
    const tasks = new TaskManager(pathResolve(options.dataRoot));
    await tasks.interruptStaleSessions(options.taskId);
    const created = await tasks.createSession(options.taskId, { session_id: options.sessionId ?? newSessionId() });
    console.log(JSON.stringify(created, null, 2));
  });
session.command("stop")
  .requiredOption("--task-id <id>")
  .requiredOption("--session-id <id>")
  .option("--data-root <dir>", "Task data root", "capture-data")
  .action(async (options) => console.log(JSON.stringify(await new TaskManager(pathResolve(options.dataRoot)).closeSession(options.taskId, options.sessionId), null, 2)));

program.command("validate")
  .requiredOption("--task-id <id>")
  .option("--data-root <dir>", "Task data root", "capture-data")
  .action(async (options) => {
    const report = await validateTask(pathResolve(options.dataRoot), options.taskId, new Date().toISOString());
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "FAILED") process.exitCode = 1;
  });

program.command("export")
  .requiredOption("--task-id <id>")
  .requiredOption("--type <type>", "private or shareable")
  .option("--data-root <dir>", "Task data root", "capture-data")
  .action(async (options) => {
    if (options.type !== "private" && options.type !== "shareable") throw new Error("--type must be private or shareable");
    console.log(JSON.stringify(await new ResearchPackageBuilder(pathResolve(options.dataRoot)).exportTask(options.taskId, options.type), null, 2));
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

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function required(value: unknown, flag: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${flag} is required unless --from is used`);
  return value.trim();
}

function pathResolve(value: string): string {
  return path.resolve(value);
}

function ensureDefaultCommand(): void {
  const first = process.argv[2];
  if (!first || first.startsWith("-")) process.argv.splice(2, 0, "start");
}
