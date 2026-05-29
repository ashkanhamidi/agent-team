import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { roleLogDir, RoleLogManager } from "./role-log.js";
import { TMUX_TAIL_ROLES } from "./roles.js";
import { resolveTmuxBin, tmuxInstallHint } from "./tmux-bin.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sessionName(cwd: string): string {
  const base = cwd.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const suffix = base.slice(-24) || "team";
  return `agent-team-${suffix}`;
}

function tmux(bin: string, args: string[]): void {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `tmux ${args.join(" ")} failed`);
  }
}

export function agentTeamRoot(): string {
  return PACKAGE_ROOT;
}

export function launchTmuxSession(cwd: string, attachExisting = false): never {
  const tmuxBin = resolveTmuxBin();
  if (!tmuxBin) {
    console.error(`tmux is not installed or not on PATH.\n\n${tmuxInstallHint()}`);
    process.exit(1);
  }

  const logs = roleLogDir(cwd);
  const session = sessionName(cwd);

  const existing = spawnSync(tmuxBin, ["has-session", "-t", session], {
    encoding: "utf8",
  });
  if (existing.status === 0) {
    if (attachExisting) {
      const attach = spawnSync(tmuxBin, ["attach", "-t", session], {
        stdio: "inherit",
      });
      process.exit(attach.status ?? 0);
    }
    console.error(
      `tmux session "${session}" already exists.\n` +
        `  Attach: tmux attach -t ${session}\n` +
        `  Or kill:  tmux kill-session -t ${session}\n` +
        `  Or run:   npm run tmux -- --attach ${cwd === process.cwd() ? "" : cwd}`.trim(),
    );
    process.exit(1);
  }

  new RoleLogManager(logs).init();

  const tsx = join(PACKAGE_ROOT, "node_modules", ".bin", "tsx");
  const entry = join(PACKAGE_ROOT, "src", "index.ts");

  const envFlags: string[] = [];
  if (process.env.CURSOR_API_KEY) {
    envFlags.push("-e", `CURSOR_API_KEY=${process.env.CURSOR_API_KEY}`);
  }
  if (process.env.AGENT_TEAM_MODEL) {
    envFlags.push("-e", `AGENT_TEAM_MODEL=${process.env.AGENT_TEAM_MODEL}`);
  }

  const runAlfred = [
    `cd ${shellQuote(PACKAGE_ROOT)}`,
    `${shellQuote(tsx)} ${shellQuote(entry)} ${shellQuote(cwd)} --role-logs`,
  ].join(" && ");

  tmux(tmuxBin, [
    "new-session",
    "-d",
    "-s",
    session,
    "-n",
    "alfred",
    "-c",
    cwd,
    ...envFlags,
    runAlfred,
  ]);

  for (const role of TMUX_TAIL_ROLES) {
    const logFile = join(logs, `${role}.log`);
    tmux(tmuxBin, [
      "new-window",
      "-t",
      session,
      "-n",
      role,
      "-c",
      cwd,
      "tail",
      "-f",
      logFile,
    ]);
  }

  tmux(tmuxBin, ["select-window", "-t", `${session}:alfred`]);

  console.log(`tmux session "${session}" started (${tmuxBin}).`);
  console.log("  alfred     — talk to Alfred (this window after attach)");
  for (const role of TMUX_TAIL_ROLES) {
    console.log(`  ${role.padEnd(10)} — tail -f ${role}.log`);
  }
  console.log(`\nAttach: ${tmuxBin} attach -t ${session}`);
  console.log("Switch windows: Ctrl+b then 0–7\n");

  const attach = spawnSync(tmuxBin, ["attach", "-t", session], {
    stdio: "inherit",
  });
  process.exit(attach.status ?? 0);
}
