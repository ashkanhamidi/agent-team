import type { EngineId } from "./resolve-engine.js";
import type { RoleAgent, RoleAgentFactoryOptions } from "./agent.js";
import { AnthropicAgent } from "./anthropic-agent.js";
import { ClaudeCliAgent } from "./claude-cli-agent.js";
import { OllamaAgent } from "./ollama-agent.js";

export function createRoleAgent(
  engine: EngineId,
  opts: RoleAgentFactoryOptions,
): RoleAgent {
  switch (engine) {
    case "claude-cli":
      return new ClaudeCliAgent(opts.role, {
        cwd: opts.cwd,
        system: opts.system,
        toolsEnabled: opts.toolsEnabled,
      });
    case "ollama":
      return new OllamaAgent(opts.role, {
        cwd: opts.cwd,
        model: opts.model,
        system: opts.system,
        toolsEnabled: opts.toolsEnabled,
      });
    case "anthropic":
      if (!opts.apiKey) {
        throw new Error("Anthropic engine requires apiKey");
      }
      return new AnthropicAgent(opts.role, {
        cwd: opts.cwd,
        apiKey: opts.apiKey,
        model: opts.model,
        system: opts.system,
        toolsEnabled: opts.toolsEnabled,
      });
  }
}
