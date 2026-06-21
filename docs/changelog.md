# Changelog

## v4.1.0 (2026-06-21)

### Node-to-node messaging
- **`net_message` core tool** — your Brain can message a peer agent; the peer's Brain replies. Gated by the receiver's `allowBrain` (off by default, even for `trust: "full"`)
- **Human VoleNet-tab chat** — message a connected peer directly from the dashboard's VoleNet tab. Unlike `net_message`, human chat does **not** invoke any Brain; messages are signed, delivered, and persisted via paw-session (per-peer transcript), with an in-memory fallback
- New paw-session `session_append` tool for appending a single entry to a session transcript (backs chat persistence)

### VoleNet security hardening
- All remote actions — `tool:call`, `tool:list`, and `task:delegate` — now require an Ed25519-signed message from an authorized peer; unverified messages are rejected. This closes an unauthenticated remote-tool-execution gap
- A peer may call your tools only with explicit `trust: "tool"`/`"full"` in `net.peers`, or when you set `share.tools: true`; per-peer `allowTools`/`denyTools` (glob like `shell_*`) refine it. Tools are not exposed by default
- New `net.publicJoin` — let unknown peers self-register over HTTP at a restricted guest trust level (never `"full"`), with peer cap, per-IP rate limiting, and optional manual approval. Off by default
- **Hybrid post-quantum signatures** — messages are signed with Ed25519 **and** ML-DSA-65 (FIPS 204) when the runtime supports it (Node 24+ / OpenSSL 3.5+, native). Zero-touch migration: keypairs auto-upgrade on start and existing trust auto-upgrades when peers reconnect; both signatures are required between PQ-capable peers (downgrade-resistant), and Ed25519-only nodes stay interoperable
- The `/volenet/message` endpoint is now rate-limited per source and body-size-capped (DoS mitigation)

### Mesh resilience
- VoleNet releases its port cleanly on restart and retries the bind on `EADDRINUSE`
- Configured peers are re-attempted every ~15s, self-healing start-order races, late joiners, and transient drops

### Dashboard
- Live VoleNet peer list in the dashboard's VoleNet tab

### Brain
- paw-brain **mock provider** (`BRAIN_PROVIDER=mock`) for testing — deterministic replies via `BRAIN_MOCK_REPLY` or `BRAIN_MOCK_SCRIPT`

## v4.0.1 (2026-06-17)

### Docs & site
- Rewrote the README and docs landing around the positioning — a self-hosted, model-agnostic agent OS with VoleNet and embedded-app paws — leading with value instead of "microkernel framework"
- New value-first home page (`docs/index.md`) with the `vole serve` control-plane and embedded-apps screenshots
- Elevated **embedded apps** (paws that ship their own UI under the Apps tab) as a first-class capability

## v4.0.0 (2026-06-14)

### Control-Plane Dashboard & Spaces
- `vole serve` is now the primary workflow — **one** web server (default port 3000, `VOLE_DASHBOARD_PORT` overrides) that manages **all** your agents from a single place, replacing the old one-dashboard-per-project model
- A **space** is an isolated agent with its own config, paws, identity, and data; each runs as its own engine subprocess parented to the `vole serve` process (not detached)
- New `@openvole/dashboard-server` package hosts the control plane and aggregates each space's state/events over IPC
- **Root resolution**: `vole serve` resolves the OpenVole root from `VOLE_HOME` (explicit override, always wins), else the current directory if it's already a root (has `spaces.json`) or is empty (becomes a new root, ignoring `.DS_Store`/`.git`/`.gitignore`); otherwise it refuses with a clear error and points to a legacy `~/.openvole` if one exists. The implicit global `~/.openvole` (regardless of cwd) is gone
- Startup logs `OpenVole root: <dir>` (with `(new)` if freshly created) and the dashboard URL
- Dashboard tabs: Overview, Chat, Apps, Config, Identity, plus a header space switcher to create / start / stop / switch / delete spaces

