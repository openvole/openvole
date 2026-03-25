# Getting Started

This guide walks you through creating your first OpenVole agent in under five minutes.

## Prerequisites

- **Node.js** 20 or later
- **npm** or **pnpm**
- An LLM provider (e.g., [Ollama](https://ollama.ai) running locally)

## Installation

Create a new directory and install OpenVole:

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install openvole
```

::: tip Global Install
For easier access, install globally with `npm install -g openvole` — then use `vole` directly instead of `npx vole`.
:::

## Initialize Your Agent

```bash
npx vole init
```

This creates the base `vole.config.json` and `.openvole/` directory structure.

## Add Paws

A fresh OpenVole installation has zero tools, zero skills, zero opinions. Add the Paws you need:

```bash
npx vole paw add @openvole/paw-ollama
npx vole paw add @openvole/paw-memory
npx vole paw add @openvole/paw-dashboard
```

## Configure

Edit `vole.config.json`:

```json
{
  "brain": "@openvole/paw-ollama",
  "paws": [
    {
      "name": "@openvole/paw-ollama",
      "allow": {
        "network": ["127.0.0.1"],
        "env": ["OLLAMA_HOST", "OLLAMA_MODEL"]
      }
    },
    {
      "name": "@openvole/paw-memory",
      "allow": { "env": ["VOLE_MEMORY_DIR"] }
    },
    {
      "name": "@openvole/paw-dashboard",
      "allow": { "listen": [3001], "env": ["VOLE_DASHBOARD_PORT"] }
    }
  ],
  "skills": [],
  "loop": { "maxIterations": 25, "compactThreshold": 50 }
}
```

Create a `.env` file with your LLM settings:

```
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3:latest
```

## Run Your Agent

Start the interactive agent loop:

```bash
npx vole start
```

Or run a single task in headless mode (no dashboard, no channels):

```bash
npx vole run "summarize my emails"
```

## Presets

Skip manual setup with a preset script:

```bash
# Basic (Brain + Memory + Dashboard)
curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/basic.sh | bash

# With Telegram
curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/telegram.sh | bash

# Everything
curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/full.sh | bash
```

## Next Steps

- [Configuration](/configuration) — All config options explained
- [Architecture](/architecture) — How the agent loop works
- [Paws](/paws) — Browse all 27 official Paws
- [Skills](/skills) — Add behavioral recipes from ClawHub
