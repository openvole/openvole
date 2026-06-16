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

## Start the Dashboard

OpenVole runs as a server. Pick a directory to hold your agents and start the **control-plane dashboard** there:

```bash
mkdir ~/agents && cd ~/agents
npx vole serve
```

An empty directory becomes a new OpenVole **root**. `vole serve` prints the resolved root and a URL (default `http://localhost:3000`); set `VOLE_HOME` to pin a fixed root from anywhere. Then click **New space** to create your first agent — the onboarding step installs the essential paws for you. See the [Dashboard guide](/dashboard).

## Add Paws

The new-space onboarding installs the essentials. To add more paws, use the space's **Config** tab — or run `vole paw add` inside the space's directory:

```bash
npx vole paw add @openvole/paw-brain
npx vole paw add @openvole/paw-memory
```

## Configure

Edit the space's config from the **Config** tab (structured fields). Under the hood, its `vole.config.json` looks like:

```json
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
      "allow": { "env": ["VOLE_MEMORY_DIR"] }
    }
  ],
  "skills": [],
  "loop": { "maxIterations": 25, "compactThreshold": 50 }
}
```

Create a `.env` file with your LLM settings:

```
BRAIN_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3:latest
```

## Run Your Agent

The primary way to run and operate OpenVole is the **control-plane dashboard** — one web server that manages all your agents from the browser:

```bash
npx vole serve
```

This opens a dashboard at `http://localhost:3000` where you create, start, stop, and chat with your agents — each an isolated "space" with its own config, paws, and data. See the [Dashboard guide](/dashboard) for spaces, root resolution, and embedded Apps panels.

::: tip Where does it run?
`vole serve` uses the current directory as your OpenVole root if it's empty (or already a root). Pick a home for your agents and run it there — e.g. `mkdir ~/agents && cd ~/agents && npx vole serve`. Set `VOLE_HOME` to pin a fixed root from anywhere.
:::

## Presets

Skip manual setup with a preset script — each creates an OpenVole root with a ready-to-run space:

```bash
# Basic (Brain + Memory + Session + Compact + Shell)
curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/basic.sh | bash

# With Telegram
curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/telegram.sh | bash

# Everything
curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/full.sh | bash
```

## Next Steps

- [Dashboard](/dashboard) — Manage all your agents with `vole serve`
- [Configuration](/configuration) — All config options explained
- [Architecture](/architecture) — How the agent loop works
- [Paws](/paws) — Browse all 27 official Paws
- [Skills](/skills) — Add behavioral recipes from ClawHub