### New-Space Flow
- **New space** opens a modern modal form (name field)
- On create, an **onboarding** step suggests the essential paws, pre-checked: `@openvole/paw-brain`, `@openvole/paw-session`, `@openvole/paw-memory`, `@openvole/paw-compact`, `@openvole/paw-shell` — selected ones install into the new space
- Deleting a space from the dashboard now **permanently deletes its directory on disk** (config, identity, installed paws, data) after a destructive confirmation — equivalent to `vole space remove <name> --purge` (the CLI without `--purge` keeps files)

### Embedded Apps Panels
- Any paw can contribute a dashboard UI by declaring a `panel` in its manifest (`vole-paw.json`): `"panel": { "title": "Markets", "html": "panel.html" }`; the named static HTML ships inside the paw package
- The control plane serves panel HTML at `/panel/<space>/<paw>/` and proxies the paw's tools at `/panel/<space>/<paw>/tool/<toolName>` — **brain-free**, called directly over IPC with no LLM
- Every panel-contributing paw appears under the always-visible **Apps** tab as a sandboxed iframe (with an empty state when a space has none) — **no per-paw web servers and no extra ports**
- Reference example: `@openvole/paw-markets`, a US-stock tracking paw with an embedded **Markets** panel

### Structured Config Tab
- The Config tab is now entirely structured form fields — no raw-JSON textareas
- Sections: brain (dropdown), loop, heartbeat, security (incl. per-paw filesystem paths), docker sandbox, rate limits, tool profiles, **AGENTS** (named sub-agent profiles: role, instructions, allowTools, denyTools, maxIterations), and **NET** (VoleNet) — fully structured with an on/off **toggle** for `enabled`, plus peers, share (tools/memory/session), TLS, routing, and the various modes
- Identity files are edited in the Identity tab

### Removed
- The single-engine workflow is gone: **`vole init`, `vole start`, and `vole run` have been removed**. OpenVole now runs as a server — use `vole serve` and manage agents as spaces. Typing a removed command prints a pointer to `vole serve`.

### Deprecation
- `@openvole/paw-dashboard` (the old single-engine web dashboard paw) is **deprecated** in favor of `vole serve`. It still works but logs a deprecation warning on load and will be removed in a future release

## v3.1.0 (2026-06-08)

### Dashboard Control Panel
- paw-dashboard upgraded from read-only monitoring to a full control panel
- Config editor — edit `vole.config.json` from the browser across 8 sections (brain, heartbeat, loop, security/Docker sandbox, paws, tool profiles, agents, net)
- Identity editor — edit `SOUL.md`, `USER.md`, `AGENT.md`, `HEARTBEAT.md`, and `BRAIN.md` in the browser
- One-click engine restart to apply config/identity changes without the terminal
- Live event log for task lifecycle, paw/tool registration, crashes, rate limits, and VoleNet executions
- Engine IPC handlers backing the panel: `read_config`, `write_config`, `read_identity`, `write_identity`, `restart_engine`
- In-process engine restart (no detached child process), triggered via the `engine:restart` bus event
- Crashed paws now surface as unhealthy on the dashboard instead of disappearing silently

### Brain
- **Behavior change**: paw-brain no longer silently defaults to Ollama. If no provider is configured (`BRAIN_PROVIDER`, a provider API key, or `OLLAMA_HOST`/`OLLAMA_MODEL`), it now exits with a clear error
- paw-brain self-scaffolds `BRAIN.md` on first load if missing
- Fixed the fallback path crashing with a `ReferenceError` when the primary provider errored and `BRAIN_FALLBACK` was set (vars were scoped to the `try` block)

### Security
- Bumped `ws` to `^8.20.1` in core and paw-dashboard (resolves moderate DoS advisory)

### Quality of life
- Cleaner `vole init` — no pre-created paw directories or placeholder files
- `vole paw add` scaffolds `BRAIN.md` when adding a brain paw
- Suppressed spurious ENOENT warning when `schedules.json` doesn't exist yet

