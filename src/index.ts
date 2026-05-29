#!/usr/bin/env node
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { RoleLogManager, roleLogDir } from "./role-log.js";
import { launchTmuxSession } from "./tmux.js";
import { AgentTeam, AgentBackendError } from "./team.js";
import { resolveEngine } from "./resolve-engine.js";

interface CliOptions {
  command: "run" | "tmux";
  roleLogs: boolean;
  cwd: string;
}

function parseArgs(argv: string[]): CliOptions & { attach: boolean } {
  let command: "run" | "tmux" = "run";
  let roleLogs = false;
  let attach = false;
  let cwd: string | undefined;

  for (const arg of argv.slice(2)) {
    if (arg === "tmux") command = "tmux";
    else if (arg === "--role-logs") roleLogs = true;
    else if (arg === "--attach") attach = true;
    else if (!arg.startsWith("-")) cwd = arg;
  }

  return {
    command,
    roleLogs,
    attach,
    cwd: resolve(cwd ?? process.cwd()),
  };
}

function loadDotEnv(cwd: string): void {
  const path = resolve(cwd, ".env");
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function banner(cwd: string, roleLogs: boolean, engineLabel: string): void {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  Agent Team — Alfred · Execs · 3 Coders · 3 Reviewers   ║
╚══════════════════════════════════════════════════════════╝
  Working directory: ${cwd}
  Engine: ${engineLabel}${
    roleLogs
      ? `
  tmux: each role streams to .agent-team/logs/<role>.log
  Switch windows with Ctrl+b then 0–7`
      : `
  Talk to Alfred anytime. Engineering work runs in the background.`
  }

  Commands:  /status   /jobs   /help   /quit
`);
}

async function runInteractive(opts: CliOptions): Promise<void> {
  const { cwd, roleLogs } = opts;
  loadDotEnv(cwd);

  let resolved;
  try {
    resolved = await resolveEngine();
  } catch (err) {
    if (err instanceof AgentBackendError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  banner(cwd, roleLogs, resolved.label);

  const roleLogsWriter = roleLogs ? new RoleLogManager(roleLogDir(cwd)) : null;
  if (roleLogsWriter) roleLogsWriter.init();

  const team = new AgentTeam({
    cwd,
    engine: resolved.engine,
    model: resolved.model,
    apiKey: resolved.apiKey,
    onLog: roleLogs
      ? undefined
      : (line) => {
          output.write(`\n\x1b[90m${line}\x1b[0m\n`);
        },
    onAlfredPaneLog: roleLogs
      ? (line) => {
          output.write(`\n\x1b[90m${line}\x1b[0m\n`);
        }
      : undefined,
    onRoleLog: roleLogsWriter
      ? (role, line) => roleLogsWriter.writeLine(role, line)
      : undefined,
    onRoleChunk: roleLogsWriter
      ? (role, chunk) => roleLogsWriter.writeChunk(role, chunk)
      : undefined,
    onAlfredChunk: roleLogs ? (chunk) => output.write(chunk) : undefined,
  });

  const shutdown = async () => {
    await team.dispose();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  try {
    console.log(`Using: ${resolved.label}\nBootstrapping agents...`);
    await team.initialize();
  } catch (err) {
    if (err instanceof AgentBackendError) {
      console.error(`Startup failed: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const rl = readline.createInterface({ input, output, terminal: true });

  console.log("\nAlfred is ready. What would you like to build?\n");

  while (true) {
    let line: string;
    try {
      line = (await rl.question("\x1b[36mYou → Alfred:\x1b[0m ")).trim();
    } catch {
      break;
    }

    if (!line) continue;

    if (roleLogsWriter) roleLogsWriter.writeLine("alfred", `You: ${line}`);

    const cmd = line.toLowerCase();
    if (cmd === "/quit" || cmd === "/exit" || cmd === "exit") break;
    if (cmd === "/help") {
      console.log(`
  /status  — show active background jobs
  /jobs    — same as /status
  /quit    — exit and close agents
`);
      continue;
    }
    if (cmd === "/status" || cmd === "/jobs") {
      console.log("\n" + team.statusText() + "\n");
      continue;
    }

    output.write("\n\x1b[33mAlfred:\x1b[0m ");
    try {
      const reply = await team.talkToAlfred(line);
      if (reply && !roleLogs) output.write(reply);
      output.write("\n");
    } catch (err) {
      if (err instanceof AgentBackendError) {
        console.error(`\nRequest failed: ${err.message}`);
      } else {
        console.error(`\nError: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  rl.close();
  console.log("\nShutting down agent team...");
  await team.dispose();
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.command === "tmux") {
    loadDotEnv(opts.cwd);
    try {
      await resolveEngine();
    } catch (err) {
      if (err instanceof AgentBackendError) {
        console.error(err.message);
        process.exit(1);
      }
      throw err;
    }
    launchTmuxSession(opts.cwd, opts.attach);
  }

  await runInteractive(opts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
