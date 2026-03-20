#!/bin/bash
# OpenVole Full Setup — All official paws
# Usage: curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/full.sh | bash

set -e

echo "🐹 Setting up OpenVole (full)..."

# Initialize project
npm init -y > /dev/null 2>&1
npm install openvole \
  @openvole/paw-ollama \
  @openvole/paw-memory \
  @openvole/paw-session \
  @openvole/paw-compact \
  @openvole/paw-dashboard \
  @openvole/paw-telegram \
  @openvole/paw-browser \
  @openvole/paw-shell \
  @openvole/paw-filesystem \
  @openvole/paw-mcp

# Create config
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
    "maxIterations": 10,
    "confirmBeforeAct": false,
    "taskConcurrency": 1,
    "logLevel": "info"
  },
  "toolProfiles": {
    "paw": {
      "deny": ["shell_exec", "shell_exec_background", "fs_write", "fs_edit", "fs_mkdir"]
    }
  },
  "heartbeat": {
    "enabled": true,
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

# Create HEARTBEAT.md
cat > HEARTBEAT.md << 'EOF'
# Heartbeat

## Jobs

<!-- Add recurring jobs here. Examples:
- Check for unread emails and summarize urgent ones
- Poll https://status.example.com and alert if any service is down
-->
EOF

# Create workspace directory for shell/filesystem paws
mkdir -p workspace

# Create .gitignore
cat > .gitignore << 'EOF'
node_modules/
.env
.openvole/
.DS_Store
workspace/
EOF

# Install Chrome for browser paw
echo ""
echo "Installing Chrome for browser automation..."
npx puppeteer browsers install chrome 2>/dev/null || echo "Chrome install skipped — run manually: npx puppeteer browsers install chrome"

echo ""
echo "✅ OpenVole (full) ready!"
echo ""
echo "   Includes: Brain + Memory + Sessions + Compaction + Dashboard"
echo "             + Telegram + Browser + Shell + Filesystem + MCP"
echo ""
echo "   Next steps:"
echo "   1. Edit .env — add credentials"
echo "   2. Make sure Ollama is running"
echo "   3. npx vole start"
echo ""
echo "   Dashboard: http://localhost:3001"
echo "   Install skills: npx vole clawhub install summarize"
