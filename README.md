# Agent Team

A local multi-agent orchestrator built on the [Cursor SDK](https://cursor.com/docs/sdk/typescript). When you run it, it spins up an isolated agent team you can talk to continuously while Coders and Reviewers work in the background.

## Architecture

```
You  ←→  Alfred  ←→  Execs  ←→  Coders (×3)
                              ↘  Reviewers (×3)
```

| Agent | Role |
|-------|------|
| **Alfred** | Your single point of contact. Coordinates with Execs and summarizes progress. |
| **Execs** | Engineering lead. Breaks work into Coder/Reviewer tasks and iterates on feedback. |
| **Coder 1–3** | Implement code in the active directory (isolated memory each). |
| **Reviewer 1–3** | Test and review Coder output; report findings to Execs (isolated memory each). |

**Memory isolation:** Each agent is a separate `Agent.create()` / `Agent.resume()` instance with its own conversation history. Agents never see each other's full transcripts—only what the orchestrator forwards in each message.

**Persistence:** Agent IDs are stored in `.agent-team/state.json` under your working directory so sessions can resume.

## Prerequisites

- Node.js 18+
- [tmux](https://github.com/tmux/tmux) (for the multi-window UI)
- A [Cursor API key](https://cursor.com/dashboard/integrations)

### Install tmux

Homebrew is the fastest path on macOS (pre-built bottles, ~30 seconds):

```bash
eval "$(/opt/homebrew/bin/brew shellenv zsh)"   # add to ~/.zprofile to persist
brew install tmux
```

Or use the project helper (detects Homebrew, installs tmux, updates PATH):

```bash
npm run install-tmux
source ~/.zprofile
```

**Note:** If `brew` says "command not found" after installing Homebrew, it is not on your PATH yet. Run the `eval` line above or open a new terminal after `npm run install-tmux`.

## Setup

```bash
cd ~/agent-team
cp .env.example .env
# Edit .env and set CURSOR_API_KEY

npm install --cache ./.npm-cache   # use local cache if global npm has permission issues
```

## Run

From the project you want Coders to work in:

```bash
cd /path/to/your/project
export CURSOR_API_KEY="cursor_..."
npx tsx ~/agent-team/src/index.ts
```

Or pass the directory explicitly:

```bash
npx tsx ~/agent-team/src/index.ts /path/to/your/project
```

### tmux UI (recommended)

Each agent role gets its own tmux window; Alfred stays interactive in window 0.

```bash
cd /path/to/your/project
export CURSOR_API_KEY="cursor_..."
npm run tmux -- /path/to/your/project
```

| Window | Role | What you see |
|--------|------|--------------|
| 0 | `alfred` | Interactive chat with Alfred |
| 1 | `execs` | Execs log stream |
| 2–4 | `coder-1` … `coder-3` | Coder log streams |
| 5–7 | `reviewer-1` … `reviewer-3` | Reviewer log streams |

Switch windows: `Ctrl+b` then `0`–`7`. Logs are written to `.agent-team/logs/<role>.log`.

Re-attach to an existing session:

```bash
npm run tmux -- --attach /path/to/your/project
```

### Interactive commands

| Command | Description |
|---------|-------------|
| `/status` or `/jobs` | List background Coder/Reviewer/Execs jobs |
| `/help` | Show commands |
| `/quit` | Exit and close all agents |

## Example flow

1. You tell Alfred: *"Add a REST health endpoint and unit tests."*
2. Alfred delegates to Execs via `<delegate-execs>`.
3. Execs assigns one or more Coders with `<assign-coder>`.
4. When Coders finish, Execs assigns Reviewers with `<assign-reviewer>`.
5. Reviewers report bugs; Execs may send revised Coder tasks.
6. Execs reports to Alfred via `<report-alfred>`; you can ask Alfred for a summary anytime.

## Configuration

| Variable | Description |
|----------|-------------|
| `CURSOR_API_KEY` | Required. Cursor API key. |
| `AGENT_TEAM_MODEL` | Optional. Model id (default: `composer-2.5` or best available). |

## Notes

- Coders and Reviewers use **local** agents with `settingSources: []` so project rules are not mixed across agents unless you change that in code.
- Long-running work happens asynchronously; keep chatting with Alfred while jobs run.
- If npm global cache errors occur, use `npm install --cache ./.npm-cache` inside this repo.
