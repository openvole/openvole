#!/bin/bash
# OpenVole Telegram Setup — Brain + Memory + Session + Compact + Dashboard + Telegram + Browser
# Usage: curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/telegram.sh | bash

set -e

echo "🐹 Setting up OpenVole (telegram)..."

# Initialize project
npm init -y > /dev/null 2>&1
npm install openvole @openvole/paw-ollama @openvole/paw-memory @openvole/paw-session @openvole/paw-compact @openvole/paw-dashboard @openvole/paw-telegram @openvole/paw-browser

# Scaffold .openvole/ directory with identity files
npx vole init

# Overwrite config with telegram setup
cat > vole.config.json << 'EOF'
{
  "brain": "@openvole/paw-ollama",
  "paws": [
    {
      "name": "@openvole/paw-ollama",
      "allow": {
        "network": ["127.0.0.1"],
        "env": ["OLLAMA_HOST", "OLLAMA_MODEL", "OLLAMA_API_KEY"]
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
    "enabled": false,
    "intervalMinutes": 30
  }
}
EOF

# Create .env template
cat > .env << 'EOF'
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3:latest
VOLE_LOG_LEVEL=info
VOLE_DASHBOARD_PORT=3001

# Telegram — get token from @BotFather
TELEGRAM_BOT_TOKEN=
# Your Telegram user ID — get from @userinfobot
TELEGRAM_ALLOW_FROM=
EOF

echo ""
echo "✅ OpenVole (telegram) ready!"
echo ""
echo "   Includes: Brain (Ollama) + Memory + Session + Compact + Dashboard + Telegram + Browser"
echo ""
echo "   Next steps:"
echo "   1. Edit .env — add TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOW_FROM"
echo "   2. Make sure Ollama is running"
echo "   3. npx vole start"
echo ""
echo "   Dashboard: http://localhost:3001"
