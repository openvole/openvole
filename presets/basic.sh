#!/bin/bash
# OpenVole Basic Setup — a ready-to-run space with Brain + Memory + Session + Compact + Shell
# Usage: curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/basic.sh | bash
#
# Creates an OpenVole root (default ~/openvole, override with VOLE_HOME) containing one space,
# then you run `vole serve` to manage and chat with it in the dashboard.

set -e

ROOT="${VOLE_HOME:-$HOME/openvole}"
export VOLE_HOME="$ROOT"
SPACE_NAME="assistant"
SPACE="$ROOT/spaces/$SPACE_NAME"

echo "🐹 Setting up OpenVole (basic) in $ROOT ..."

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
  @openvole/paw-shell )
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
      "name": "@openvole/paw-shell",
      "allow": { "filesystem": ["./workspace"], "env": ["VOLE_SHELL_ALLOWED_DIRS"] }
    }
  ],
  "skills": [],
  "loop": {
    "maxIterations": 25,
    "confirmBeforeAct": false,
    "taskConcurrency": 1,
    "compactThreshold": 50
  }
}
EOF

# 5. Write the space .env (VOLE_LOG_FILE keeps the space logging to its own directory)
cat > "$SPACE/.env" << 'EOF'
BRAIN_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3:latest
VOLE_LOG_LEVEL=info
VOLE_LOG_FILE=.openvole/logs/vole.log
EOF

echo ""
echo "✅ OpenVole (basic) ready — space \"$SPACE_NAME\" with Brain + Memory + Session + Compact + Shell"
echo ""
echo "   Make sure your LLM is reachable (Ollama by default), then start the dashboard:"
echo ""
echo "       cd $ROOT && npx vole serve"
echo ""
echo "   Open http://localhost:3000, select the \"$SPACE_NAME\" space, and Start it."
