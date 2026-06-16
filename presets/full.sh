#!/bin/bash
# OpenVole Full Setup — a space with every official paw
# Usage: curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/full.sh | bash
#
# Creates an OpenVole root (default ~/openvole, override with VOLE_HOME) containing one fully
# loaded space, then you run `vole serve` to manage and chat with it in the dashboard.

set -e

ROOT="${VOLE_HOME:-$HOME/openvole}"
export VOLE_HOME="$ROOT"
SPACE_NAME="assistant"
SPACE="$ROOT/spaces/$SPACE_NAME"

echo "🐹 Setting up OpenVole (full) in $ROOT ..."

mkdir -p "$ROOT"

# 1. Install the OpenVole server in the root (this is what runs `vole serve`)
( cd "$ROOT" && npm init -y > /dev/null 2>&1 && npm install openvole )
VOLE="$ROOT/node_modules/.bin/vole"

# 2. Create the space (registered in $ROOT/spaces.json)
"$VOLE" space create "$SPACE_NAME"

# 3. Install the paws into the space (each space has its own node_modules)
( cd "$SPACE" && npm init -y > /dev/null 2>&1 && npm install \
  @openvole/paw-brain \
  @openvole/paw-memory \
  @openvole/paw-session \
  @openvole/paw-compact \
  @openvole/paw-telegram \
  @openvole/paw-browser \
  @openvole/paw-shell \
  @openvole/paw-filesystem \
  @openvole/paw-mcp )
mkdir -p "$SPACE/workspace"

# 4. Write the space config
cat > "$SPACE/vole.config.json" << 'EOF'
{
  "brain": "@openvole/paw-brain",
  "paws": [
    {
      "name": "@openvole/paw-brain",
      "allow": {
        "network": ["*"],
        "env": ["BRAIN_PROVIDER", "BRAIN_API_KEY", "BRAIN_MODEL",
                "OLLAMA_HOST", "OLLAMA_MODEL", "OLLAMA_API_KEY",
                "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]
      }
    },
    { "name": "@openvole/paw-memory", "allow": { "env": ["VOLE_MEMORY_DIR"] } },
    { "name": "@openvole/paw-session", "allow": { "env": ["VOLE_SESSION_TTL"] } },
    { "name": "@openvole/paw-compact", "allow": { "env": ["VOLE_COMPACT_KEEP_RECENT"] } },
    {
      "name": "@openvole/paw-telegram",
      "allow": {
        "network": ["api.telegram.org"],
        "env": ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOW_FROM"]
      }
    },
    {
      "name": "@openvole/paw-browser",
      "allow": { "network": ["*"], "env": ["VOLE_BROWSER_HEADLESS"] }
    },
    {
      "name": "@openvole/paw-shell",
      "allow": { "filesystem": ["./workspace"], "env": ["VOLE_SHELL_ALLOWED_DIRS"] }
    },
    {
      "name": "@openvole/paw-filesystem",
      "allow": { "filesystem": ["./workspace"], "env": ["VOLE_FS_ALLOWED_DIRS"] }
    },
    { "name": "@openvole/paw-mcp", "allow": { "network": ["127.0.0.1"], "env": [] } }
  ],
  "skills": [],
  "loop": {
    "maxIterations": 25,
    "confirmBeforeAct": false,
    "taskConcurrency": 1,
    "compactThreshold": 50
  },
  "toolProfiles": {
    "paw": {
      "deny": ["shell_exec", "shell_exec_background", "fs_write", "fs_edit", "fs_mkdir"]
    }
  },
  "heartbeat": { "enabled": true, "intervalMinutes": 30 },
  "security": { "sandboxFilesystem": true }
}
EOF

# 5. Write the space .env (VOLE_LOG_FILE keeps the space logging to its own directory)
cat > "$SPACE/.env" << 'EOF'
BRAIN_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3:latest
VOLE_LOG_LEVEL=info
VOLE_LOG_FILE=.openvole/logs/vole.log

# Telegram — get token from @BotFather
TELEGRAM_BOT_TOKEN=
# Your Telegram user ID — get from @userinfobot
TELEGRAM_ALLOW_FROM=
EOF

echo ""
echo "✅ OpenVole (full) ready — space \"$SPACE_NAME\""
echo "   Brain + Memory + Session + Compact + Telegram + Browser + Shell + Filesystem + MCP"
echo ""
echo "   Next steps:"
echo "   1. Edit $SPACE/.env — add credentials (or use the dashboard Config/Identity tabs)"
echo "   2. Make sure your LLM is reachable (Ollama by default)"
echo "   3. cd $ROOT && npx vole serve  →  select \"$SPACE_NAME\" and Start it"
echo ""
echo "   Install skills from the space dir: (cd $SPACE && npx vole clawhub install summarize)"