### Package versions
- `openvole` 3.1.0 · `@openvole/paw-dashboard` 3.1.0 · `@openvole/paw-brain` 2.1.0

## v3.0.0 (2026-04-02)

### VoleNet — Distributed Agent Networking
- Industry-first peer-to-peer AI agent networking protocol
- Ed25519 authenticated messaging with replay protection (60s window)
- WebSocket transport with auto-reconnect (exponential backoff), HTTP POST fallback
- Peer discovery with health monitoring (15s ping, 45s timeout)
- Remote tool execution — tools on remote peers appear in the local registry, transparent to the Brain
- Peer-specific tool naming (`<peerName>/<toolName>`) when multiple peers share the same tool
- Load-balanced routing — picks least-loaded peer when multiple provide the same tool
- Tool routing config with glob patterns (`"shell_*": "worker-1"`)
- Brain sharing — brainless workers delegate thinking to a coordinator's Brain (`brainSource: "remote"`)
- Leader election — lowest instance ID wins, automatic failover on disconnect (10s heartbeat, 3-miss takeover)
- Memory sync — write propagation with broadcast, remote search with timeout and result merging
- Session sync — conversation replication across devices
- Deduplication via 5-minute TTL cache to prevent echo loops
- 8 architecture patterns: single-brain distributed-tools, multi-brain independent, load-balanced brains, shared session multi-device, multi-user team, central brain company, autonomous swarm, dev team
- System prompt shows peers with tools, brain capability, and role
- `vole net` CLI: init, show-key, trust, revoke, peers, status
- Core tools: `list_instances`, `spawn_remote_agent`, `get_remote_result`
- Dashboard VoleNet panel with peer status and remote tool execution feed

### Brain Awareness
- System prompt now shows `has brain` / `no brain` per peer
- Brain guided to use direct tool calls for brainless workers instead of `spawn_remote_agent`

### Telegram Improvements
- `chat_id` now optional on `telegram_send`, `telegram_reply`, `telegram_get_chat`
- Defaults to first ID from `TELEGRAM_ALLOW_FROM` when omitted

### Documentation
- Comprehensive configuration reference (all config sections with types, defaults, examples)
- VoleNet docs page with 8 architecture patterns, diagrams, quick-start guide
- Updated architecture doc with 6-phase loop, context budget, tool horizon, cost tracking
- Updated VOLECONTEXT.md with budget manager, VoleNet context flow, tool horizon
- All docs/presets/CLI updated from paw-ollama to paw-brain as default

### Testing
- 92 new VoleNet unit tests (protocol, keys, remote-task, sync, leader)
- Total: 310 tests across 23 test files

## v2.0.0 (2026-03-30)

### Vector/Semantic Memory
- Hybrid search: BM25 keyword + vector similarity with Reciprocal Rank Fusion (RRF)
- Embedding providers: Ollama (local, free), OpenAI, Gemini — auto-detected from env
- SQLite + better-sqlite3 vector store with FTS5 for keyword search
- Temporal decay scoring (configurable half-life, default 30 days)
- Auto-index on write, full re-index on startup
- Custom endpoint support via `VOLE_EMBEDDING_BASE_URL`
- Graceful degradation: BM25-only when no embedding provider available

### LLM-Based Context Compaction
- Optional LLM summarization for higher-quality compaction (`VOLE_COMPACT_MODEL`)
- Lightweight LLM client: Ollama, OpenAI, Gemini, Anthropic, xAI via direct fetch
- Structured summarization preserving task, decisions, blockers, next steps
- Lazy initialization — LLM client created on first compaction, not startup
- Falls back to free heuristic compaction when no LLM configured

### Multi-Agent
- Agent profiles in `vole.config.json`: named agents with role, instructions, tool restrictions
- Context passing from parent to child agents
- Tool restrictions per agent: `allowTools` (whitelist) and `denyTools` (blacklist)
- 2-level spawn depth (parent → child → grandchild)
- `wait_for_agents` tool for parallel coordination with timeout
- `get_agent_result` returns duration and cost metrics
- `agent:completed` bus event with parentTaskId

