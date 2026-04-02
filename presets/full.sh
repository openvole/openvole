#!/bin/bash
# OpenVole Full Setup — All official paws
# Usage: curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/full.sh | bash

set -e

echo "🐹 Setting up OpenVole (full)..."

# Initialize project
npm init -y > /dev/null 2>&1
npm install openvole \
  @openvole/paw-brain \
  @openvole/paw-memory \
  @openvole/paw-session \
  @openvole/paw-compact \
  @openvole/paw-dashboard \
  @openvole/paw-telegram \
  @openvole/paw-browser \
  @openvole/paw-shell \
  @openvole/paw-filesystem \
  @openvole/paw-mcp

# Scaffold .openvole/ directory with identity files
npx vole init

# Overwrite config with full setup
cat > vole.config.json << 'EOF'
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
    {
      "name": "@openvole/paw-memory",
      "allow": {
        "env": ["VOLE_MEMORY_DIR"]
      }
    },
    {
      "name": "@openvole/paw-session",
      "allow": {
        "env": ["VOLE_SESSION_TTL"]
      }
    },
    {
      "name": "@openvole/paw-compact",
      "allow": {
        "env": ["VOLE_COMPACT_KEEP_RECENT"]
      }
    },
    {
      "name": "@openvole/paw-dashboard",
      "allow": {
        "listen": [3001],
        "env": ["VOLE_DASHBOARD_PORT"]
      }
    },
    {
      "name": "@openvole/paw-telegram",
      "allow": {
        "network": ["api.telegram.org"],
        "env": ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOW_FROM"]
      }
    },
    {
      "name": "@openvole/paw-browser",
      "allow": {
        "network": ["*"],
        "env": ["VOLE_BROWSER_HEADLESS"]
      }
    },
    {
      "name": "@openvole/paw-shell",
      "allow": {
        "filesystem": ["./workspace"],
        "env": ["VOLE_SHELL_ALLOWED_DIRS"]
      }
    },
    {
      "name": "@openvole/paw-filesystem",
      "allow": {
        "filesystem": ["./workspace"],
        "env": ["VOLE_FS_ALLOWED_DIRS"]
      }
    },
    {
      "name": "@openvole/paw-mcp",
      "allow": {
        "network": ["127.0.0.1"],
        "env": []
      }
    }
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
  "heartbeat": {
    "enabled": true,
    "intervalMinutes": 30
  },
  "security": {
    "sandboxFilesystem": true
  }
}
EOF

# Create .env template
cat > .env << 'EOF'
BRAIN_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3:latest
VOLE_LOG_LEVEL=info
VOLE_DASHBOARD_PORT=3001

# Telegram — get token from @BotFather
TELEGRAM_BOT_TOKEN=
# Your Telegram user ID — get from @userinfobot
TELEGRAM_ALLOW_FROM=
EOF

# Create workspace directory for shell/filesystem paws
mkdir -p workspace

echo ""
echo "✅ OpenVole (full) ready!"
echo ""
echo "   Includes: Brain + Memory + Session + Compact + Dashboard"
echo "             + Telegram + Browser + Shell + Filesystem + MCP"
echo ""
echo "   Next steps:"
echo "   1. Edit .env — add credentials"
echo "   2. Make sure Ollama is running"
echo "   3. npx vole start"
echo ""
echo "   Dashboard: http://localhost:3001"
echo "   Install skills: npx vole clawhub install summarize"
