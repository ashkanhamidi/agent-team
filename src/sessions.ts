import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Role } from "./roles.js";

const SESSION_DIR = ".agent-team/sessions";

export type OllamaChatMessage = Record<string, unknown>;

export interface RoleSessionFile {
  engine: "claude-cli" | "ollama" | "anthropic";
  claudeSessionId?: string;
  messages?: OllamaChatMessage[];
}

export function sessionPath(cwd: string, role: Role): string {
  return join(cwd, SESSION_DIR, `${role}.json`);
}

export async function loadRoleSession(
  cwd: string,
  role: Role,
): Promise<RoleSessionFile | null> {
  try {
    const raw = await readFile(sessionPath(cwd, role), "utf8");
    return JSON.parse(raw) as RoleSessionFile;
  } catch {
    return null;
  }
}

export async function saveRoleSession(
  cwd: string,
  role: Role,
  data: RoleSessionFile,
): Promise<void> {
  const path = sessionPath(cwd, role);
  await mkdir(join(cwd, SESSION_DIR), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}