### Docker Sandbox
- Optional container isolation via dockerode (stronger than Node.js --permission)
- Security: read-only root, cap-drop ALL, no-new-privileges, network none
- Resource limits: configurable memory and CPU per container
- Config: `security.docker` section in vole.config.json

### VoleHub — Skill Registry
- GitHub-based skill registry at openvole/volehub
- CLI: `vole skill search`, `install`, `uninstall`, `publish`, `hub`
- SHA-256 hash verification on install
- ClawHub-compatible SKILL.md format

### New Paws
- `paw-database` — PostgreSQL, MySQL, SQLite queries
- `paw-scraper` — structured web data extraction via cheerio
- `paw-pdf` — read, merge, split PDFs via pdf-lib
- `paw-image` — resize, crop, watermark, compress images via sharp
- `paw-social` — Twitter/X and LinkedIn posting

### Paw System
- Mandatory `category` field in paw manifests: brain, channel, tool, infrastructure
- Dashboard groups paws by category with color-coded headers
- PawCategory type exported from paw-sdk

### Other
- IPC: no timeout on `think` requests (LLM inference is unbounded)
- BRAIN.md: stronger tool-first instructions
- Removed `vole.lock.json` — `vole.config.json` is single source of truth
- paw-sdk types synced with core (AgentMessage, AgentPlan)

## v1.3.0 (2026-03-28)

### Cost Tracking
- Per-LLM-call cost estimation with provider pricing table (Anthropic, OpenAI, Gemini, xAI, Ollama)
- Brain paws report token usage via `AgentPlan.usage` — core tracks per-task cost
- `costAlertThreshold` config — warn when a task exceeds a dollar threshold
- `costTracking` mode: `auto` (local Ollama = free, cloud = priced), `enabled`, `disabled`
- Auto-detects Ollama local vs cloud via `:cloud` suffix in model name

### Task Priority & Dependencies
- Priority levels: `urgent` > `normal` > `low` — priority-aware queue scheduling
- Task dependencies: `dependsOn: [taskId]` — tasks wait until prerequisites complete

### Smarter Compaction
- Two-phase compaction: Phase 1 shrinks seen tool results in-place (works even with few messages), Phase 2 does full structured summary
- Fixes the "compact did nothing" issue when large tool results hit 75% budget but message count was low

### Memory Intelligence
- paw-memory `onCompact` hook — auto-extracts user preferences and key facts before messages are compacted away
- paw-memory `onObserve` hook — extracts tool usage patterns every 10 successful calls

### Provider Fallback Chains
- paw-brain: `BRAIN_FALLBACK` env var — if primary provider errors, automatically retry with fallback
- Supports `BRAIN_FALLBACK_MODEL` and `BRAIN_FALLBACK_BASE_URL`

### Dashboard
- Cost column in tasks table — shows $ amount and token count per task
- Task priority visible in query response

### Testing
- 210 tests (was 182): 22 cost tracker tests, 6 priority/dependency tests

## v1.2.0 (2026-03-28)

### Context Engine
- **ContextBudgetManager** — centralized token estimation (4 chars/token text, 2 chars/token JSON), budget calculation, and priority-based 5-pass trimming
- **System prompt builder** — moved from brain paws to core, eliminating 992 lines of duplicated code across 5 brain paws. Static-first ordering for provider prompt cache optimization
- **Token-based compaction** — triggers at 75% of maxContextTokens (replaces message-count threshold)
- **Budget guardrails** — blocks LLM calls when fixed costs exceed maxContextTokens, detailed PRE-COMPACT and FINAL budget logging with per-role token breakdown
- **Unseen tool result protection** — tool results not yet seen by the Brain are never trimmed, preventing stuck loops from lost results
- **Image handling** — extracts base64 from tool results, passes to Brain as provider-native image blocks (Anthropic, OpenAI, Gemini, xAI, Ollama)
- **Stuck loop detection** — 3-tier escalation: warn at 5, dampen at 10, circuit breaker at 15 identical tool calls
- **Bootstrap file caps** — 20K chars/file, 50K total for identity files, 20K for memory
- **Timing logs** — context build time and LLM round-trip duration logged per iteration
- New config: `maxContextTokens` (default: 128000), `responseReserve` (default: 4000)

