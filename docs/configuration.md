# Configuration

OpenVole uses a single `vole.config.json` file at the project root — plain JSON, no imports, no build step.

## Full Example

```json
{
  "brain": "@openvole/paw-brain",
  "paws": [
    { "name": "@openvole/paw-brain", "allow": { "network": ["*"], "env": ["BRAIN_PROVIDER", "BRAIN_API_KEY", "BRAIN_MODEL", "OLLAMA_HOST", "OLLAMA_MODEL", "OLLAMA_API_KEY"] } },
    { "name": "@openvole/paw-memory", "allow": { "network": ["*"] } },
    { "name": "@openvole/paw-session" },
    { "name": "@openvole/paw-compact" },
    { "name": "@openvole/paw-telegram", "allow": { "network": ["*"], "env": ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOW_FROM"] } },
    { "name": "@openvole/paw-shell", "allow": { "filesystem": ["./"], "env": ["VOLE_SHELL_ALLOWED_DIRS"], "childProcess": true } },
    { "name": "@openvole/paw-dashboard", "allow": { "listen": [3001], "env": ["VOLE_DASHBOARD_PORT"] } }
  ],
  "skills": ["clawhub/summarize"],
  "loop": {
    "maxIterations": 25,
    "confirmBeforeAct": false,
    "taskConcurrency": 1,
    "compactThreshold": 50,
    "toolHorizon": true,
    "maxContextTokens": 128000,
    "responseReserve": 4000,
    "costTracking": "auto",
    "costAlertThreshold": 1.00,
    "rateLimits": {
      "llmCallsPerMinute": 30,
      "llmCallsPerHour": 500,
      "toolExecutionsPerTask": 100,
      "tasksPerHour": { "telegram": 20, "cli": 100 }
    }
  },
  "heartbeat": {
    "enabled": true,
    "intervalMinutes": 30,
    "runOnStart": false
  },
  "toolProfiles": {
    "telegram": { "deny": ["shell_exec", "fs_write", "fs_delete"] },
    "heartbeat": { "allow": ["memory_search", "memory_write", "telegram_send", "shell_exec"] }
  },
  "security": {
    "sandboxFilesystem": true,
    "allowedPaths": ["/home/user/projects"],
    "docker": {
      "enabled": false,
      "image": "node:20-slim",
      "memory": "512m",
      "cpus": "1.0",
      "scope": "session",
      "network": "none"
    }
  },
  "agents": {
    "researcher": {
      "role": "Research assistant",
      "instructions": "Search the web and summarize findings. Do not execute code.",
      "allowTools": ["web_fetch", "scrape_page", "memory_write"],
      "maxIterations": 10
    }
  },
  "net": {
    "enabled": true,
    "instanceName": "my-vole",
    "role": "coordinator",
    "port": 9700,
    "peers": [
      { "url": "http://192.168.1.50:9701", "trust": "full", "allowBrain": false }
    ],
    "share": { "tools": true, "memory": true, "session": false },
    "routing": { "shell_*": "worker-1", "db_*": "db-worker" }
  }
}
```

---

## Config Sections

### `brain`

Which Brain Paw handles the Think phase of the agent loop.

```json
{ "brain": "@openvole/paw-brain" }
```

The unified `paw-brain` supports all providers — set `BRAIN_PROVIDER` env var to `ollama`, `openai`, `anthropic`, `gemini`, or `xai`.

---

### `paws`

Array of paws to load. Each entry is either a package name string or an object with permissions.

**String shorthand** — no special permissions:
```json
{ "paws": ["@openvole/paw-memory", "@openvole/paw-session"] }
```

**Object form** — with explicit sandbox permissions:
```json
{
  "paws": [
    {
      "name": "@openvole/paw-brain",
      "allow": {
        "network": ["*"],
        "env": ["BRAIN_PROVIDER", "BRAIN_API_KEY", "BRAIN_MODEL",
                "OLLAMA_HOST", "OLLAMA_MODEL", "OLLAMA_API_KEY",
                "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]
      }
    }
  ]
}
```

#### Paw Permission Object (`allow`)

Each paw runs in a sandboxed subprocess. The `allow` field controls what the paw can access:

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `network` | `string[]` | Outbound network access. `["*"]` for any, or specific domains. | `["api.openai.com", "api.telegram.org"]` |
| `listen` | `number[]` | Ports the paw can bind (for servers like dashboard). | `[3001]` |
| `filesystem` | `string[]` | Additional filesystem paths beyond `.openvole/`. | `["./", "/tmp"]` |
| `env` | `string[]` | Environment variables passed to the subprocess. | `["TELEGRAM_BOT_TOKEN"]` |
| `childProcess` | `boolean` | Allow spawning child processes. Required for shell, browser, MCP paws. | `true` |

