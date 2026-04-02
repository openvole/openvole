# Context Management

How OpenVole builds, enriches, and compresses the context that the Brain sees on every iteration.

## Pluggable by Design

This document describes OpenVole's official context pipeline. The core defines **when** each phase runs — the **how** is implemented by Paws.

Every phase in the pipeline is handled by a Paw that you can replace with your own implementation:

| Phase | Default Paw | What you can replace it with |
|-------|-------------|------------------------------|
| Memory | `paw-memory` (BM25 file search) | Vector database, RAG pipeline, external knowledge base |
| Session | `paw-session` (file-based transcripts) | Redis, database-backed sessions, shared sessions |
| Compaction | `paw-compact` (rule-based extraction) | LLM-based summarization, lossless DAG, sliding window |
| Brain | `paw-brain` (unified multi-provider) | Any LLM provider, custom inference, local models |

Install your custom paw, add it to `vole.config.json`, and the core uses it — no core changes needed. This is the microkernel approach: the core provides the lifecycle, paws provide the behavior.

## Context Flow

```
User Input / Heartbeat / Telegram / API
    ↓
┌─────────────────────────────────────┐
│  Bootstrap (once per task)          │
│  • paw-memory: load MEMORY.md      │
│    + today/yesterday logs           │
│  • paw-session: load session        │
│    history for this session ID      │
│  • VoleNet: inject instance name,   │
│    role, leader status, peer list   │
│    with tools and brain capability  │
│  • Any paw with bootstrap hook      │
└──────────────┬──────────────────────┘
               ↓
      ┌── Loop iteration ──┐
      ↓                    │
┌─────────────────────────────────────┐
│  Perceive (every iteration)         │  ← Paws can inject/modify context
│  • Runs all perceive hooks          │
│  • Paws read/write                  │
│    context.metadata                 │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  Compact (if threshold hit)         │
│  • paw-compact: summarize old       │
│    messages, keep recent N          │
│  • paw-memory: auto-extract key     │
│    patterns from conversation       │
│  • Runs AFTER perceive so           │
│    compaction sees everything       │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  Context Budget (before Think)      │
│  • Estimate tokens: system prompt   │
│    + tools + session + messages     │
│  • Trim by priority if over budget: │
│    1. Old tool results (first)      │
│    2. Old errors                    │
│    3. Old brain messages            │
│    4. Session history               │
│  • Never trim: system prompt,       │
│    first user message, last 2       │
│    brain responses                  │
│  • Reserve responseReserve tokens   │
│    for Brain output                 │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  Think (Brain)                      │
│  • buildSystemPrompt() reads:       │
│    - BRAIN.md (system prompt)       │
│    - Identity files (SOUL.md,       │
│      USER.md, AGENT.md)             │
│    - context.metadata.memory        │
│    - context.metadata               │
│      .sessionHistory                │
│    - Available tools + skills       │
│    - VoleNet peers + capabilities   │
│    - Runtime context (date,         │
│      time, platform)                │
│  • Brain receives pre-trimmed       │
│    context via context.systemPrompt │
│  • Sends to LLM → gets AgentPlan   │
│  • Cost tracker records tokens/cost │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  Act (execute tool calls)           │
│  • Sequential or parallel execution │
│  • Rate limiter enforces limits     │
│  • Remote tools route via VoleNet   │
│    (transparent to the Brain)       │
│  • Tool Horizon: discover_tools     │
│    reveals additional tools         │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  Observe (after each iteration)     │
│  • Runs all observe hooks           │
│  • paw-session: save transcript     │
│  • paw-memory: auto-extract         │
│    patterns from tool results       │
│  • VoleNet: propagate session       │
│    entries to peers (if enabled)    │
│  • Paws can react to results        │
└──────────────┬──────────────────────┘
               ↓
          Next iteration ───┘
```

## How Paws Inject Context

Any paw can enrich the Brain's context by registering hooks and writing to `context.metadata`:

### Bootstrap Hook (once per task)

Runs once when a task starts. Use for loading persistent data.

```typescript
// In your paw's hook handler
async function onBootstrap(context) {
  const data = await loadMyData()
  context.metadata.myCustomData = data
}
```

### Perceive Hook (every iteration)

Runs before every think() call. Use for dynamic context that changes per iteration.

```typescript
async function onPerceive(context) {
  context.metadata.currentWeather = await fetchWeather()
}
```

### Observe Hook (after each iteration)

Runs after think() + act(). Use for recording results.

```typescript
async function onObserve(context) {
  await saveToTranscript(context.messages)
}
```

### Compact Hook (when threshold hit)

Runs when message count exceeds `compactThreshold`. Use for compressing conversation history.

```typescript
async function onCompact(context) {
  // Replace old messages with a summary
  const summary = extractKeyInfo(context.messages)
  context.messages = [context.messages[0], summary, ...context.messages.slice(-10)]
}
```

