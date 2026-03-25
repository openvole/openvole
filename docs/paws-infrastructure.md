# Infrastructure Paws

Infrastructure Paws provide lifecycle hooks and internal services. Unlike Tool Paws, they don't register tools the Brain calls directly — they operate behind the scenes to enrich context, manage state, and provide monitoring.

## Available Infrastructure Paws

### paw-memory

Persistent memory with source-isolated daily logs and BM25 ranked search.

```bash
npx vole paw add @openvole/paw-memory
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
npx vole paw add @openvole/paw-session
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
npx vole paw add @openvole/paw-compact
```

**Hooks**: `compact`

Runs as an **in-process** paw (not subprocess) for performance. When the message count exceeds `compactThreshold`, it:

1. Extracts key information from old messages (tool calls, results, responses, errors)
2. Replaces middle messages with a structured summary
3. Keeps the first message (original input) + recent N messages verbatim

No LLM needed — pure extraction. Fast and free.

### paw-dashboard

Real-time web UI showing paws, tools, skills, tasks, schedules, and live events.

```bash
npx vole paw add @openvole/paw-dashboard
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

The dashboard connects to the engine's message bus and displays real-time state updates — no polling.