#### Hook Configuration

Paw hooks can be configured with ordering and pipeline behavior:

```json
{
  "name": "@openvole/paw-memory",
  "hooks": {
    "perceive": { "order": 1, "pipeline": true }
  },
  "allow": { "network": ["*"] }
}
```

#### Common Paw Permissions

| Paw | Needs | Config |
|-----|-------|--------|
| `paw-brain` | LLM API access | `"network": ["*"]`, env vars for provider |
| `paw-shell` | Spawn processes | `"childProcess": true`, `"filesystem": ["./"]` |
| `paw-browser` | Spawn Chrome | `"childProcess": true`, `"network": ["*"]` |
| `paw-database` | Native addons | Disable sandbox: `"sandboxFilesystem": false` |
| `paw-dashboard` | Bind HTTP port | `"listen": [3001]` |
| `paw-telegram` | Telegram API | `"network": ["api.telegram.org"]` or `["*"]` |
| `paw-memory` | Embedding API | `"network": ["*"]` |
| `paw-compact` | LLM for compaction | `"network": ["*"]` |
| `paw-mcp` | Spawn MCP servers | `"childProcess": true` |
| `paw-filesystem` | Read/write files | `"filesystem": ["./"]` |
| `paw-image` | Native addons (sharp) | Disable sandbox: `"sandboxFilesystem": false` |

---

### `skills`

Array of skill names to load. Skills are context-aware prompt templates that activate based on available tools.

```json
{ "skills": ["clawhub/summarize", "clawhub/email-triage", "local/my-workflow"] }
```

Skills from `clawhub/` are fetched from the VoleHub registry. Skills from `local/` are loaded from `.openvole/skills/`.

---

### `loop`

Controls the agent loop — how the Brain thinks, acts, and manages context.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxIterations` | `number` | `10` | Max loop iterations per task. Resets on successful tool execution. |
| `confirmBeforeAct` | `boolean` | `false` | If `true`, ask user confirmation before executing tools. |
| `taskConcurrency` | `number` | `1` | Max tasks running in parallel. |
| `compactThreshold` | `number` | `50` | Message count that triggers compact hooks. `0` to disable. |
| `toolHorizon` | `boolean` | `true` | Brain starts with core tools only, discovers others via `discover_tools`. Reduces context bloat. |
| `maxContextTokens` | `number` | `128000` | Max context window size in tokens. Core trims messages by priority to fit. |
| `responseReserve` | `number` | `4000` | Tokens reserved for the Brain's response output. |
| `costTracking` | `string` | `"auto"` | `"auto"`: track for cloud providers. `"enabled"`: always track. `"disabled"`: off. |
| `costAlertThreshold` | `number` | — | Warn when a single task exceeds this USD amount. |
| `rateLimits` | `object` | — | Rate limiting (see below). |

#### Rate Limits

```json
{
  "loop": {
    "rateLimits": {
      "llmCallsPerMinute": 30,
      "llmCallsPerHour": 500,
      "toolExecutionsPerTask": 100,
      "tasksPerHour": {
        "telegram": 20,
        "cli": 100,
        "heartbeat": 6
      }
    }
  }
}
```

| Option | Description |
|--------|-------------|
| `llmCallsPerMinute` | Max Brain (LLM) calls per minute across all tasks. |
| `llmCallsPerHour` | Max Brain calls per hour. |
| `toolExecutionsPerTask` | Max tool executions within a single task. |
| `tasksPerHour` | Per-source task rate limits. Keys are source names (`cli`, `telegram`, `heartbeat`, etc.). |

#### Context Budget

The `ContextBudgetManager` trims messages by priority when the context exceeds `maxContextTokens`:

1. Old tool results (lowest priority — trimmed first)
2. Old error messages
3. Old assistant/brain messages
4. Session history

**Never trimmed:** system prompt, first user message, last 2 brain responses.

---

### `heartbeat`

Periodic autonomous wake-up. The agent reads `HEARTBEAT.md` and acts on scheduled jobs without user input.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable heartbeat scheduling. |
| `intervalMinutes` | `number` | `30` | Minutes between heartbeat wake-ups. |
| `runOnStart` | `boolean` | `false` | Run a heartbeat immediately on startup. |

```json
{ "heartbeat": { "enabled": true, "intervalMinutes": 15, "runOnStart": true } }
```

Common intervals:

| Use Case | Interval | Description |
|----------|----------|-------------|
| DevOps monitoring | `10` | Health checks, alerts every 10 min |
| Personal assistant | `30` | Email/calendar checks every 30 min |
| Data monitoring | `15` | Watch for changes every 15 min |
| Content automation | `360` | Content cycle every 6 hours |
| Research aggregator | `720` | Daily research report every 12 hours |

The heartbeat instructions live in `.openvole/HEARTBEAT.md`. The agent reads this file each wake-up and decides what actions to take.

---

### `toolProfiles`

Restrict which tools are available per task source. Useful for limiting what external channels (Telegram, Slack) can trigger.

```json
{
  "toolProfiles": {
    "telegram": {
      "deny": ["shell_exec", "fs_write", "fs_delete"]
    },
    "heartbeat": {
      "allow": ["memory_search", "memory_write", "telegram_send", "web_fetch"]
    },
    "cli": {}
  }
}
```

| Field | Description |
|-------|-------------|
| `allow` | Allowlist — only these tools can be used. If set, everything else is denied. |
| `deny` | Denylist — these tools are blocked. Everything else is allowed. |

If both `allow` and `deny` are set, `deny` takes precedence. Profile keys match the task source: `cli`, `telegram`, `slack`, `heartbeat`, `api`, etc.

---

### `security`

Controls the subprocess sandbox and isolation.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sandboxFilesystem` | `boolean` | `true` | Enable Node.js `--permission` sandbox for paw subprocesses. |
| `allowedPaths` | `string[]` | `[]` | Additional filesystem paths paws can access beyond `.openvole/`. |
| `docker` | `object` | — | Docker container sandbox (optional, stronger isolation). |

