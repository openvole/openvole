# VoleNet

VoleNet is OpenVole's distributed agent networking layer. It connects multiple OpenVole instances across machines, enabling remote tool execution, memory synchronization, brain sharing, and leader election — all authenticated with Ed25519 signatures.

## How It Works

```
┌──────────────────────┐         WebSocket          ┌─────────────────────┐
│   Coordinator        │◄──────────────────────────►│   Worker            │
│   (Brain + Telegram) │                            │   (Shell tools)     │
│   port 9700          │         Ed25519 signed     │   port 9701         │
└──────────────────────┘         messages           └─────────────────────┘
         │                                                    │
         │              ┌─────────────────────┐               │
         └──────────────►   Worker            │◄──────────────┘
                        │   (Database tools)  │
                        │   port 9702         │
                        └─────────────────────┘
```

1. Each instance generates an Ed25519 keypair (`vole net init`)
2. Instances exchange public keys to establish trust (`vole net trust`)
3. On startup, peers connect via WebSocket and discover each other's tools
4. Remote tools appear in the coordinator's tool registry — the Brain calls them like local tools
5. All messages are signed with Ed25519 and include replay protection (60s window)

## Architecture Patterns

### Pattern 1: Single Brain, Distributed Tools

One coordinator runs the Brain. Workers expose tools (shell, database, etc.) without needing their own LLM.

```json
// coordinator
{
  "brain": "@openvole/paw-brain",
  "net": {
    "enabled": true, "instanceName": "coordinator", "role": "coordinator", "port": 9700,
    "peers": [
      { "url": "http://worker-1:9701", "trust": "full" }
    ],
    "share": { "tools": false, "memory": true }
  }
}

// worker (no brain)
{
  "paws": [
    { "name": "@openvole/paw-shell", "allow": { "childProcess": true, "filesystem": ["./"] } }
  ],
  "net": {
    "enabled": true, "instanceName": "worker-1", "role": "worker", "port": 9701,
    "peers": [{ "url": "http://coordinator:9700", "trust": "full" }],
    "share": { "tools": true, "memory": false }
  }
}
```

**Use cases:** DevOps monitoring (run commands on remote servers), distributed scraping, database on a different machine.

### Pattern 2: Multi-Brain Independent

Each instance has its own Brain and heartbeat. Peers can share memory and communicate, but think independently.

```json
{
  "brain": "@openvole/paw-brain",
  "net": {
    "enabled": true, "instanceName": "backend-vole", "role": "peer", "port": 9700,
    "peers": [
      { "url": "http://localhost:9701", "trust": "full" },
      { "url": "http://localhost:9702", "trust": "full" }
    ],
    "share": { "tools": true, "memory": true, "session": true }
  }
}
```

**Use cases:** Autonomous dev team (backend + frontend + tester), specialized research agents.

### Pattern 3: Load-Balanced Brains

Multiple instances with Brains. Tasks route to the least-loaded peer.

```json
{
  "net": {
    "brainMode": "loadbalance",
    "taskOverflow": "forward",
    "maxQueuedTasks": 5
  }
}
```

### Pattern 4: Shared Session Multi-Device

Same user, same conversation across devices. Session and memory sync in both directions.

```json
// Mac (on-demand use)
{
  "net": {
    "instanceName": "my-mac", "role": "peer", "port": 9700,
    "peers": [{ "url": "http://vps-ip:9701", "trust": "full" }],
    "share": { "tools": true, "memory": true, "session": true }
  }
}

// VPS (24/7 with Telegram)
{
  "net": {
    "instanceName": "my-vps", "role": "peer", "port": 9701,
    "peers": [{ "url": "http://mac-ip:9700", "trust": "full" }],
    "share": { "tools": true, "memory": true, "session": true }
  }
}
```

### Pattern 5: Multi-User Team

Each team member has their own Brain and tools, but they share a common memory and tool server.

