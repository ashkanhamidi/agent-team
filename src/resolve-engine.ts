import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentBackendError } from "./agent.js";

const execFileAsync = promisify(execFile);

export type EngineId = "claude-cli" | "ollama" | "anthropic";

export interface ResolvedEngine {
  engine: EngineId;
  model: string;
  label: string;
  apiKey?: string;
}

export async function resolveEngine(): Promise<ResolvedEngine> {
  const forced = process.env.AGENT_TEAM_ENGINE?.trim().toLowerCase();

  if (forced === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new AgentBackendError(
        "AGENT_TEAM_ENGINE=anthropic requires ANTHROPIC_API_KEY (paid API). " +
          "Use claude-cli or ollama for no API billing.",
      );
    }
    return {
      engine: "anthropic",
      model: anthropicModel(),
      label: "Anthropic API (pay-per-use)",
      apiKey,
    };
  }

  if (forced === "claude-cli") {
    await assertClaudeCli();
    return {
      engine: "claude-cli",
      model: "claude-subscription",
      label: "Claude Code CLI (Claude Pro/Max subscription)",
    };
  }

  if (forced === "ollama") {
    const model = await resolveOllamaModel();
    return {
      engine: "ollama",
      model,
      label: `Ollama (local, ${model})`,
    };
  }

  if (forced) {
    throw new AgentBackendError(
      `Unknown AGENT_TEAM_ENGINE=${forced}. Use claude-cli, ollama, or anthropic.`,
    );
  }

  // Auto: subscription CLI first, then free local Ollama. No paid API unless opted in.
  if (await claudeCliAvailable()) {
    return {
      engine: "claude-cli",
      model: "claude-subscription",
      label: "Claude Code CLI (Claude Pro/Max subscription)",
    };
  }

  if (await ollamaAvailable()) {
    const model = await resolveOllamaModel();
    return {
      engine: "ollama",
      model,
      label: `Ollama (local, ${model})`,
    };
  }

  if (
    process.env.ANTHROPIC_API_KEY?.trim() &&
    process.env.AGENT_TEAM_ALLOW_PAID_API === "1"
  ) {
    return {
      engine: "anthropic",
      model: anthropicModel(),
      label: "Anthropic API (pay-per-use, opt-in)",
      apiKey: process.env.ANTHROPIC_API_KEY.trim(),
    };
  }

  throw new AgentBackendError(
    [
      "No agent engine available.",
      "",
      "Option A — Claude subscription (recommended if you have Claude Pro):",
      "  npm install -g @anthropic-ai/claude-code",
      "  claude auth login",
      "  Ensure ANTHROPIC_API_KEY is NOT set (it forces paid API billing).",
      "",
      "Option B — Fully local, no subscription:",
      "  brew install ollama && ollama pull qwen2.5-coder:7b",
      "  ollama serve",
      "",
      "Then run again, or set AGENT_TEAM_ENGINE=claude-cli|ollama",
    ].join("\n"),
  );
}

async function assertClaudeCli(): Promise<void> {
  if (!(await claudeCliAvailable())) {
    throw new AgentBackendError(
      "Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code",
    );
  }
}

export async function claudeCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync("which", ["claude"]);
    return true;
  } catch {
    return false;
  }
}

function ollamaHost(): string {
  return (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
}

export async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaHost()}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveOllamaModel(): Promise<string> {
  const env = process.env.AGENT_TEAM_MODEL?.trim();
  if (env) return env;
  try {
    const res = await fetch(`${ollamaHost()}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return "qwen2.5-coder:7b";
    const data = (await res.json()) as {
      models?: { name: string }[];
    };
    const first = data.models?.[0]?.name;
    return first ?? "qwen2.5-coder:7b";
  } catch {
    return "qwen2.5-coder:7b";
  }
}

function anthropicModel(): string {
  return (
    process.env.AGENT_TEAM_MODEL?.trim() || "claude-sonnet-4-20250514"
  );
}
