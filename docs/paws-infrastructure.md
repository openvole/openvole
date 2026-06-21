# Infrastructure Paws

Infrastructure Paws provide lifecycle hooks and internal services. Unlike Tool Paws, they don't register tools the Brain calls directly — they operate behind the scenes to enrich context, manage state, and provide monitoring.

## Available Infrastructure Paws

### paw-memory

Persistent memory with source-isolated daily logs and BM25 ranked search.

```bash
vole paw add @openvole/paw-memory
```

**Hooks**: `bootstrap`, `observe`

**Storage structure**:

```
.openvole/paws/paw-memory/
├── MEMORY.md       # Shared long-term facts
├── user/           # CLI session logs
├── paw/            # Telegram/Slack logs
└── heartbeat/      # Heartbeat logs
```

Memory is scoped by task source — CLI conversations, channel messages, and heartbeat tasks each get their own daily logs. This prevents cross-contamination between sources.

**Tools**: `memory_search` — BM25 ranked search over all memory files.

### paw-session

Conversation continuity across messages. Auto-expiring transcripts per session ID.

```bash
vole paw add @openvole/paw-session
```

**Hooks**: `bootstrap`, `observe`

Session data lives in `.openvole/paws/paw-session/`, organized by session ID:

```
.openvole/paws/paw-session/
├── cli:default/     # CLI session transcript
├── telegram:123/    # Telegram chat transcript
└── slack:C456/      # Slack channel transcript
```

The session paw loads previous messages from the current session during bootstrap, giving the Brain conversation context.

### paw-compact

Context compaction — summarizes old messages when context grows too large.

```bash
vole paw add @openvole/paw-compact
```

**Hooks**: `compact`

Runs as an **in-process** paw (not subprocess) for performance. When the message count exceeds `compactThreshold`, it:

1. Extracts key information from old messages (tool calls, results, responses, errors)
2. Replaces middle messages with a structured summary
3. Keeps the first message (original input) + recent N messages verbatim

No LLM needed — pure extraction. Fast and free.

### paw-dashboard (deprecated)

> [!WARNING]
> `@openvole/paw-dashboard` is **deprecated** in favor of [`vole serve`](/dashboard) — the control-plane dashboard that manages *all* your agents from one web server. It still works but logs a deprecation warning on load and will be removed in a future release. Use `vole serve` for a UI instead.

The legacy single-engine web **control panel** — monitor *and operate* one agent from your browser: paws (with health), tools, skills, tasks, schedules, and live events, plus editing config and identity files and restarting the engine.

```bash
vole paw add @openvole/paw-dashboard
```

| Env Variable | Purpose |
|-------------|---------|
| `VOLE_DASHBOARD_PORT` | Port for the dashboard (default: 3001) |

Configuration:

```json
{
  "name": "@openvole/paw-dashboard",
  "allow": {
    "listen": [3001],
    "env": ["VOLE_DASHBOARD_PORT"]
  }
}
```

The dashboard connects to the engine's message bus and streams state updates over WebSocket — no polling. It's a full control panel, not just a viewer:

- **Config editor** — edit `vole.config.json` across 8 sections (brain, heartbeat, loop, security/Docker, paws, tool profiles, agents, net)
- **Identity editor** — edit `SOUL.md`, `USER.md`, `AGENT.md`, `HEARTBEAT.md`, and `BRAIN.md`
- **One-click restart** — apply config/identity changes in-process, no terminal needed
- **Live event log** — task lifecycle, paw/tool registration, crashes, rate limits, VoleNet executions

## Embedded Dashboard Panels

Any paw — not just infrastructure paws — can ship its own UI that appears under the dashboard's **Apps** tab, with no per-paw web server and no extra port. See **[Build an Embedded App](/paws#build-an-embedded-app)** for the how-to; [`@openvole/paw-markets`](/dashboard#apps-embedded-paw-panels) is the reference example.
