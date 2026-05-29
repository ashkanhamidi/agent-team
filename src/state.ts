import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { EngineId } from "./resolve-engine.js";

export interface TeamState {
  cwd: string;
  model: string;
  engine: EngineId;
  /** Schema version for migrations. */
  version: 3;
}

const STATE_DIR = ".agent-team";

export function statePath(cwd: string): string {
  return join(cwd, STATE_DIR, "state.json");
}

export function emptyState(
  cwd: string,
  model: string,
  engine: EngineId,
): TeamState {
  return { cwd, model, engine, version: 3 };
}

export async function loadState(
  cwd: string,
  model: string,
  engine: EngineId,
): Promise<TeamState> {
  const path = statePath(cwd);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<TeamState>;
    return {
      cwd,
      model,
      engine: parsed.engine ?? engine,
      version: 3,
    };
  } catch {
    return emptyState(cwd, model, engine);
  }
}

export async function saveState(cwd: string, state: TeamState): Promise<void> {
  const dir = join(cwd, STATE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(statePath(cwd), JSON.stringify(state, null, 2), "utf8");
}