```
┌──────────────┐  ┌──────────────┐  ┌────────────────┐
│  Alice       │  │  Bob         │  │  Carol         │
│  Brain+CLI   │  │  Brain+CLI   │  │  Brain+Telegram│
│  port 9700   │  │  port 9701   │  │  port 9702     │
└──────┬───────┘  └──────┬───────┘  └──────┬─────────┘
       │                 │                  │
       └────────────┬────┴──────────────────┘
                    │
          ┌─────────▼─────────┐
          │  Shared Server    │
          │  DB + Shell + MCP │
          │  port 9703        │
          └───────────────────┘
```

```json
// Alice's instance
{
  "brain": "@openvole/paw-brain",
  "net": {
    "enabled": true, "instanceName": "alice", "role": "peer", "port": 9700,
    "peers": [
      { "url": "http://server:9703", "trust": "full" },
      { "url": "http://bob:9701", "trust": "read" },
      { "url": "http://carol:9702", "trust": "read" }
    ],
    "share": { "tools": false, "memory": true }
  }
}

// Shared server (no brain, exposes tools to all)
{
  "paws": [
    { "name": "@openvole/paw-database", "allow": { "network": ["*"], "filesystem": ["./"] } },
    { "name": "@openvole/paw-shell", "allow": { "childProcess": true, "filesystem": ["./"] } }
  ],
  "net": {
    "enabled": true, "instanceName": "shared-server", "role": "worker", "port": 9703,
    "peers": [
      { "url": "http://alice:9700", "trust": "tool" },
      { "url": "http://bob:9701", "trust": "tool" },
      { "url": "http://carol:9702", "trust": "tool" }
    ],
    "share": { "tools": true, "memory": false }
  }
}
```

**Use cases:** Small team sharing a database server, dev team with shared infrastructure, agency with per-client agents.

### Pattern 6: Central Brain Company

One powerful Brain server handles all thinking. Thin worker clients just expose tools and channels — no LLM cost per client.

```
                    ┌─────────────────────┐
                    │   Brain Server      │
                    │   GPU + paw-brain   │
                    │   port 9700         │
                    └──────────┬──────────┘
           ┌───────────────────┼───────────────────┐
           │                   │                   │
  ┌────────▼────────┐ ┌───────▼────────┐ ┌────────▼────────┐
  │  Client A       │ │  Client B      │ │  Client N       │
  │  Telegram+Shell │ │  Slack+Browser │ │  CLI+Database   │
  │  brainSource:   │ │  brainSource:  │ │  brainSource:   │
  │  "remote"       │ │  "remote"      │ │  "remote"       │
  └─────────────────┘ └────────────────┘ └─────────────────┘
```

```json
// Brain server — accepts brain delegation from all clients
{
  "brain": "@openvole/paw-brain",
  "paws": [
    { "name": "@openvole/paw-brain", "allow": { "network": ["*"], "env": ["BRAIN_PROVIDER", "BRAIN_API_KEY", "BRAIN_MODEL"] } },
    { "name": "@openvole/paw-memory", "allow": { "network": ["*"] } }
  ],
  "net": {
    "enabled": true, "instanceName": "brain-server", "role": "coordinator", "port": 9700,
    "peers": [
      { "url": "http://client-a:9701", "trust": "full", "allowBrain": true },
      { "url": "http://client-b:9702", "trust": "full", "allowBrain": true },
      { "url": "http://client-n:9703", "trust": "full", "allowBrain": true }
    ],
    "share": { "tools": false, "memory": true }
  }
}

// Client A — no brain, delegates thinking to brain-server
{
  "paws": [
    { "name": "@openvole/paw-telegram", "allow": { "network": ["*"], "env": ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOW_FROM"] } },
    { "name": "@openvole/paw-shell", "allow": { "childProcess": true, "filesystem": ["./"] } }
  ],
  "net": {
    "enabled": true, "instanceName": "client-a", "role": "worker", "port": 9701,
    "peers": [{ "url": "http://brain-server:9700", "trust": "full" }],
    "share": { "tools": true, "memory": false },
    "brainSource": "remote"
  }
}
```

**Use cases:** Company-wide AI assistant, centralized LLM billing, GPU server with thin clients, managed AI service.

### Pattern 7: Autonomous Swarm

