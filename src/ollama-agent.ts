import { AgentBackendError, type RoleAgent } from "./agent.js";
import {
  loadRoleSession,
  saveRoleSession,
  type OllamaChatMessage,
} from "./sessions.js";
import { executeWorkspaceTool } from "./tools.js";
import { OPENAI_WORKSPACE_TOOLS } from "./tool-schemas.js";
import type { Role } from "./roles.js";

const MAX_TOOL_ROUNDS = 40;

function ollamaHost(): string {
  return (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
}

export class OllamaAgent implements RoleAgent {
  private messages: OllamaChatMessage[] = [];
  private loaded = false;

  constructor(
    readonly role: Role,
    private readonly options: {
      cwd: string;
      model: string;
      system: string;
      toolsEnabled: boolean;
    },
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await loadRoleSession(this.options.cwd, this.role);
    if (stored?.engine === "ollama" && Array.isArray(stored.messages)) {
      this.messages = stored.messages;
    }
    this.loaded = true;
  }

  async send(
    userMessage: string,
    streamOpts?: { onChunk?: (text: string) => void },
  ): Promise<string> {
    await this.load();
    this.messages.push({ role: "user", content: userMessage });

    let rounds = 0;
    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const body: Record<string, unknown> = {
        model: this.options.model,
        messages: [
          { role: "system", content: this.options.system },
          ...this.messages,
        ],
        stream: false,
      };
      if (this.options.toolsEnabled) {
        body.tools = OPENAI_WORKSPACE_TOOLS;
      }

      let res: Response;
      try {
        res = await fetch(`${ollamaHost()}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        this.messages.pop();
        throw new AgentBackendError(
          `Ollama unreachable at ${ollamaHost()}. Is \`ollama serve\` running?`,
        );
      }

      if (!res.ok) {
        this.messages.pop();
        const detail = await res.text();
        throw new AgentBackendError(
          `Ollama error ${res.status}: ${detail.slice(0, 500)}`,
        );
      }

      const data = (await res.json()) as {
        message?: OllamaChatMessage;
      };
      const message = data.message;
      if (!message) {
        throw new AgentBackendError("Ollama returned no message");
      }

      this.messages.push(message);

      const toolCalls = message.tool_calls as
        | { function: { name: string; arguments: Record<string, unknown> } }[]
        | undefined;

      if (!toolCalls?.length) {
        const text = String(message.content ?? "");
        if (streamOpts?.onChunk && text) streamOpts.onChunk(text);
        await this.persist();
        return text;
      }

      for (const call of toolCalls) {
        const name = call.function.name;
        let args = call.function.arguments ?? {};
        if (typeof args === "string") {
          try {
            args = JSON.parse(args) as Record<string, unknown>;
          } catch {
            args = {};
          }
        }
        const result = await executeWorkspaceTool(
          this.options.cwd,
          name,
          args,
        );
        this.messages.push({
          role: "tool",
          content: result,
        });
      }
    }

    throw new AgentBackendError(
      `${this.role}: tool loop exceeded ${MAX_TOOL_ROUNDS} rounds`,
    );
  }

  private async persist(): Promise<void> {
    await saveRoleSession(this.options.cwd, this.role, {
      engine: "ollama",
      messages: this.messages,
    });
  }

  close(): void {}
}
