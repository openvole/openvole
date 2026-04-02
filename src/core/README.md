<p align="center">
  <img src="https://raw.githubusercontent.com/openvole/openvole/main/assets/vole.png" alt="OpenVole" width="200">
</p>

<h1 align="center">OpenVole</h1>

<p align="center">
  <strong>Micro-agent core. The smallest possible thing that other useful things can be built on top of.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/openvole"><img src="https://img.shields.io/npm/v/openvole" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

---

## What is OpenVole?

OpenVole is a **microkernel AI agent framework**. It provides the agent loop and the plugin contract — nothing else. Everything useful (reasoning, memory, tools, channels, integrations) is a **Paw** or a **Skill** built by the community.

A fresh OpenVole installation has zero tools, zero skills, zero opinions. This is by design.

## Quick Start

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install openvole
npx vole init
npx vole paw add @openvole/paw-brain
npx vole paw add @openvole/paw-memory
npx vole paw add @openvole/paw-dashboard
```

Edit `vole.config.json`:

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

Create `.env`:

```
BRAIN_PROVIDER=ollama
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
│                       VoleEngine                            │
│                                                             │
│   Tool Registry ──── Skill Registry ──── Paw Registry       │
│        |                   |                  |             │
│   ┌────────────────────────────────────────────────┐        │
│   │              Agent Loop (per task)             │        │
│   │                                                │        │
│   │   PERCEIVE ─── THINK ─── ACT ─── OBSERVE       │        │
│   │       |           |        |         |         │        │
│   │   Enrich      Brain    Execute   Process       │        │
│   │   context     plans    tools     results       │        │
│   │                                                │        │
│   └────────────────────────────────────────────────┘        │
│                                                             │
│   Task Queue ──── Scheduler ──── Message Bus                │
│                                                             │
└──────┬──────────┬──────────┬──────────┬─────────────────────┘
       |          |          |          |
  [Brain Paw] [Channel]  [Tools]   [In-Process]
   Ollama     Telegram   Browser    Compact
   Claude     Slack      Shell      Memory
   OpenAI     Discord    MCP        Session
   Gemini     WhatsApp   Email/Resend/GitHub/Calendar
   xAI