```json
{
  "security": {
    "sandboxFilesystem": true,
    "allowedPaths": ["/home/user/data"]
  }
}
```

#### Docker Sandbox

Runs paw subprocesses inside Docker containers for stronger isolation.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable Docker sandboxing. |
| `image` | `string` | `"node:20-slim"` | Base Docker image. |
| `memory` | `string` | `"512m"` | Memory limit per container. |
| `cpus` | `string` | `"1.0"` | CPU limit per container. |
| `scope` | `string` | `"session"` | `"session"`: container per task session. `"shared"`: one container reused. |
| `network` | `string` | `"none"` | Docker network mode: `"none"`, `"bridge"`, or `"host"`. |
| `allowedDomains` | `string[]` | — | Outbound domains allowed when `network: "bridge"`. |

```json
{
  "security": {
    "docker": {
      "enabled": true,
      "image": "node:20-slim",
      "memory": "256m",
      "cpus": "0.5",
      "network": "bridge",
      "allowedDomains": ["api.openai.com"]
    }
  }
}
```

---

### `agents`

Named agent profiles for sub-agent spawning via the `spawn_agent` core tool. Each profile defines a restricted execution context.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `role` | `string` | — | Human-readable role description (injected into context). |
| `instructions` | `string` | — | Additional instructions for the sub-agent. |
| `allowTools` | `string[]` | — | Tools this agent can use (allowlist). |
| `denyTools` | `string[]` | — | Tools this agent cannot use (denylist, takes precedence). |
| `maxIterations` | `number` | `10` | Max loop iterations for this agent. |

```json
{
  "agents": {
    "researcher": {
      "role": "Research assistant",
      "instructions": "Search the web and summarize findings. Do not execute shell commands.",
      "allowTools": ["web_fetch", "scrape_page", "memory_write", "memory_search"],
      "maxIterations": 15
    },
    "coder": {
      "role": "Code generator",
      "denyTools": ["telegram_send", "email_send"],
      "maxIterations": 20
    }
  }
}
```

The Brain can spawn these via `spawn_agent({ profile: "researcher", task: "..." })`.

---

### `net` (VoleNet)

Distributed agent networking — connect multiple OpenVole instances across machines.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable VoleNet. |
| `instanceName` | `string` | `"vole"` | Human-readable name for this instance. |
| `role` | `string` | `"peer"` | `"coordinator"`, `"worker"`, or `"peer"`. |
| `port` | `number` | `9700` | WebSocket/HTTP port for peer communication. |
| `keyPath` | `string` | `.openvole/net/vole_key` | Path to Ed25519 keypair. |
| `peers` | `array` | `[]` | Peer connections (see below). |
| `share` | `object` | — | What to share with peers. |
| `routing` | `object` | — | Tool-to-peer routing rules. |
| `brainSource` | `string` | `"local"` | `"local"`, `"remote"`, or a specific peer name. |
| `leader` | `string` | `"auto"` | `"auto"` (lowest instance ID) or a specific instance name. |
| `heartbeatMode` | `string` | `"leader"` | `"leader"`: only leader runs heartbeat. `"independent"`: each instance runs its own. |
| `brainMode` | `string` | `"local"` | `"local"`: handle own tasks. `"loadbalance"`: route to least-loaded brain. |
| `taskOverflow` | `string` | `"reject"` | `"reject"`: reject when queue full. `"forward"`: forward to least-loaded peer. |
| `maxQueuedTasks` | `number` | `10` | Max queued tasks before overflow triggers. |
| `tls` | `object` | — | TLS certificate for encrypted transport. |
| `discovery` | `string` | `"manual"` | Peer discovery method: `"manual"` or `"mdns"`. |

