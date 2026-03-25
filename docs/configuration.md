# Configuration

OpenVole uses a single `vole.config.json` file — plain JSON, no imports.

## Minimal Example

```json
{
  "brain": "@openvole/paw-ollama",
  "paws": ["@openvole/paw-ollama", "@openvole/paw-memory"],
  "skills": ["clawhub/summarize"],
  "loop": { "maxIterations": 25, "compactThreshold": 50 },
  "heartbeat": { "enabled": false, "cron": "*/30 * * * *" },
  "toolProfiles": { "paw": { "deny": ["shell_exec"] } }
}
```

## Config Options

### `brain`

The Brain Paw to use for LLM calls. Must be one of the installed Brain Paws.

```json
{ "brain": "@openvole/paw-ollama" }
```

### `paws`

Array of installed Paws. Each entry can be a string (package name) or an object with permissions:

```json
{
  "paws": [
    "@openvole/paw-memory",
    {
      "name": "@openvole/paw-ollama",
      "allow": {
        "network": ["127.0.0.1"],
        "env": ["OLLAMA_HOST", "OLLAMA_MODEL"]
      }
    }
  ]
}
```

### `skills`

Array of skill names to load:

```json
{ "skills": ["clawhub/summarize", "local/email-triage"] }
```

### `loop`

Controls the agent loop behavior:

| Option | Default | Description |
|--------|---------|-------------|
| `maxIterations` | `25` | Maximum loop iterations per task |
| `compactThreshold` | `50` | Message count that triggers context compaction |

```json
{ "loop": { "maxIterations": 25, "compactThreshold": 50 } }
```

### `heartbeat`

Periodic wake-up — the Brain checks `HEARTBEAT.md` and decides what to do. No user input needed.

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable heartbeat |
| `cron` | `"*/30 * * * *"` | Cron expression for wake-up schedule |

```json
{ "heartbeat": { "enabled": true, "cron": "*/30 * * * *" } }
```

Cron expression examples:

```
"0 13 * * *"     — daily at 1 PM UTC
"*/30 * * * *"   — every 30 minutes
"0 9 * * 1"      — every Monday at 9 AM
```

### `toolProfiles`

Per-source tool filtering. Restrict which tools each task source can use:

```json
{ "toolProfiles": { "paw": { "deny": ["shell_exec", "fs_write"] } } }
```

This prevents Telegram or Slack users from triggering dangerous tools.

### `security`

Security settings for the filesystem sandbox:

| Option | Default | Description |
|--------|---------|-------------|
| `sandboxFilesystem` | `true` | Enable Node.js permission model sandbox |
| `allowedPaths` | `[]` | Additional filesystem paths to allow |

```json
{
  "security": {
    "sandboxFilesystem": true,
    "allowedPaths": ["/home/user/projects"]
  }
}
```

## Paw Permission Object

When a Paw entry is an object, the `allow` field controls permissions:

| Key | Type | Description |
|-----|------|-------------|
| `network` | `string[]` | Outbound network domains/IPs |
| `listen` | `number[]` | Ports the Paw can bind to |
| `filesystem` | `string[]` | Additional file/directory access paths |
| `env` | `string[]` | Environment variables passed to the subprocess |
| `childProcess` | `boolean` | Allow spawning child processes |

```json
{
  "name": "@openvole/paw-shell",
  "allow": {
    "filesystem": ["./"],
    "env": ["VOLE_SHELL_ALLOWED_DIRS"],
    "childProcess": true
  }
}
```

## `.openvole` Directory Structure

```
.openvole/
├── paws/
│   ├── paw-memory/          ← memory data
│   │   ├── MEMORY.md
│   │   └── user/, paw/, heartbeat/
│   ├── paw-session/         ← session transcripts
│   │   └── cli:default/, telegram:123/
│   ├── paw-ollama/          ← brain paw data
│   │   └── BRAIN.md         ← system prompt (scaffolded on first run)
│   └── paw-mcp/             ← MCP config
│       └── servers.json
├── workspace/               ← agent scratch space
├── skills/                  ← local and clawhub skills
├── vault.json               ← encrypted key-value store
├── schedules.json           ← persistent cron schedules
├── SOUL.md                  ← agent personality
├── USER.md                  ← user profile
├── AGENT.md                 ← operating rules
└── HEARTBEAT.md             ← recurring job definitions
```

Each Paw has its own local config directory at `.openvole/paws/<name>/`. The installed npm package stays immutable — all user configuration lives in the local paw directory.

## Identity Files

Customize agent behavior with optional markdown files in `.openvole/`:

| File | Purpose |
|------|---------|
| `BRAIN.md` | Custom system prompt — overrides the default system prompt entirely |
| `SOUL.md` | Agent personality and tone |
| `USER.md` | User profile and preferences |
| `AGENT.md` | Operating rules and constraints |

All Brain Paws (Ollama, Claude, OpenAI, Gemini, xAI) load these on startup.
