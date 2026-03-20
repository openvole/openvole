# OpenVole

**Micro-agent core. The smallest possible thing that other useful things can be built on top of.**

[![npm](https://img.shields.io/npm/v/openvole)](https://www.npmjs.com/package/openvole)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What is OpenVole?

OpenVole is a **microkernel AI agent framework**. It provides the agent loop and the plugin contract — nothing else. Everything useful (reasoning, memory, tools, channels, integrations) is a **Paw** or a **Skill** built by the community.

A fresh OpenVole installation has zero tools, zero skills, zero opinions. This is by design.

## Quick Start

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install openvole @openvole/paw-ollama @openvole/paw-memory @openvole/paw-dashboard
npx vole init
```

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
  "loop": { "maxIterations": 10, "logLevel": "info" }
}
```

Create `.env`:

```
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3:latest
```

Run:

```bash
npx vole start
```

Or use a preset:

```bash
# Basic (Brain + Memory + Dashboard)
curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/basic.sh | bash

# With Telegram
curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/telegram.sh | bash

# Everything
curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/full.sh | bash
```

## Architecture

```
                         vole start (CLI)
                     readline prompt (vole>)
                              |
                              v
┌─────────────────────────────────────────────────────────────┐
│                       VoleEngine                             │
│                                                              │
│   Tool Registry ──── Skill Registry ──── Paw Registry        │
│        |                   |                  |              │
│   ┌────────────────────────────────────────────────┐        │
│   │              Agent Loop (per task)              │        │
│   │                                                 │        │
│   │   PERCEIVE ─── THINK ─── ACT ─── OBSERVE       │        │
│   │       |           |        |         |          │        │
│   │   Enrich      Brain    Execute   Process        │        │
│   │   context     plans    tools     results        │        │
│   │                                                 │        │
│   └─────────────────────────────────────────────────┘        │
│                                                              │
│   Task Queue ──── Scheduler ──── Message Bus                 │
│                                                              │
└──────┬──────────┬──────────┬──────────┬──────────────────────┘
       |          |          |          |
  [Brain Paw] [Channel]  [Tools]   [In-Process]
   Ollama     Telegram   Browser    Compact
   Claude     Slack      Shell      Memory
   OpenAI     Discord    MCP
   Gemini     WhatsApp   Email/GitHub/Calendar
```

19 official Paws: 4 Brain, 4 Channel, 7 Tool, 4 Infrastructure.

## Core Concepts

### The Agent Loop

The only thing OpenVole does natively:

```
Perceive → Think → Act → Observe → loop
```

| Phase | What happens |
|-------|-------------|
| **Perceive** | Paws inject context (memory, time, calendar) |
| **Think** | Brain Paw calls the LLM, returns a plan |
| **Act** | Core executes tool calls from the plan |
| **Observe** | Paws process results (log, update memory, notify) |

### Paws

**Paws are tool providers.** They connect OpenVole to the outside world — APIs, databases, browsers, messaging platforms. Each Paw runs in an isolated subprocess with capability-based permissions.

```bash
npm install @openvole/paw-telegram
```

### Skills

**Skills are behavioral recipes.** A skill is a folder with a `SKILL.md` file — no code, no build step. Compatible with [ClawHub](https://clawhub.ai) (13,000+ skills).

```bash
npx vole clawhub install summarize
```

```markdown
---
name: summarize
description: "Summarize text, articles, or documents"
---
When asked to summarize content:
1. Identify the key points
2. Condense into 3-5 bullet points
...
```

### Brain Paw

The Brain is a Paw — the core is LLM-ignorant. Swap models by swapping Brain Paws:

- `@openvole/paw-ollama` — local models via Ollama
- `@openvole/paw-claude` — Anthropic Claude models
- `@openvole/paw-openai` — OpenAI models
- `@openvole/paw-gemini` — Google Gemini models

## Features

### Built-in Core Tools

| Tool | Purpose |
|------|---------|
| `schedule_task` | Brain creates recurring tasks at runtime |
| `cancel_schedule` / `list_schedules` | Manage schedules (persistent across restarts) |
| `skill_read` | Load skill instructions on demand |
| `skill_read_reference` / `skill_list_files` | Access skill resources |
| `heartbeat_read` / `heartbeat_write` | Manage recurring jobs |
| `workspace_write` / `workspace_read` | Read/write files in agent scratch space |
| `workspace_list` / `workspace_delete` | List/delete workspace files |
| `vault_store` | Store a secret (write-once, with optional metadata) |
| `vault_get` / `vault_list` / `vault_delete` | Retrieve, list, or delete vault entries |
| `web_fetch` | Lightweight URL fetching (GET/POST with headers, body) |

### Heartbeat

Periodic wake-up — the Brain checks `HEARTBEAT.md` and decides what to do. No user input needed.

```json
{ "heartbeat": { "enabled": true, "intervalMinutes": 30 } }
```

### Persistent Scheduling

Brain-created schedules are stored in `.openvole/schedules.json` and survive restarts. The heartbeat is recreated from config on each startup.

### Memory (Source-Isolated)

Persistent memory with daily logs scoped by task source:

```
.openvole/memory/
├── MEMORY.md       # Shared long-term facts
├── user/           # CLI session logs
├── paw/            # Telegram/Slack logs
└── heartbeat/      # Heartbeat logs
```

### Sessions

Conversation continuity across messages. Auto-expiring transcripts per session ID.

### MCP Support

Bridge 1000+ MCP servers into the tool registry via `paw-mcp`. MCP tools appear alongside Paw tools — the Brain doesn't know the difference.

### Rate Limiting

Prevent runaway costs with configurable limits on LLM calls, tool executions, and task enqueue rates.

### Tool Profiles

Per-source tool filtering — restrict what Telegram users can trigger:

```json
{ "toolProfiles": { "paw": { "deny": ["shell_exec", "fs_write"] } } }
```

### Identity Files

Customize agent behavior with optional markdown files in `.openvole/`:

| File | Purpose |
|------|---------|
| `BRAIN.md` | Custom system prompt (overrides default) |
| `SOUL.md` | Agent personality and tone |
| `USER.md` | User profile and preferences |
| `AGENT.md` | Operating rules and constraints |

All Brain Paws (Ollama, Claude, OpenAI, Gemini) load these on startup.

### Workspace

Agent scratch space at `.openvole/workspace/` — for files, drafts, API docs, downloaded content. Path traversal protected. Tools: `workspace_write`, `workspace_read`, `workspace_list`, `workspace_delete`.

### Vault

Encrypted key-value store at `.openvole/vault.json`:

- **AES-256-GCM encryption** when `VOLE_VAULT_KEY` is set
- **Write-once semantics** — prevents hallucination overwrites
- **Metadata support** — attach service, handle, URL context to entries
- `vault_list` never exposes values

### Web Fetch

Lightweight URL fetching via the `web_fetch` core tool — GET/POST with custom headers and body. No browser Paw needed for simple HTTP requests.

### Context Compaction

When context grows too large, `paw-compact` summarizes old messages while preserving recent context. No LLM needed — pure extraction.

### Dashboard

Real-time web UI at `localhost:3001` — paws, tools, skills, tasks, schedules, live events.

## Official Paws (19)

All paws live in [PawHub](https://github.com/openvole/pawhub) and are installed via npm.

### Brain (4)

| Paw | Purpose |
|-----|---------|
| `paw-ollama` | Local LLM via Ollama |
| `paw-claude` | Anthropic Claude models |
| `paw-openai` | OpenAI models |
| `paw-gemini` | Google Gemini models |

### Channel (4)

| Paw | Purpose |
|-----|---------|
| `paw-telegram` | Telegram bot channel |
| `paw-slack` | Slack bot channel |
| `paw-discord` | Discord bot channel |
| `paw-whatsapp` | WhatsApp bot channel |

### Tool (7)

| Paw | Purpose |
|-----|---------|
| `paw-browser` | Browser automation (Puppeteer) |
| `paw-shell` | Shell command execution |
| `paw-filesystem` | File system operations |
| `paw-mcp` | MCP server bridge |
| `paw-email` | Email sending |
| `paw-github` | GitHub integration |
| `paw-calendar` | Calendar integration |

### Infrastructure (4)

| Paw | Purpose |
|-----|---------|
| `paw-memory` | Persistent memory with source isolation |
| `paw-session` | Session/conversation management |
| `paw-compact` | Context compaction (in-process) |
| `paw-dashboard` | Real-time web dashboard |

Install from npm:

```bash
npm install @openvole/paw-telegram @openvole/paw-browser
```

## CLI

```bash
npx vole init                              # Initialize project
npx vole start                             # Start agent (interactive)
npx vole run "summarize my emails"         # Single task

npx vole paw add @openvole/paw-telegram    # Install a Paw
npx vole paw list                          # List loaded Paws

npx vole skill create email-triage         # Create a local skill
npx vole clawhub install summarize         # Install from ClawHub
npx vole clawhub search email              # Search ClawHub

npx vole tool list                         # List all tools
npx vole tool call list_schedules          # Call a tool directly (no Brain)
```

## Security

| Concern | Approach |
|---------|----------|
| Paw isolation | Subprocess sandbox — Paws can't escape |
| Credentials | Each Paw owns its secrets — core never sees them |
| Runaway agent | maxIterations + rate limiting + confirmBeforeAct |
| Channel safety | Tool profiles restrict tools per task source |
| Permissions | Intersection of manifest requests and config grants |
| Filesystem sandbox | `sandboxFilesystem` + `allowedPaths` restrict file access |

```json
{ "security": { "sandboxFilesystem": true, "allowedPaths": ["/home/user/projects"] } }
```

## Configuration

Single `vole.config.json` — plain JSON, no imports:

```json
{
  "brain": "@openvole/paw-ollama",
  "paws": ["@openvole/paw-ollama", "@openvole/paw-memory"],
  "skills": ["clawhub/summarize"],
  "loop": { "maxIterations": 10, "logLevel": "info" },
  "heartbeat": { "enabled": false, "intervalMinutes": 30 },
  "toolProfiles": { "paw": { "deny": ["shell_exec"] } }
}
```

## OpenClaw Compatibility

OpenVole loads [OpenClaw](https://openclaw.ai) skills natively — same `SKILL.md` format, same `metadata.openclaw.requires` fields. Install directly from [ClawHub](https://clawhub.ai):

```bash
npx vole clawhub install summarize
```

## Philosophy

> **If it connects to something, it's a Paw.**
> **If it describes behavior, it's a Skill.**
> **If the agent calls it, it's a Tool.**
> **If it's none of these, it probably doesn't belong in OpenVole.**

## License

[MIT](LICENSE)
