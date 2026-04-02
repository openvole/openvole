# Architecture

OpenVole follows a **microkernel architecture** — the core provides the agent loop and the plugin contract, nothing else. Everything useful (reasoning, memory, tools, channels, integrations) is a Paw or a Skill.

## System Diagram

```
                         vole start (CLI)
                     readline prompt (vole>)
                              |
                              v
┌──────────────────────────────────────────────────────────────────┐
│                         VoleEngine                               │
│                                                                  │
│   Tool Registry ──── Skill Registry ──── Paw Registry            │
│        |                   |                  |                  │
│   ┌──────────────────────────────────────────────────────┐       │
│   │                Agent Loop (per task)                  │       │
│   │                                                      │       │
│   │   BOOTSTRAP ─┐                                       │       │
│   │              ▼                                       │       │
│   │   PERCEIVE → COMPACT → THINK → ACT → OBSERVE → loop │       │
│   │       |         |        |       |        |          │       │
│   │   Enrich    Compress   Brain  Execute  Process       │       │
│   │   context   old msgs   plans  tools    results       │       │
│   │                                                      │       │
│   │            Context Budget Manager                    │       │
│   │        (token estimation, priority trimming)         │       │
│   └──────────────────────────────────────────────────────┘       │
│                                                                  │
│   Task Queue ──── Scheduler ──── Message Bus ──── Cost Tracker   │
│                                                                  │
│   VoleNet (optional)                                             │
│   ├── Transport (WebSocket + HTTP fallback)                      │
│   ├── Discovery (peer registry, health monitoring)               │
│   ├── Remote Task Manager (tool routing, delegation)             │
│   ├── Sync (memory + session propagation)                        │
│   └── Leader Election (heartbeat coordination)                   │
│                                                                  │
└──────┬──────────┬──────────┬──────────┬──────────────────────────┘
       |          |          |          |
  [Brain Paw] [Channel]  [Tools]   [In-Process]
   paw-brain  Telegram   Browser    Compact
   (unified)  Slack      Shell      Memory
              Discord    MCP        Session
                         Email      Dashboard
                         Database
                         Scraper
```

## The Agent Loop

The core of OpenVole — a 6-phase loop that runs per task:

```
Bootstrap ─┐
           ▼
Perceive → Compact → Think → Act → Observe → loop
```

| Phase | What happens | Runs |
|-------|-------------|------|
| **Bootstrap** | Paw hooks load persistent data (memory, session history). VoleNet context injected. | Once per task |
| **Perceive** | Paw hooks enrich context with dynamic data (time, calendar, unread messages). | Every iteration |
| **Compact** | Triggered when message count exceeds `compactThreshold`. Compresses old messages to free context space. | When needed |
| **Think** | Core builds system prompt, calculates token budget, trims by priority. Brain Paw calls LLM, returns `AgentPlan` (tool calls + optional response). | Every iteration |
| **Act** | Core executes tool calls (sequential or parallel). Applies rate limits. Remote tools route via VoleNet. | Every iteration |
| **Observe** | Paw hooks process results (update memory, log to session, notify channels). Session sync to VoleNet peers. | Every iteration |

The loop exits when:
- The Brain produces a final answer with no tool calls
- `maxIterations` is reached (resets on successful tool execution)
- The task is cancelled

### Context Budget

The `ContextBudgetManager` handles token-aware context management:

1. **Token estimation** — estimates token count for system prompt, tools, messages, session
2. **Priority trimming** — when context exceeds `maxContextTokens`, trims in order:
   - Old tool results (lowest priority — trimmed first)
   - Old error messages
   - Old assistant/brain messages
   - Session history
3. **Never trimmed** — system prompt, first user message, last 2 brain responses
4. **Response reserve** — `responseReserve` tokens kept for the Brain's output

### Tool Horizon

When `toolHorizon: true` (default), the Brain starts with only core tools visible. It discovers additional tools on demand via `discover_tools` with an intent query. This prevents context bloat when many paws are loaded — the Brain only sees tools relevant to the current task.

### Cost Tracking

The `CostTracker` records LLM token usage and cost per task:
- Tracks input/output tokens and cost per LLM call
- Supports per-provider pricing (cloud APIs vs local Ollama)
- `costAlertThreshold` warns when a single task exceeds a USD amount
- Configurable via `costTracking`: `"auto"`, `"enabled"`, `"disabled"`

## System Prompt