### Unified Brain Paw
- **@openvole/paw-brain** — single brain paw supporting all LLM providers (Anthropic, OpenAI, Gemini, xAI, Ollama)
- Auto-detects provider from available API keys, or set `BRAIN_PROVIDER` explicitly
- Generic `BRAIN_API_KEY`, `BRAIN_MODEL`, `BRAIN_BASE_URL` with provider-specific overrides
- Legacy brain paws (paw-claude, paw-openai, paw-gemini, paw-xai, paw-ollama) deprecated

### Desktop Automation
- **paw-computer: hierarchical UI tree** — recursive traversal with parent-child indentation on macOS (AppleScript) and Windows (UI Automation), replacing flat element dump
- Global 200-element cap, respects max_depth parameter

### Other
- Random thinking spinner phrases (including vole-themed: "burrowing deeper...", "pawing at it...")
- Updated .env.example, vole.config.json.example, README with paw-brain as default
- Fix 4 audit vulnerabilities via pnpm overrides (brace-expansion, nodemailer)
- 28 official paws (1 unified brain + 5 legacy)
- 182 tests

## v1.1.0 (2026-03-26)
- Error recovery — `paw:crashed` event emitted on subprocess exit, running tasks auto-fail instead of hanging
- `vole tool list --live` — boots engine in headless mode to discover MCP tools
- Documentation site at [openvole.github.io/openvole](https://openvole.github.io/openvole/)
- paw-mcp: runtime MCP server management (`mcp_add_server`, `mcp_remove_server`, `mcp_list_servers`)
- Vulnerability fixes: esbuild, picomatch, yaml, nodemailer, undici, file-type

## v1.0.3 (2026-03-25)
- Chat-style CLI with welcome screen and thinking spinner
- Silent console mode — all logs to file only
- Fast parallel shutdown
- vole upgrade fixes (single npm install, BRAIN.md scaffolding)
- Dashboard URL reads from VOLE_DASHBOARD_PORT env var

## v1.0.2 (2026-03-24)
- vole upgrade improvements (paw data dirs, BRAIN.md scaffolding)
- vole --version reads from package.json dynamically

## v1.0.1 (2026-03-24)
- IPC transport singleton fix
- --allow-addons for childProcess paws
- paw-computer: desktop automation (mouse, keyboard, screen)

## v1.0.0 (2026-03-23)
- Sub-agent support (spawn_agent + get_agent_result)
- BM25 ranked search in paw-memory
- vole upgrade CLI command
- Filesystem sandbox enabled by default
- BRAIN.md ownership moved to brain paws
- Tool name conflict auto-prefix
- Compact phase reordering (perceive → compact → think)
- 149 tests
- 27 official paws

## v0.4.0 – v0.4.1 (2026-03-22)
- Filesystem sandbox with Node.js --permission model
- Headless mode for vole run
- Schedule persistence fixes
- Parallel paw loading
- Dashboard state refresh coalescing
- CONTRIBUTING.md for both repos

## v0.3.0 – v0.3.1 (2026-03-21)
- Cron scheduling (replacing interval-based)
- Late tool registration for MCP
- Local paw configs (.openvole/paws/)
- Brain narration detection and retry

## v0.1.0 – v0.2.0 (2026-03-20)
- Initial release
- Agent loop, tool registry, paw system, skill system
- Ollama brain paw, Telegram channel
- Memory, session, compact, dashboard paws
- Vault, workspace, heartbeat, scheduling
