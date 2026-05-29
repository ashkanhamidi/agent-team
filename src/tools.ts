import { execFile } from "node:child_process";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type Anthropic from "@anthropic-ai/sdk";

const execFileAsync = promisify(execFile);

export const WORKSPACE_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file relative to the project working directory.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Create or overwrite a UTF-8 text file relative to the project working directory.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        content: { type: "string", description: "Full file contents" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_dir",
    description: "List entries in a directory relative to the project working directory.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative directory path (use . for project root)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "run_shell",
    description:
      "Run a shell command in the project working directory (bash -lc). Use for tests, builds, git, etc.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
        timeout_seconds: {
          type: "number",
          description: "Optional timeout in seconds (default 120, max 300)",
        },
      },
      required: ["command"],
    },
  },
];

function resolveInCwd(cwd: string, relPath: string): string {
  const abs = resolve(cwd, relPath);
  const rel = relative(cwd, abs);
  if (rel.startsWith("..") || resolve(rel).startsWith("..")) {
    throw new Error(`Path escapes working directory: ${relPath}`);
  }
  return abs;
}

export async function executeWorkspaceTool(
  cwd: string,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "read_file": {
      const path = String(input.path ?? "");
      const abs = resolveInCwd(cwd, path);
      const content = await readFile(abs, "utf8");
      return content.length > 200_000
        ? `${content.slice(0, 200_000)}\n…[truncated]`
        : content;
    }
    case "write_file": {
      const path = String(input.path ?? "");
      const content = String(input.content ?? "");
      const abs = resolveInCwd(cwd, path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      return `Wrote ${path} (${content.length} bytes)`;
    }
    case "list_dir": {
      const path = String(input.path ?? ".");
      const abs = resolveInCwd(cwd, path);
      const entries = await readdir(abs, { withFileTypes: true });
      return entries
        .map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`)
        .join("\n");
    }
    case "run_shell": {
      const command = String(input.command ?? "");
      const timeoutSec = Math.min(
        300,
        Math.max(1, Number(input.timeout_seconds ?? 120)),
      );
      const { stdout, stderr } = await execFileAsync(
        "bash",
        ["-lc", command],
        {
          cwd,
          timeout: timeoutSec * 1000,
          maxBuffer: 4 * 1024 * 1024,
          env: process.env,
        },
      );
      const out = [stdout, stderr].filter(Boolean).join("\n");
      return out || "(no output)";
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