Self-organizing agents with no fixed coordinator. Any peer can lead. Tasks automatically forward to the least-loaded instance.

```
  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
  │  Agent 1 │◄──►│  Agent 2 │◄──►│  Agent 3 │◄──►│  Agent 4 │
  │  Brain   │    │  Brain   │    │  Brain   │    │  Brain   │
  │  Shell   │    │  Browser │    │  DB      │    │  Scraper │
  └──────────┘    └──────────┘    └──────────┘    └──────────┘
       ▲                                               ▲
       └───────────────────────────────────────────────┘
                    Full mesh — all peers connected
```

```json
// Every agent has the same net structure (different instanceName/port)
{
  "brain": "@openvole/paw-brain",
  "net": {
    "enabled": true, "instanceName": "agent-1", "role": "peer", "port": 9700,
    "peers": [
      { "url": "http://agent-2:9701", "trust": "full" },
      { "url": "http://agent-3:9702", "trust": "full" },
      { "url": "http://agent-4:9703", "trust": "full" }
    ],
    "share": { "tools": true, "memory": true, "session": false },
    "leader": "auto",
    "heartbeatMode": "leader",
    "brainMode": "loadbalance",
    "taskOverflow": "forward",
    "maxQueuedTasks": 5
  }
}
```

Key behaviors:
- **Leader election:** Lowest instance ID becomes leader automatically. If it disconnects, the next lowest takes over within 30 seconds.
- **Load balancing:** Incoming tasks route to the peer with the lowest current load.
- **Task overflow:** When a peer's queue is full, tasks automatically forward to another peer.
- **Tool sharing:** Each agent's unique tools are available to all others.

**Use cases:** Resilient autonomous research, parallel task processing, fault-tolerant monitoring across regions.

### Pattern 8: Brain Sharing

Workers without a Brain delegate thinking to a coordinator's Brain.

```json
// coordinator — allows brain sharing
{
  "net": {
    "peers": [
      { "url": "http://worker:9701", "trust": "full", "allowBrain": true }
    ]
  }
}

// worker — delegates thinking to coordinator
{
  "net": {
    "brainSource": "remote"
  }
}
```

**Use cases:** Workers that only need tool execution, not their own LLM reasoning.

## Remote Tool Execution

When a worker shares its tools, they appear in the coordinator's tool registry. The Brain calls them transparently:

```
Brain thinks: "I need to check disk usage on the US server"
  → Brain calls: us-monitor/shell_exec({ command: "df -h" })
  → Core detects remote tool → WebSocket to us-monitor
  → us-monitor executes shell_exec locally
  → Result flows back to coordinator
  → Brain sees the output like any local tool
```

### Peer-Specific Tool Names

When multiple peers share the same tool (e.g. two workers both have `shell_exec`), VoleNet registers them with peer-specific names:

- `us-monitor/shell_exec` — runs on the US server
- `eu-monitor/shell_exec` — runs on the EU server

The Brain sees both and can target the right one. The system prompt tells the Brain which peers have which tools and whether they have a brain.

### Tool Routing

Route tool calls to specific peers by glob pattern without the Brain needing to know:

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

## Memory Sync

When `share.memory` is enabled:

