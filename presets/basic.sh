#!/bin/bash
# OpenVole Basic Setup — Brain + Memory + Session + Compact + Dashboard
# Usage: curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/basic.sh | bash

set -e

echo "🐹 Setting up OpenVole (basic)..."

# Initialize project
npm init -y > /dev/null 2>&1
npm install openvole @openvole/paw-brain @openvole/paw-memory @openvole/paw-session @openvole/paw-compact @openvole/paw-dashboard

# Scaffold .openvole/ directory with identity files
npx vole init

# Overwrite config with basic setup
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

# Create .env
cat > .env << 'EOF'
BRAIN_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3:latest
VOLE_LOG_LEVEL=info
VOLE_DASHBOARD_PORT=3001
EOF

echo ""
echo "✅ OpenVole (basic) ready!"
echo ""
echo "   Includes: Brain + Memory + Session + Compact + Dashboard"
echo ""
echo "   Make sure Ollama is running, then:"
echo "   npx vole start"
echo ""
echo "   Dashboard: http://localhost:3001"
