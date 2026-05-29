#!/usr/bin/env bash
set -euo pipefail

find_brew() {
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew "$HOME/.homebrew/bin/brew"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

BREW="$(find_brew || true)"

if [[ -z "$BREW" ]]; then
  echo "Homebrew not found. Install it first:"
  echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  echo ""
  echo "Then add Homebrew to your PATH (Apple Silicon):"
  echo '  eval "$(/opt/homebrew/bin/brew shellenv zsh)"'
  exit 1
fi

eval "$("$BREW" shellenv)"

if command -v tmux >/dev/null 2>&1; then
  echo "tmux already installed: $(tmux -V)"
else
  echo "Installing tmux via Homebrew (pre-built bottles, ~30s)..."
  brew install tmux
  echo "Installed: $(tmux -V)"
fi

ZPROFILE="$HOME/.zprofile"
SHELLENV='eval "$(/opt/homebrew/bin/brew shellenv zsh)"'
if [[ "$BREW" == "/opt/homebrew/bin/brew" ]] && ! grep -qF "brew shellenv" "$ZPROFILE" 2>/dev/null; then
  echo ""
  echo "Adding Homebrew to ~/.zprofile so brew/tmux are on PATH in new shells..."
  {
    echo ""
    echo "# Homebrew"
    echo "$SHELLENV"
  } >> "$ZPROFILE"
  echo "Done. Run: source ~/.zprofile"
fi

echo ""
echo "Start agent-team with tmux:"
echo "  npm run tmux -- /path/to/your/project"