- **Write propagation:** Memory writes broadcast to all peers. Each peer stores the entry locally.
- **Search:** `memory_search` queries all peers in parallel, results merge with deduplication.
- **Dedup:** A 5-minute TTL cache prevents echo loops (A writes → B receives → B doesn't re-broadcast).

## Session Sync

When `share.session` is enabled:

- User messages and Brain responses propagate to peers.
- The receiving peer writes entries to its local paw-session transcript.
- Enables shared conversations across devices (Pattern 4).

## Leader Election

One instance is elected leader. The leader runs heartbeat schedules and coordinates work.

| Mode | Description |
|------|-------------|
| `"auto"` (default) | Lowest instance ID wins. Automatic failover on disconnect. |
| `"<instanceName>"` | Force a specific instance as leader. |

- Leader sends heartbeat pings every 10 seconds.
- If 3 consecutive heartbeats are missed, peers trigger re-election.
- `heartbeatMode: "leader"` — only the leader runs heartbeat jobs.
- `heartbeatMode: "independent"` — each instance runs its own heartbeat.

## Trust Levels

| Level | Description |
|-------|-------------|
| `full` | Can use all our tools, search our memory, delegate tasks. |
| `tool` | Can use specific tools only (configured via `allowTools`/`denyTools`). |
| `read` | Can search our memory only. No tool execution. |

The `allowBrain` flag is separate — it controls whether a peer can delegate tasks to our Brain (which costs LLM tokens).

## Security

- **Ed25519 signatures** on every message. Unsigned or invalid messages are rejected.
- **Replay protection** — messages older than 60 seconds are rejected.
- **Authorized keys** — only peers in `.openvole/net/authorized_voles` can connect.
- **Trust levels** — granular control over what each peer can do.
- **WebSocket preferred** — persistent bidirectional connections. HTTP POST fallback available.
- **TLS** — optional encrypted transport via `tls.cert` and `tls.key`.

## CLI Commands

```bash
vole net init <name>         # Generate Ed25519 keypair and set instance name
vole net show-key            # Display public key for sharing
vole net trust "<key>"       # Add a peer's public key to authorized_voles
vole net revoke "<key>"      # Remove a peer's trust
vole net peers               # List connected peers and their status
vole net status              # Show VoleNet status (instance, leader, peers, tools)
```

## Quick Start

### 1. Set Up Two Instances

```bash
# Instance A (coordinator with brain)
mkdir coordinator && cd coordinator
npm init -y && npm install openvole @openvole/paw-brain @openvole/paw-memory @openvole/paw-session @openvole/paw-dashboard
npx vole init
npx vole net init coordinator

# Instance B (worker with shell)
mkdir worker && cd worker
npm init -y && npm install openvole @openvole/paw-shell @openvole/paw-dashboard
npx vole init
npx vole net init worker
```

### 2. Exchange Keys

```bash
# On coordinator
npx vole net show-key
# Copy the output: vole-ed25519 AAAA... coordinator

# On worker — paste coordinator's key
npx vole net trust "vole-ed25519 AAAA... coordinator"

# On worker
npx vole net show-key
# Copy output, paste on coordinator
npx vole net trust "vole-ed25519 BBBB... worker"
```

### 3. Configure

Coordinator `vole.config.json`:
```json
{
  "brain": "@openvole/paw-brain",
  "paws": [
    { "name": "@openvole/paw-brain", "allow": { "network": ["*"], "env": ["BRAIN_PROVIDER", "OLLAMA_HOST", "OLLAMA_MODEL"] } },
    { "name": "@openvole/paw-memory", "allow": { "network": ["*"] } },
    { "name": "@openvole/paw-session" },
    { "name": "@openvole/paw-dashboard", "allow": { "listen": [3001] } }
  ],
  "loop": { "confirmBeforeAct": false, "maxIterations": 25, "toolHorizon": true },
  "net": {
    "enabled": true, "instanceName": "coordinator", "role": "coordinator", "port": 9700,
    "peers": [{ "url": "http://localhost:9701", "trust": "full" }],
    "share": { "tools": false, "memory": true }
  }
}
```

Worker `vole.config.json`:
```json
{
  "paws": [
    { "name": "@openvole/paw-shell", "allow": { "filesystem": ["./", "/tmp"], "childProcess": true, "env": ["VOLE_SHELL_ALLOWED_DIRS"] } },
    { "name": "@openvole/paw-dashboard", "allow": { "listen": [3002] } }
  ],
  "loop": { "confirmBeforeAct": false, "maxIterations": 10, "toolHorizon": false },
  "net": {
    "enabled": true, "instanceName": "worker", "role": "worker", "port": 9701,
    "peers": [{ "url": "http://localhost:9700", "trust": "full" }],
    "share": { "tools": true, "memory": false }
  }
}
```

### 4. Start

```bash
# Terminal 1
cd coordinator && npx vole start

# Terminal 2
cd worker && npx vole start
```

The coordinator's Brain can now call `shell_exec` — the call routes to the worker transparently.
