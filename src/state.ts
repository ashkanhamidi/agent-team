import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface TeamState {
  cwd: string;
  model: string;
  agents: {
    alfred?: string;
    execs?: string;
    coders: [string?, string?, string?];
    reviewers: [string?, string?, string?];
  };
  bootstrapped: {
    alfred?: boolean;
    execs?: boolean;
    coders: [boolean, boolean, boolean];
    reviewers: [boolean, boolean, boolean];
  };
}

const STATE_DIR = ".agent-team";

export function statePath(cwd: string): string {
  return join(cwd, STATE_DIR, "state.json");
}

export function emptyState(cwd: string, model: string): TeamState {
  return {
    cwd,
    model,
    agents: { coders: [], reviewers: [] },
    bootstrapped: {
      coders: [false, false, false],
      reviewers: [false, false, false],
    },
  };
}

export async function loadState(cwd: string, model: string): Promise<TeamState> {
  const path = statePath(cwd);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as TeamState;
    parsed.cwd = cwd;
    parsed.model = model;
    parsed.bootstrapped ??= {
      coders: [false, false, false],
      reviewers: [false, false, false],
    };
    parsed.agents ??= { coders: [], reviewers: [] };
    return parsed;
  } catch {
    return emptyState(cwd, model);
  }
}

export async function saveState(cwd: string, state: TeamState): Promise<void> {
  const dir = join(cwd, STATE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(statePath(cwd), JSON.stringify(state, null, 2), "utf8");
}