```

22 official Paws: 5 Brain, 4 Channel, 8 Tool, 4 Infrastructure.

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
npx vole paw add @openvole/paw-telegram
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

The Brain is a Paw — the core is LLM-ignorant. Use `@openvole/paw-brain` — a single unified brain paw that supports all providers:

- **Anthropic Claude** — `BRAIN_PROVIDER=anthropic`
- **OpenAI** — `BRAIN_PROVIDER=openai`
- **Google Gemini** — `BRAIN_PROVIDER=gemini`
- **xAI Grok** — `BRAIN_PROVIDER=xai`
- **Ollama (local)** — `BRAIN_PROVIDER=ollama`

> Legacy single-provider paws (`paw-ollama`, `paw-claude`, `paw-openai`, `paw-gemini`, `paw-xai`) are deprecated but still available.

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

Periodic wake-up — the Brain checks `HEARTBEAT.md` and decides what to do. No user input needed. Uses cron expressions:

```json
{ "heartbeat": { "enabled": true, "cron": "*/30 * * * *" } }
```

### Persistent Scheduling

Brain-created schedules use cron expressions and are stored in `.openvole/schedules.json`, surviving restarts. The heartbeat is recreated from config on each startup (intervalMinutes is auto-converted to cron).

```
"0 13 * * *"     — daily at 1 PM UTC
"*/30 * * * *"   — every 30 minutes
"0 9 * * 1"      — every Monday at 9 AM
```

### Memory (Source-Isolated)

Persistent memory with daily logs scoped by task source:

```
.openvole/paws/paw-memory/
├── MEMORY.md       # Shared long-term facts
├── user/           # CLI session logs
├── paw/            # Telegram/Slack logs
└── heartbeat/      # Heartbeat logs
```

### Sessions

Conversation continuity across messages. Auto-expiring transcripts per session ID. Session data lives in `.openvole/paws/paw-session/`, organized by session ID (e.g., `cli:default/`, `telegram:123/`).

### MCP Support

Bridge 1000+ community MCP servers into the tool registry via `paw-mcp`. MCP tools appear alongside Paw tools — the Brain doesn't know the difference.

- MCP tools are **auto-discovered at runtime** as MCP servers connect
- **Late tool registration** — tools appear after the engine starts, not at boot
- MCP config lives in `.openvole/paws/paw-mcp/servers.json` (not in the installed package)

Example `.openvole/paws/paw-mcp/servers.json`:

```json
{
  "servers": [
    {
      "name": "resend",
      "command": "npx",
      "args": ["-y", "resend-mcp"],
      "env": { "RESEND_API_KEY": "$RESEND_API_KEY" }
    }
  ]
}
```

### Late Tool Registration

Any Paw can discover and register tools at runtime using the `register_tools` mechanism — not just MCP. Tools registered this way appear in the tool registry like any other tool. This is a generic capability of the engine, not an MCP-specific feature.

### Local Paw Config

Each Paw has its own local config directory at `.openvole/paws/<name>/`. The installed npm package stays immutable — all user configuration lives in the local paw directory.

```
.openvole/paws/
├── paw-memory/     ← memory data (MEMORY.md, daily logs)
├── paw-session/    ← session transcripts
└── paw-mcp/        ← MCP config (servers.json)
```

Example: `paw-mcp` reads its `servers.json` from `.openvole/paws/paw-mcp/`, not from `node_modules/`.

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
| `BRAIN.md` | Custom system prompt — **overrides the default system prompt entirely** |
| `SOUL.md` | Agent personality and tone |
| `USER.md` | User profile and preferences |
| `AGENT.md` | Operating rules and constraints |

The Brain Paw (`paw-brain`) loads these on startup.

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

Real-time web UI — powered by `paw-dashboard`, another Paw you install like any other. Shows paws, tools, skills, tasks, schedules, and live events.

```bash
npx vole paw add @openvole/paw-dashboard
```

<p align="center">
  <img src="https://raw.githubusercontent.com/openvole/openvole/main/assets/example/paw-dashboard/paw-dashboard.png" alt="OpenVole Dashboard" width="800">
</p>

## Official Paws (22)

All paws live in [PawHub](https://github.com/openvole/pawhub) and are installed via npm.

### Brain (1 + 5 legacy)

| Paw | Purpose |
|-----|---------|
| `paw-brain` | **Unified multi-provider brain** (Anthropic, OpenAI, Gemini, xAI, Ollama) |
| `paw-ollama` | *(deprecated)* Local LLM via Ollama |
| `paw-claude` | *(deprecated)* Anthropic Claude models |
| `paw-openai` | *(deprecated)* OpenAI models |
| `paw-gemini` | *(deprecated)* Google Gemini models |
| `paw-xai` | *(deprecated)* xAI Grok models |

### Channel (4)

| Paw | Purpose |
|-----|---------|
| `paw-telegram` | Telegram bot channel |
| `paw-slack` | Slack bot channel |
| `paw-discord` | Discord bot channel |
| `paw-whatsapp` | WhatsApp bot channel |

### Tool (8)

| Paw | Purpose |
|-----|---------|
| `paw-browser` | Browser automation (Puppeteer) |
| `paw-shell` | Shell command execution |
| `paw-filesystem` | File system operations |
| `paw-mcp` | MCP server bridge |
| `paw-email` | Email sending |
| `paw-resend` | Email via Resend API |
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
npx vole paw add @openvole/paw-telegram
npx vole paw add @openvole/paw-browser
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
  "brain": "@openvole/paw-brain",
  "paws": ["@openvole/paw-brain", "@openvole/paw-memory"],
  "skills": ["clawhub/summarize"],
  "loop": { "maxIterations": 25, "compactThreshold": 50 },
  "heartbeat": { "enabled": false, "cron": "*/30 * * * *" },
  "toolProfiles": { "paw": { "deny": ["shell_exec"] } }
}
```

