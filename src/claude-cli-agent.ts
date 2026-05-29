import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentBackendError, type RoleAgent } from "./agent.js";
import { loadRoleSession, saveRoleSession } from "./sessions.js";
import type { Role } from "./roles.js";

const execFileAsync = promisify(execFile);

/** Strip API key so Claude Code uses OAuth subscription, not pay-per-use API. */
function subscriptionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

export class ClaudeCliAgent implements RoleAgent {
  private sessionId: string | undefined;
  private loaded = false;

  constructor(
    readonly role: Role,
    private readonly options: {
      cwd: string;
      system: string;
      toolsEnabled: boolean;
    },
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await loadRoleSession(this.options.cwd, this.role);
    if (stored?.engine === "claude-cli" && stored.claudeSessionId) {
      this.sessionId = stored.claudeSessionId;
    }
    this.loaded = true;
  }

  async send(
    userMessage: string,
    streamOpts?: { onChunk?: (text: string) => void },
  ): Promise<string> {
    await this.load();

    const args = [
      "-p",
      userMessage,
      "--output-format",
      streamOpts?.onChunk ? "stream-json" : "json",
      "--append-system-prompt",
      this.options.system,
    ];

    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    if (this.options.toolsEnabled) {
      args.push(
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Read,Edit,Bash",
      );
    }

    if (streamOpts?.onChunk) {
      args.push("--verbose", "--include-partial-messages");
    }

    const bin = process.env.CLAUDE_CLI_BIN?.trim() || "claude";

    try {
      const { stdout } = await execFileAsync(bin, args, {
        cwd: this.options.cwd,
        env: subscriptionEnv(),
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60 * 60 * 1000,
      });

      if (streamOpts?.onChunk) {
        const { text, sessionId } = parseStreamJson(stdout, streamOpts.onChunk);
        if (sessionId) await this.persistSession(sessionId);
        return text;
      }

      const parsed = JSON.parse(stdout) as {
        result?: string;
        session_id?: string;
      };
      const text = parsed.result ?? "";
      if (parsed.session_id) {
        await this.persistSession(parsed.session_id);
      }
      return text;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message.includes("ENOENT")
            ? `Claude CLI not found (${bin}). Install: npm install -g @anthropic-ai/claude-code`
            : err.message
          : String(err);
      throw new AgentBackendError(msg);
    }
  }

  private async persistSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    await saveRoleSession(this.options.cwd, this.role, {
      engine: "claude-cli",
      claudeSessionId: sessionId,
    });
  }

  close(): void {}
}

function parseSessionIdFromStream(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as { session_id?: string };
      if (evt.session_id) return evt.session_id;
    } catch {
      /* skip */
    }
  }
  return undefined;
}

function parseStreamJson(
  stdout: string,
  onChunk: (text: string) => void,
): { text: string; sessionId?: string } {
  let text = "";
  let sessionId: string | undefined;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof evt.session_id === "string") sessionId = evt.session_id;

    const event = evt.event as Record<string, unknown> | undefined;
    const delta = event?.delta as Record<string, unknown> | undefined;
    if (event?.type === "text_delta" && typeof delta?.text === "string") {
      text += delta.text;
      onChunk(delta.text);
    }
    if (typeof evt.result === "string") text = evt.result;
  }

  return { text, sessionId };
}