#### Peer Configuration

```json
{
  "net": {
    "peers": [
      {
        "url": "http://192.168.1.50:9701",
        "trust": "full",
        "allowBrain": false,
        "allowTools": ["shell_exec"],
        "denyTools": ["vault_read"]
      }
    ]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Peer endpoint URL. |
| `trust` | `string` | `"full"`: all access. `"tool"`: specific tools only. `"read"`: memory search only. |
| `allowTools` | `string[]` | Tools this peer can execute on our instance (with `trust: "tool"`). |
| `denyTools` | `string[]` | Tools this peer cannot use on our instance. |
| `allowBrain` | `boolean` | Allow this peer to delegate tasks to our Brain (LLM cost on us). |

#### Sharing

```json
{
  "net": {
    "share": {
      "tools": true,
      "memory": true,
      "session": false
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `tools` | Share our local tools with connected peers. |
| `memory` | Propagate memory writes to peers and accept remote memory searches. |
| `session` | Sync session transcripts between peers (shared conversation). |

#### Routing

Route tool calls to specific peers by glob pattern:

```json
{
  "net": {
    "routing": {
      "shell_*": "server-worker",
      "db_*": "db-worker",
      "scrape_*": "web-scraper"
    }
  }
}
```

When multiple peers share the same tool, the Brain can target a specific peer using `<peerName>/<toolName>` syntax (e.g. `us-monitor/shell_exec`).

#### VoleNet Setup

```bash
# 1. Generate identity on each instance
vole net init my-instance

# 2. Exchange keys
vole net show-key                    # on instance A
vole net trust "vole-ed25519 ..."    # on instance B (paste A's key)

# 3. Configure peers in vole.config.json (see above)

# 4. Start both instances
vole start
```

---

## `.openvole` Directory Structure

```
.openvole/
├── paws/
│   ├── paw-memory/          ← memory data
│   │   ├── MEMORY.md
│   │   └── user/, paw/, heartbeat/
│   ├── paw-session/         ← session transcripts
│   │   └── cli:default/, telegram:123/
│   ├── paw-brain/           ← brain paw data
│   │   └── BRAIN.md         ← system prompt (scaffolded on first run)
│   └── paw-mcp/             ← MCP config
│       └── servers.json
├── net/                     ← VoleNet identity (if enabled)
│   ├── vole_key             ← Ed25519 private key
│   ├── vole_key.pub         ← public key
│   └── authorized_voles     ← trusted peer keys
├── workspace/               ← agent scratch space
├── skills/                  ← local and clawhub skills
├── logs/                    ← log files
│   └── vole.log
├── vault.json               ← encrypted key-value store
├── schedules.json           ← persistent cron schedules
├── SOUL.md                  ← agent personality
├── USER.md                  ← user profile
├── AGENT.md                 ← operating rules
└── HEARTBEAT.md             ← recurring job definitions
```

Each paw gets its own data directory at `.openvole/paws/<name>/`. The installed npm package stays immutable — all user data lives in the local paw directory.

---

## Identity Files

Customize agent behavior with markdown files in `.openvole/`:

| File | Purpose | Used By |
|------|---------|---------|
| `BRAIN.md` | Custom system prompt — overrides the default prompt entirely. | Brain Paw |
| `SOUL.md` | Agent personality, tone, and identity. | System Prompt |
| `USER.md` | User profile, preferences, timezone. | System Prompt |
| `AGENT.md` | Operating rules and behavioral constraints. | System Prompt |
| `HEARTBEAT.md` | Recurring job definitions for heartbeat wake-ups. | Heartbeat Task |

These files are loaded into the system prompt on every iteration. Edit them to shape how the agent behaves.

---

## Environment Variables

Global environment variables that affect OpenVole core:

| Variable | Description |
|----------|-------------|
| `VOLE_LOG_LEVEL` | Log level: `debug`, `info`, `warn`, `error`. Default: `info`. |
| `VOLE_LOG_FILE` | Path to log file. Default: `.openvole/logs/vole.log`. |
| `VOLE_DASHBOARD_PORT` | Dashboard HTTP port. Default: `3001`. |
| `VOLE_DEBUG` | Enable debug mode (`true`/`false`). |
| `VOLE_IPC_TIMEOUT_MS` | IPC timeout for paw communication in ms. Default: `300000`. |
| `VOLE_COMPACT_MODEL` | Explicit model for LLM compaction (if unset, uses simple compaction). |

Provider-specific env vars are passed to paws via the `allow.env` config — they are **not** globally available to all paws.