Core builds the system prompt — Brain Paws are thin API adapters that receive it pre-built via `context.systemPrompt`.

The prompt is assembled from:
1. **BRAIN.md** — custom system prompt (overrides default if present)
2. **Identity files** — SOUL.md, USER.md, AGENT.md
3. **Skills** — available skill summaries
4. **Tools** — tool descriptions and parameters
5. **Memory** — agent memory context
6. **VoleNet** — instance name, role, peer list with tools and brain status
7. **Date/time/platform** — dynamic context

## Paws

**Paws are subprocess-isolated plugins.** They connect OpenVole to the outside world — APIs, databases, browsers, messaging platforms. Each Paw runs in its own Node.js process with `--permission` sandbox.

Paws can:
- Register tools with the Tool Registry
- Register lifecycle hooks (`onBootstrap`, `onPerceive`, `onCompact`, `onObserve`)
- Inject context into the Brain's prompt via `context.metadata`
- Discover and register tools at runtime (late tool registration)

There are four categories of Paws:

| Category | Examples | Role |
|----------|----------|------|
| **Brain** | `paw-brain` (unified: Ollama, Claude, OpenAI, Gemini, xAI) | LLM reasoning via the Think phase |
| **Channel** | Telegram, Slack, Discord | Receive messages from external platforms |
| **Tool** | Browser, Shell, MCP, Database, Email, Scraper, Image | Tools the Brain can call |
| **Infrastructure** | Memory, Session, Compact, Dashboard | Lifecycle hooks and internal services |

### Paw Sandbox

Each Paw process is launched with Node.js `--permission` flags:
- **Filesystem** — restricted to `.openvole/paws/<name>/` plus explicitly allowed paths
- **Network** — restricted to explicitly allowed domains/IPs
- **Child processes** — blocked unless `childProcess: true`
- **Environment** — only explicitly listed env vars are passed

Optional Docker sandbox available for stronger isolation.

## Skills

**Skills are behavioral recipes.** A Skill is a folder with a `SKILL.md` file — no code, no build step. They tell the Brain _how_ to approach a task by providing instructions, not tools.

Skills activate based on available tools — a skill requiring `email_send` only loads when an email paw is present. The Brain sees a list of available skills and can load full instructions on demand using the `skill_read` tool.

## Tools

**Tools are the runtime abstraction.** Every action the Brain can take is a tool — whether it came from a Paw, from the core, from an MCP server, or from a remote VoleNet peer. The Brain doesn't know the difference.

### Built-in Core Tools

| Tool | Purpose |
|------|---------|
| `discover_tools` | Search available tools by intent (BM25 ranking) |
| `schedule_task` | Create recurring tasks at runtime |
| `cancel_schedule` / `list_schedules` | Manage schedules |
| `skill_read` | Load skill instructions on demand |
| `skill_read_reference` / `skill_list_files` | Access skill resources |
| `heartbeat_read` / `heartbeat_write` | Read/write recurring job definitions |
| `workspace_write` / `workspace_read` | Read/write agent scratch space |
| `workspace_list` / `workspace_delete` | List/delete workspace files |
| `vault_store` | Store a secret (write-once, with optional metadata) |
| `vault_get` / `vault_list` / `vault_delete` | Retrieve, list, or delete vault entries |
| `web_fetch` | Lightweight URL fetching (GET/POST with headers, body) |
| `spawn_agent` | Spawn a sub-agent with a named profile |
| `spawn_remote_agent` | Delegate a task to a remote VoleNet peer |
| `list_instances` | List connected VoleNet peers |
| `get_remote_result` | Check status of a remote task |

## VoleNet

**Distributed agent networking.** Connects multiple OpenVole instances across machines with Ed25519 authenticated communication.

Key capabilities:
- **Remote tool execution** — tools on remote peers appear in the local registry
- **Memory sync** — write propagation and remote search across peers
- **Session sync** — shared conversations across devices
- **Brain sharing** — brainless workers delegate thinking to a coordinator
- **Leader election** — automatic failover, heartbeat coordination
- **Load balancing** — tasks route to the least-loaded peer

See the [VoleNet documentation](/volenet) for architecture patterns and setup.

## Philosophy

> **If it connects to something, it's a Paw.**
> **If it describes behavior, it's a Skill.**
> **If the agent calls it, it's a Tool.**
> **If it's none of these, it probably doesn't belong in OpenVole.**
