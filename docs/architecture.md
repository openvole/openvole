# Architecture

OpenVole follows a **microkernel architecture** — the core provides the agent loop and the plugin contract, nothing else. Everything useful (reasoning, memory, tools, channels, integrations) is a Paw or a Skill.

## System Diagram

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

## The Agent Loop

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

The loop runs until the Brain produces a final answer with no tool calls, or `maxIterations` is reached.

## Paws

**Paws are tool providers.** They connect OpenVole to the outside world — APIs, databases, browsers, messaging platforms. Each Paw runs in an isolated subprocess with capability-based permissions.

Paws can:
- Register tools with the Tool Registry
- Register lifecycle hooks (bootstrap, perceive, compact, think, act, observe)
- Inject context into the Brain's prompt via `context.metadata`
- Discover and register tools at runtime (late tool registration)

There are four categories of Paws:

| Category | Examples | Role |
|----------|----------|------|
| **Brain** | Ollama, Claude, OpenAI, Gemini, xAI | Provide the LLM that powers the Think phase |
| **Channel** | Telegram, Slack, Discord, WhatsApp, Teams, Voice Call | Receive messages from external platforms |
| **Tool** | Browser, Shell, MCP, GitHub, Email | Provide tools the Brain can call |
| **Infrastructure** | Memory, Session, Compact, Dashboard | Lifecycle hooks and internal services |

## Skills

**Skills are behavioral recipes.** A Skill is a folder with a `SKILL.md` file — no code, no build step. They tell the Brain _how_ to approach a task by providing instructions, not tools.

Skills are loaded progressively — the Brain sees a list of available skills and can load full instructions on demand using the `skill_read` tool.

## Tools

**Tools are the runtime abstraction.** Every action the Brain can take is a tool — whether it came from a Paw, from the core, or from an MCP server. The Brain doesn't know the difference.

### Built-in Core Tools

| Tool | Purpose |
|------|---------|
| `schedule_task` | Brain creates recurring tasks at runtime |
| `cancel_schedule` / `list_schedules` | Manage schedules |
| `skill_read` | Load skill instructions on demand |
| `skill_read_reference` / `skill_list_files` | Access skill resources |
| `heartbeat_read` / `heartbeat_write` | Manage recurring jobs |
| `workspace_write` / `workspace_read` | Read/write files in agent scratch space |
| `workspace_list` / `workspace_delete` | List/delete workspace files |
| `vault_store` | Store a secret (write-once, with optional metadata) |
| `vault_get` / `vault_list` / `vault_delete` | Retrieve, list, or delete vault entries |
| `web_fetch` | Lightweight URL fetching (GET/POST with headers, body) |

## Philosophy

> **If it connects to something, it's a Paw.**
> **If it describes behavior, it's a Skill.**
> **If the agent calls it, it's a Tool.**
> **If it's none of these, it probably doesn't belong in OpenVole.**