## OpenClaw Compatibility

OpenVole loads [OpenClaw](https://openclaw.ai) skills natively — same `SKILL.md` format, same `metadata.openclaw.requires` fields. Install directly from [ClawHub](https://clawhub.ai):

```bash
npx vole clawhub install summarize
```

## .openvole Directory Structure

```
.openvole/
├── paws/
│   ├── paw-memory/          ← memory data
│   │   ├── MEMORY.md
│   │   └── user/, paw/, heartbeat/
│   ├── paw-session/         ← session transcripts
│   │   └── cli:default/, telegram:123/
│   └── paw-mcp/             ← MCP config
│       └── servers.json
├── workspace/               ← agent scratch space
├── skills/                  ← local and clawhub skills
├── vault.json               ← encrypted key-value store
├── schedules.json           ← persistent cron schedules
├── BRAIN.md                 ← custom system prompt
├── SOUL.md                  ← agent personality
├── USER.md                  ← user profile
├── AGENT.md                 ← operating rules
└── HEARTBEAT.md             ← recurring job definitions
```

## OpenVole vs OpenClaw

Both are open-source AI agent frameworks. Different philosophies, many shared concepts.

| | OpenVole | OpenClaw |
|---|---|---|
| **Philosophy** | Microkernel — empty core, everything is a plugin | Batteries-included — 25 built-in tools |
| **Core size** | ~60KB | ~8MB |
| **Skills** | SKILL.md (same format, compatible) | SKILL.md |
| **Skill marketplace** | ClawHub-compatible (`vole clawhub install`) | ClawHub (13K+ skills) |
| **Skill loading** | Progressive on-demand | Progressive on-demand |
| **Brain/LLM** | External Paw — core is LLM-ignorant | Configurable provider in core |
| **Brain options** | Unified paw-brain (Ollama, Claude, OpenAI, Gemini, xAI) | Multi-provider with fallback chains |
| **Heartbeat** | HEARTBEAT.md + cron | HEARTBEAT.md + cron |
| **Memory** | Source-isolated (user/paw/heartbeat scoped) | Shared (no source isolation) |
| **Identity files** | BRAIN.md, SOUL.md, USER.md, AGENT.md | SOUL.md, USER.md, AGENTS.md |
| **MCP support** | Via Paw with auto-discovery + late registration | Native in core |
| **Channels** | 4 (Telegram, Slack, Discord, WhatsApp) | 20+ (WhatsApp, iMessage, Signal, etc.) |
| **Plugin isolation** | Subprocess sandbox + capability permissions | Optional Docker sandbox |
| **Tool profiles** | Per-source deny/allow lists | Channel sandboxing |
| **Scheduling** | Cron-based, persistent, Brain-initiated | Cron + heartbeat |
| **Sessions** | Per-session transcripts with auto-expiry | Built-in session keys |
| **Vault** | AES-256 encrypted, write-once, metadata | N/A (env vars) |
| **Dashboard** | Real-time web UI | Gateway web UI |
| **CLI** | `vole` (start/run/tool call/clawhub/skill) | `openclaw` |
| **Config** | Single JSON file | Single JSON file |

OpenVole is a newborn — a tiny vole just getting started. We share the same skill format, the same heartbeat pattern, and the same MCP ecosystem as OpenClaw. Skills written for one work on the other.

We're building something small, modular, and community-driven. If you like the microkernel approach — where every piece is a Paw you can swap, extend, or build yourself — come join us. Try it out, build a Paw, write a Skill, break things, and help this little vole grow.

## Philosophy

> **If it connects to something, it's a Paw.**
> **If it describes behavior, it's a Skill.**
> **If the agent calls it, it's a Tool.**
> **If it's none of these, it probably doesn't belong in OpenVole.**

## License

[MIT](LICENSE)
