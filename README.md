# Agent Team

A local multi-agent orchestrator: Alfred, Execs, three Coders, and three Reviewers. **No paid cloud API is required** if you use Claude Code CLI (subscription) or Ollama (fully local).

## How agents are powered

| Engine | Cost | What you need |
|--------|------|----------------|
| **`claude-cli`** (default if installed) | Uses your **Claude Pro/Max** subscription via OAuth | [Claude Code CLI](https://code.claude.com) + `claude auth login` |
| **`ollama`** (fallback) | **Free**, runs on your machine | [Ollama](https://ollama.com) + a coding model (e.g. `qwen2.5-coder:7b`) |
| **`anthropic`** (opt-in only) | **Pay-per-use** API | `ANTHROPIC_API_KEY` + `AGENT_TEAM_ENGINE=anthropic` |

**Claude Pro (claude.ai chat) is not an API.** This app uses either the **Claude Code CLI** (same account, programmatic `-p` mode) or **local Ollama**. It does not bill your Anthropic API account unless you explicitly enable that engine.

### Important: do not set `ANTHROPIC_API_KEY` for subscription mode

If `ANTHROPIC_API_KEY` is in your environment, Claude Code CLI will use **paid API billing** instead of your subscription. For subscription mode, unset it:

```bash
unset ANTHROPIC_API_KEY
```

## Architecture

```
You  ←→  Alfred  ←→  Execs  ←→  Coders (×3)
                              ↘  Reviewers (×3)
```

**Memory isolation:** Each role has its own session under `.agent-team/sessions/`. The orchestrator only forwards assigned messages between roles.

## Prerequisites

- Node.js 18+
- [tmux](https://github.com/tmux/tmux) (optional, for multi-window UI)
- **One of:**
  - Claude Code CLI (for subscription), or
  - Ollama (for fully local)

### Option A — Claude subscription (recommended)

```bash
npm install -g @anthropic-ai/claude-code
claude auth login
# Confirm no API key is exported:
unset ANTHROPIC_API_KEY
```

### Option B — Fully local (no subscription)

```bash
brew install ollama
ollama pull qwen2.5-coder:7b
ollama serve
export AGENT_TEAM_ENGINE=ollama
```

## Setup

```bash
cd ~/agent-team
npm install
```

## Run

```bash
cd /path/to/your/project
npx tsx ~/agent-team/src/index.ts
```

On startup, the app **auto-detects** an engine: Claude CLI first, then Ollama. Force one with:

```bash
export AGENT_TEAM_ENGINE=claude-cli   # or ollama
```

### tmux UI

```bash
npm run tmux -- /path/to/your/project
```

| Window | Role |
|--------|------|
| 0 | `alfred` (interactive) |
| 1 | `execs` |
| 2–4 | `coder-1` … `coder-3` |
| 5–7 | `reviewer-1` … `reviewer-3` |

## Configuration

| Variable | Description |
|----------|-------------|
| `AGENT_TEAM_ENGINE` | `claude-cli`, `ollama`, or `anthropic` (default: auto) |
| `AGENT_TEAM_MODEL` | Ollama model name or Anthropic model id |
| `OLLAMA_HOST` | Ollama URL (default `http://127.0.0.1:11434`) |
| `CLAUDE_CLI_BIN` | Path to `claude` binary (default `claude`) |
| `ANTHROPIC_API_KEY` | Only for paid `anthropic` engine — **avoid** if using subscription |
| `AGENT_TEAM_ALLOW_PAID_API` | Set to `1` to allow auto-fallback to paid API when nothing else works |

## Interactive commands

| Command | Description |
|---------|-------------|
| `/status` or `/jobs` | Background jobs |
| `/help` | Help |
| `/quit` | Exit |

## Example flow

1. You ask Alfred to build a feature.
2. Alfred delegates to Execs (`<delegate-execs>`).
3. Execs assigns Coders (`<assign-coder>`); Coders edit the repo (CLI tools or Ollama tool loop).
4. Execs assigns Reviewers; iteration continues until Execs reports to Alfred.

## Notes

- Local Ollama models are smaller than Claude; complex tasks may need a larger model or Claude CLI.
- Session files: `.agent-team/sessions/<role>.json`
- Paid API is **off** by default; enable only if you set `AGENT_TEAM_ENGINE=anthropic`.
