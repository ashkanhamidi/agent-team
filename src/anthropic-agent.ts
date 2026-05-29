import Anthropic from "@anthropic-ai/sdk";
import { AgentBackendError, type RoleAgent } from "./agent.js";
import { loadRoleSession, saveRoleSession } from "./sessions.js";
import { executeWorkspaceTool, WORKSPACE_TOOLS } from "./tools.js";
import type { Role } from "./roles.js";

const MAX_TOOL_ROUNDS = 40;

type SessionMessage = Anthropic.MessageParam;

export class AnthropicAgent implements RoleAgent {
  private readonly client: Anthropic;
  private messages: SessionMessage[] = [];
  private loaded = false;

  constructor(
    readonly role: Role,
    private readonly options: {
      cwd: string;
      apiKey: string;
      model: string;
      system: string;
      toolsEnabled: boolean;
    },
  ) {
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await loadRoleSession(this.options.cwd, this.role);
    if (stored?.engine === "anthropic" && Array.isArray(stored.messages)) {
      this.messages = stored.messages as unknown as SessionMessage[];
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
      const useStream = streamOpts?.onChunk != null && rounds === 1;

      let response: Anthropic.Message;
      try {
        if (useStream) {
          const stream = this.client.messages.stream({
            model: this.options.model,
            max_tokens: 16_384,
            system: this.options.system,
            messages: this.messages,
            tools: this.options.toolsEnabled ? WORKSPACE_TOOLS : undefined,
          });
          stream.on("text", (delta) => {
            if (delta) streamOpts!.onChunk!(delta);
          });
          response = await stream.finalMessage();
        } else {
          response = await this.client.messages.create({
            model: this.options.model,
            max_tokens: 16_384,
            system: this.options.system,
            messages: this.messages,
            tools: this.options.toolsEnabled ? WORKSPACE_TOOLS : undefined,
          });
        }
      } catch (err) {
        this.messages.pop();
        throw toBackendError(err);
      }

      this.messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) {
        await saveRoleSession(this.options.cwd, this.role, {
          engine: "anthropic",
          messages: this.messages as unknown as import("./sessions.js").OllamaChatMessage[],
        });
        return textFromAssistant(response.content);
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tool of toolUses) {
        const result = await executeWorkspaceTool(
          this.options.cwd,
          tool.name,
          tool.input as Record<string, unknown>,
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: result,
        });
      }
      this.messages.push({ role: "user", content: toolResults });
    }

    throw new AgentBackendError(
      `${this.role}: tool loop exceeded ${MAX_TOOL_ROUNDS} rounds`,
    );
  }

  close(): void {}
}

function textFromAssistant(
  content: Anthropic.ContentBlock | Anthropic.ContentBlock[],
): string {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function toBackendError(err: unknown): AgentBackendError {
  if (err instanceof Anthropic.APIError) {
    return new AgentBackendError(err.message, err.status);
  }
  if (err instanceof Error) {
    return new AgentBackendError(err.message);
  }
  return new AgentBackendError(String(err));
}
