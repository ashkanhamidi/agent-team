import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const TMUX_CANDIDATES = [
  process.env.TMUX_BIN,
  "tmux",
  "/opt/homebrew/bin/tmux",
  "/usr/local/bin/tmux",
  join(homedir(), ".homebrew", "bin", "tmux"),
].filter((p): p is string => Boolean(p));

let cachedTmuxBin: string | null | undefined;

export function resolveTmuxBin(): string | null {
  if (cachedTmuxBin !== undefined) return cachedTmuxBin;

  for (const candidate of TMUX_CANDIDATES) {
    if (candidate.includes("/") && !existsSync(candidate)) continue;
    const result = spawnSync(candidate, ["-V"], { encoding: "utf8" });
    if (result.status === 0) {
      cachedTmuxBin = candidate;
      return candidate;
    }
  }

  cachedTmuxBin = null;
  return null;
}

export function tmuxInstallHint(): string {
  const brewPaths = [
    "/opt/homebrew/bin/brew",
    "/usr/local/bin/brew",
    join(homedir(), ".homebrew", "bin", "brew"),
  ];
  const brew = brewPaths.find((p) => existsSync(p));

  if (brew) {
    const shellenv =
      brew === "/opt/homebrew/bin/brew"
        ? 'eval "$(/opt/homebrew/bin/brew shellenv zsh)"'
        : `eval "$(${brew} shellenv)"`;
    return [
      "Homebrew is installed but may not be on your PATH.",
      "",
      `  ${shellenv}`,
      `  ${brew} install tmux`,
      "",
      "Or run: npm run install-tmux",
    ].join("\n");
  }

  return [
    "Install Homebrew, then tmux:",
    '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    '  eval "$(/opt/homebrew/bin/brew shellenv zsh)"',
    "  brew install tmux",
    "",
    "Or run: npm run install-tmux",
    "Linux: sudo apt install tmux",
  ].join("\n");
}
