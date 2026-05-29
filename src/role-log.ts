import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES, type Role } from "./roles.js";

export function roleLogDir(cwd: string): string {
  return join(cwd, ".agent-team", "logs");
}

export function roleLogPath(cwd: string, role: Role): string {
  return join(roleLogDir(cwd), `${role}.log`);
}

export class RoleLogManager {
  constructor(private readonly dir: string) {}

  init(): void {
    mkdirSync(this.dir, { recursive: true });
    const header = `=== agent-team ${new Date().toISOString()} ===\n\n`;
    for (const role of ROLES) {
      writeFileSync(join(this.dir, `${role}.log`), header);
    }
  }

  writeLine(role: Role, msg: string): void {
    const ts = new Date().toISOString().slice(11, 19);
    appendFileSync(join(this.dir, `${role}.log`), `[${ts}] ${msg}\n`);
  }

  writeChunk(role: Role, text: string): void {
    if (!text) return;
    appendFileSync(join(this.dir, `${role}.log`), text);
  }
}
