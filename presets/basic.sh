#!/bin/bash
# OpenVole Basic Setup — Brain + Memory + Dashboard
# Usage: curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/basic.sh | bash

set -e

echo "🐹 Setting up OpenVole (basic)..."

# Initialize project
npm init -y > /dev/null 2>&1
npm install openvole @openvole/paw-ollama @openvole/paw-memory @openvole/paw-dashboard

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
      "name": "@openvole/paw-dashboard",
      "allow": {
        "listen": [3001],
        "env": ["VOLE_DASHBOARD_PORT"]
      }
    }
  ],
  "skills": [],
  "loop": {
    "maxIterations": 10,
    "confirmBeforeAct": false,
    "taskConcurrency": 1,
    "logLevel": "info"
  }
}
EOF

# Create .env
cat > .env << 'EOF'
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3:latest
VOLE_LOG_LEVEL=info
VOLE_DASHBOARD_PORT=3001
EOF

# Create .gitignore
cat > .gitignore << 'EOF'
node_modules/
.env
.openvole/
.DS_Store
EOF

echo ""
echo "✅ OpenVole (basic) ready!"
echo ""
echo "   Includes: Brain (Ollama) + Memory + Dashboard"
echo ""
echo "   Make sure Ollama is running, then:"
echo "   npx vole start"
echo ""
echo "   Dashboard: http://localhost:3001"