## What the Brain Sees

The Brain receives a single system prompt assembled by core from:

1. **BRAIN.md** — the base prompt (from `.openvole/paws/<brain>/BRAIN.md`)
2. **Runtime context** — current date, time, platform
3. **Identity files** — SOUL.md, USER.md, AGENT.md (personality, user profile, rules)
4. **Session history** — previous messages from this session (from `context.metadata.sessionHistory`)
5. **Memory** — relevant memory entries (from `context.metadata.memory`)
6. **Active skills** — compact list of available skills with descriptions
7. **Available tools** — all registered tools with parameter schemas (filtered by Tool Horizon)
8. **VoleNet context** — instance name, role, leader status, connected peers with tools and brain status
9. **Custom metadata** — anything paws injected via hooks into `context.metadata`

The Brain doesn't know where this context came from. It just sees a prompt, tools, and messages. Remote VoleNet tools appear identical to local tools.

## Context Budget Manager

The `ContextBudgetManager` ensures the Brain never exceeds its context window. It runs before every Think phase:

1. **Estimate** — calculates token count for system prompt, tools, session, messages, errors
2. **Compare** — checks total against `maxContextTokens` (default 128K)
3. **Trim** — if over budget, removes lowest-priority content first:

| Priority | Content | Action |
|----------|---------|--------|
| Lowest | Old tool results | Trimmed first |
| Low | Old error messages | Trimmed second |
| Medium | Old brain messages | Trimmed third |
| High | Session history | Trimmed last |
| Never | System prompt, first user message, last 2 brain responses | Never trimmed |

4. **Reserve** — keeps `responseReserve` (default 4000) tokens free for the Brain's output

The budget runs independently of compaction — compaction reduces message count, budget reduces token count. Both can trigger in the same iteration.

## Tool Horizon

When `toolHorizon: true` (default), the Brain starts with only core tools visible:

- `discover_tools`, `schedule_task`, `skill_read`, `heartbeat_read`, `vault_store`, `web_fetch`, etc.
- Paw-provided tools are hidden until the Brain searches for them via `discover_tools`
- `discover_tools` uses BM25 ranking to find tools matching the Brain's intent query
- This prevents context bloat — a 30-tool setup only shows ~10 core tools until needed

VoleNet remote tools also follow Tool Horizon — they're discovered via `discover_tools` with intent.

## Compaction

When the message history exceeds `compactThreshold` (configurable in `vole.config.json`), the compact hook fires after perceive and before think — so the Brain always sees compressed context.

### Rule-Based (paw-compact default)

- Extracts key information from old messages (tool calls, results, responses, errors)
- Replaces middle messages with a structured summary
- Keeps first message (original input) + recent N messages (default 10) verbatim
- No LLM needed — pure extraction
- Fast and free

### LLM-Based (optional, via VOLE_COMPACT_MODEL)

When `VOLE_COMPACT_MODEL` is explicitly set, paw-compact uses an LLM to generate higher-quality summaries:

- Sends old messages to the compact model for summarization
- Produces more coherent context than rule-based extraction
- Uses a separate model to avoid consuming the main Brain's context
- Only activates with explicit configuration — not auto-detected

### Memory Auto-Extraction

During compaction, `paw-memory` automatically extracts key patterns from the conversation:

- Important facts, decisions, and outcomes
- Tool results worth remembering
- Saved to daily log files for future reference
- No explicit `memory_write` needed — extraction is automatic

## Memory Search

**paw-memory** provides BM25 ranked search over memory files:

- Daily logs scoped by source (user, paw, heartbeat)
- MEMORY.md for persistent facts
- `memory_search` returns results ranked by relevance score
- VoleNet: `memory_search` queries all peers in parallel when `share.memory` is enabled, results merge with deduplication

## VoleNet Context

When VoleNet is enabled, the system prompt includes a VoleNet section visible to the Brain:

```
## VoleNet (Distributed Agent Network)
This instance: **devops-coord** (coordinator, leader)
Connected peers:
- **us-monitor** (worker, no brain) — shell_exec
- **eu-monitor** (worker, no brain) — shell_exec

Remote peer tools are available directly — call them like local tools.
When multiple peers share the same tool, use `<peerName>/<toolName>` to target a specific peer.
IMPORTANT: `spawn_remote_agent` only works on peers that have a brain.
```

This gives the Brain awareness of the distributed topology so it can make informed decisions about which tools to call and where.

## Adding Your Own Context

To build a paw that injects custom context:

1. Register a `bootstrap` or `perceive` hook in your paw
2. Write data to `context.metadata.yourKey`
3. The Brain paw reads metadata and includes it in the system prompt

No core changes needed — this is how paw-memory and paw-session work.
