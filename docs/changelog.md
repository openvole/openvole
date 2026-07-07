# Changelog

## v4.5.0 (2026-07-07)

> Ships as `openvole` 4.5.0 and `@openvole/dashboard-server` 0.6.0. Skills grow up: a hardened **`skill_run_script`** tool runs a skill's bundled scripts, and VoleHub now installs **multi-file skills** (scripts and all) with per-file integrity hashes. The dashboard gains a **per-paw permission editor**. No breaking changes.

### Skills — bundled scripts, run safely
- **New core tool `skill_run_script`.** Executes a script bundled inside an installed skill (e.g. `scripts/analyze.py`), confined to the skill's own directory — no path escapes. It runs with the skill's declared environment (`requires.env`) plus a PATH/HOME baseline, **not** the engine's full env; the interpreter is picked by extension (`.js`/`.mjs`/`.cjs` → node, `.py` → python, `.sh` → bash), preferring one the skill declares in `requires.bins`. Bounded runtime (120s default, 600s cap) and clipped stdout/stderr. Only runs for skills whose declared requirements are met — the same gate the resolver uses for activation.
- **Skills expose their `basePath`**, so prompts and tools can reference a skill's bundled files.

### VoleHub — multi-file skill install
- **`vole skill install` now fetches everything a skill bundles** — SKILL.md plus scripts/references/assets — from the skill's `files` manifest in INDEX.json, verifying each file's SHA-256 and preserving directory structure. Entries that predate manifests are discovered from the registry; build junk (`__pycache__`, `.pyc`, `.DS_Store`, VCS files) is never fetched or published.
- `vole skill publish` prints the full `files` manifest (with hashes) to add to INDEX.json.

### Dashboard — per-paw permission editor
- **Edit a paw's permission grants from the Paws panel.** Each paw now shows the permissions its manifest *requests* (network, env, filesystem, child processes) next to what the space's config actually *grants*, with toggles to allow or revoke — writes go through the existing config-downgrade guard. Paw cards also show the manifest description, and config writes key paws by their `vole.config.json` identifier (package name or local path), so locally-pathed paws resolve correctly.

### Spaces
- `vole space create` seeds a default `workspace/` directory in each new space (documented in configuration + security docs) — a ready sandbox-friendly place for the agent's working files.

## v4.4.0 (2026-06-23)

> Ships as `openvole` 4.4.0 and `@openvole/dashboard-server` 0.5.0. A space can now expose its own tools over **MCP**; the new **Claude Code brain** (PawHub `@openvole/paw-brain` 2.3.0) can call them back. Also fixes a startup race that was silently dropping brain replies from the chat transcript. No breaking changes.

### Tools over MCP (`/mcp/<space>`)
- **The control plane serves a Model Context Protocol endpoint per space.** `POST /mcp/<space>` exposes that space's registered tools to any MCP client — `tools/list` enumerates them, `tools/call` runs them through the space's normal tool path. It's a stateless, streamable-HTTP MCP server built on the official `@modelcontextprotocol/sdk` (no kernel changes, no `paw-mcp` duplication), and is gated by the dashboard session token (`x-vole-token`).
- The engine injects `VOLE_DASHBOARD_URL` / `VOLE_SPACE_ID` (and the token) into each space, so a paw — e.g. the new Claude Code brain — can find the endpoint and call OpenVole's own tools as `mcp__openvole__<tool>`.

### Fixed — brain replies weren't recorded to chat
- **A paw's bus subscription could be silently dropped at startup.** paw-session records each brain reply by subscribing to `task:completed` from its `onLoad`; that `subscribe` raced `PawRegistry`'s instance registration, and the handler gated `setupBusForwarding` on the instance already existing — so when subscribe won the race the subscription no-opped (no forwarding, nothing logged), and replies were never persisted (worked only intermittently). Forwarding is now set up unconditionally and resolves the instance lazily at event time.
- **The IPC transport now buffers inbound messages that arrive before their handler is registered** (flushed on registration) instead of dropping them — closing the same startup race at the transport layer.
- **`task:completed` / `task:failed` now carry the task's `sessionId`,** so a reply is recorded against the session it belongs to even when tasks interleave (e.g. a heartbeat task between a chat's start and finish).

### Dashboard
- Chat shows a rotating, friendly status (`thinking…`, `pondering…`, `putting it together…`, …) while the brain works, instead of a bare `queued`.

## v4.3.0 (2026-06-22)

> Ships as `openvole` 4.3.0 and `@openvole/dashboard-server` 0.4.0. The VoleNet wire protocol is now **v2** — a breaking change: **all mesh nodes must upgrade together** (mismatched versions reject each other with a clear "unsupported version" error). A security-hardening release across signature integrity, the control-plane dashboard, the paw sandbox, and DoS resistance.

### Security — signature integrity (VoleNet wire protocol v2)
- **Fixed a critical signature-coverage bug: message signatures did not cover nested payload fields.** The canonicalizer used `JSON.stringify(payload, keysArray)`, where the array is a *recursive property allowlist* — so nested data (e.g. a `tool:call`'s `params`) serialized to `{}` and was never signed. On a non-TLS mesh an on-path attacker could rewrite tool arguments while keeping a valid signature. Signing now uses a fully recursive canonical serialization over the entire payload.
- **The message `id` and `timestamp` are now signed**, and a missing/non-numeric `timestamp` is rejected — closing a replay-cache bypass (re-id'ing a captured message) and a freshness bypass (NaN age check).
- **Wire protocol bumped to v2.** Signatures are incompatible with v1 nodes, so **all mesh nodes must upgrade together** (mismatched versions reject with a clear "unsupported version" error).

### Security — dashboard + robustness
- The panel **tool** route now requires a present, matching `Origin` — a token-less curl or cross-site request can no longer execute paw tools (browser same-origin POSTs still work).
- The dashboard HTTP server now handles `error` (e.g. `EADDRINUSE`) instead of crashing.
- VoleNet WS sockets get an error listener before any cap/auth-timeout close (no crash on a close-time socket error); the replay cache + rate windows are cleared on `stop()`.

### Security — DoS hardening
- Per-source rate-limit windows (VoleNet `msgWindow`) and the public-join timestamp map are now pruned, so they can't grow unbounded under IP/connection spray.
- Stdio-framed IPC messages are capped at 32 MB, so a misbehaving paw can't balloon core memory with a huge `Content-Length`.

### Security — paw filesystem sandbox scoping
- **Paws can no longer read outside their sandbox.** The read sandbox was effectively open: the module-path resolver granted recursive read up to the filesystem root (`--allow-fs-read=/`), so any paw — even one with no permissions — could read the vault, the VoleNet private keys, and other paws' data. Reads are now scoped to the paw's own package, its own data dir (`.openvole/paws/<paw>`), `node_modules`, the temp dir, and anything explicitly granted via `allow.filesystem` / `security.allowedPaths`. The project root and `.openvole/` are no longer granted wholesale. (The write sandbox was already scoped.)

### Security — dashboard / control-plane hardening
- **Session token.** The control-plane dashboard is now gated by a session token, so reaching the port is no longer enough to control it (previously it was unauthenticated). `vole serve` generates one (persisted at `<root>/.openvole/dashboard-token`, override with `VOLE_DASHBOARD_TOKEN`) and prints a tokenized URL; the token is required on the page, the WebSocket, and panel routes. The dashboard still binds all interfaces by default for convenience — set `VOLE_DASHBOARD_HOST=127.0.0.1` to restrict it to localhost, and firewall/tunnel the port on public servers.
- **Cross-site protection.** The WebSocket and panel tool routes enforce a same-origin check, closing cross-site WebSocket hijacking (a malicious page you visit can no longer drive your local dashboard).
- **Config-downgrade guard.** `write_config` from the dashboard refuses to weaken the sandbox (`security.sandboxFilesystem: false` or broadening `allowedPaths`); those require a deliberate edit of `vole.config.json` on the server, removing a remote-RCE path.
- **Panel token isolation.** Paw-rendered panels now run in a sandboxed, null-origin iframe (`sandbox="allow-scripts"`) and no longer receive the dashboard token in their URL. A panel's `fetch('tool/…')` calls are proxied through the parent over the authenticated WebSocket — scoped to the panel's own space — via `postMessage`, so a malicious or compromised paw can no longer read the session token, drive other spaces, or reach into the parent dashboard DOM.

### Security — VoleNet message verification (transport-level)
- **Every inbound message is now verified at the transport before any handler runs.** Previously each handler had to check the signature itself, and three subsystems didn't — so an unauthenticated remote peer could trigger `memory:sync`/`session:sync` (disk writes), hijack leader election (`leader:claim`/`leader:heartbeat`), or inject forged `task:result`/`tool:result` into the Brain. Verification — valid signature from an authorized peer — is now a single chokepoint on all three dispatch paths (HTTP, inbound WS, outbound WS); unverified messages are dropped, and the gate fails closed.
- **Replay protection.** A captured signed message could be replayed within the 60s freshness window (e.g. re-executing a `tool:call`). The transport now caches accepted `(from, id)` pairs and drops replays.
- **WebSocket payload cap.** The WS path accepted up to 100 MB per frame (vs 1 MB on HTTP) — a memory-DoS vector — now capped at 1 MB (`maxPayload`) to match.

### Fixed
- **Intermittent hub→follower delivery ("peer offline — not delivered").** After a follower's WebSocket (re)connected, the hub only bound the socket on the follower's next 15s heartbeat, so a message sent in that window fell back to dialing the follower's unreachable (NAT) address and failed — delivery looked random. Nodes now send a signed ping **the instant a WebSocket connects**, so the remote binds it immediately, and the HTTP fallback **fails fast (5s)** instead of hanging when there's no live socket.

### Dashboard
- Config → NET form now exposes the fields that were previously editable only by hand: `hostname`, `maxConnections`, `authTimeoutMs`, `maxMessagesPerSecond`, `publicJoin` (enabled / trustLevel / allowBrain / maxPeers / ratePerMinute / requireApproval), and `chatRetention` (maxMessages / maxAgeDays).

## v4.2.0 (2026-06-21)

### VoleNet — NAT traversal for followers + hardened socket handling
- **Followers behind NAT now work both ways.** A peer joining a hub from behind a router could reach the hub, but the hub couldn't reach back (it dialed the follower's announced LAN address), so the follower never registered the hub. The hub now returns its `discover:response` **inline in the follower's own discover request**, and all hub→follower traffic rides the follower's **persistent WebSocket** — no port-forwarding required.
- **Authenticated socket binding (security fix).** An inbound WebSocket is now bound to a peer id only after a signed message from it **verifies against the keystore**. Previously the binding trusted the unverified `from` field, which — for a peer with no active socket (exactly the NAT case) — could let an attacker claim a victim's id and capture its hub→peer traffic. A socket is also locked to a single identity once authenticated.
- **DoS hardening.** New `net.maxConnections` (cap concurrent inbound WebSockets, default 1000), `net.authTimeoutMs` (close sockets that never authenticate, default 10s), and `net.maxMessagesPerSecond` (global inbound message ceiling / load-shed, default 5000) — on top of the existing per-connection rate limit (1200/min) and 1 MB body cap.

## v4.1.1 (2026-06-21)

### Fixed
- **Paw sandbox crashed network-using paws on Node < 25.** The paw sandbox passed Node a `--allow-net` permission flag for any paw with network/listen access, but that flag only exists in Node 25+. On Node 20–24 the subprocess exited with `bad option: --allow-net` (code 9), so paws like `paw-brain` and `paw-memory` failed to load ("running in no-op Think mode"). The flag is now gated to Node 25+; on older Node network isn't permission-gated (as before), but paws load correctly.

## v4.1.0 (2026-06-21)

### Node-to-node messaging
- **`net_message` core tool** — your Brain can message a peer agent; the peer's Brain replies. Gated by the receiver's `allowBrain` (off by default, even for `trust: "full"`)
- **Human VoleNet-tab chat** — message a connected peer directly from the dashboard's VoleNet tab. Unlike `net_message`, human chat does **not** invoke any Brain; messages are signed, delivered, and persisted via paw-session (per-peer transcript), with an in-memory fallback
- New paw-session `session_append` tool for appending a single entry to a session transcript (backs chat persistence)
- **Chat retention** — VoleNet chat sessions are message-capped (default 1000 per peer) and age-pruned (default 90 days), configurable via `net.chatRetention`; backed by paw-session's new `trimToLast` / `maxMessages`

### VoleNet security hardening
- All remote actions — `tool:call`, `tool:list`, and `task:delegate` — now require an Ed25519-signed message from an authorized peer; unverified messages are rejected. This closes an unauthenticated remote-tool-execution gap
- A peer may call your tools only with explicit `trust: "tool"`/`"full"` in `net.peers`, or when you set `share.tools: true`; per-peer `allowTools`/`denyTools` (glob like `shell_*`) refine it. Tools are not exposed by default
- New `net.publicJoin` — let unknown peers self-register over HTTP at a restricted guest trust level (never `"full"`), with peer cap, per-IP rate limiting, and optional manual approval. Off by default
- **Hybrid post-quantum signatures** — messages are signed with Ed25519 **and** ML-DSA-65 (FIPS 204) when the runtime supports it (Node 24+ / OpenSSL 3.5+, native). Zero-touch migration: keypairs auto-upgrade on start and existing trust auto-upgrades when peers reconnect; both signatures are required between PQ-capable peers (downgrade-resistant), and Ed25519-only nodes stay interoperable
- The `/volenet/message` endpoint is now rate-limited per source and body-size-capped (DoS mitigation)

### Transport encryption (TLS)
- **Native TLS** — set `net.tls.cert`/`net.tls.key` to serve VoleNet over `https`/`wss`; the discovery endpoint, WebSocket upgrade, and HTTP fallback all switch automatically
- New **`net.hostname`** (and `VOLE_NET_HOSTNAME`) advertises a public domain that matches your certificate — required so peers connecting over TLS don't hit a name mismatch. See the [Transport encryption guide](/volenet#transport-encryption-tls)

### Mesh resilience
- VoleNet releases its port cleanly on restart and retries the bind on `EADDRINUSE`
- Configured peers are re-attempted every ~15s, self-healing start-order races, late joiners, and transient drops

### Dashboard
- Live VoleNet peer list in the dashboard's VoleNet tab

### Brain
- paw-brain **mock provider** (`BRAIN_PROVIDER=mock`) for testing — deterministic replies via `BRAIN_MOCK_REPLY` or `BRAIN_MOCK_SCRIPT`

### Onboarding & packaging
- The CLI is now also runnable as **`openvole`** (bin alias), so `npx openvole` works without a global install and avoids the unrelated `vole` package on npm; install docs lead with `npm install -g openvole`
- `vole serve` now hints to run `bash setup.sh` first when the directory isn't an initialized root
- Bumped the optional `dockerode` dependency to `^5.0.0`, which drops the deprecated transitive `uuid@10` — a clean `npm install -g openvole` no longer prints a deprecation warning
- Ships with **paw-brain 2.2.0** (mock provider), **paw-session 2.2.0** (`session_append`, retention), and **@openvole/dashboard-server 0.3.0** (VoleNet tab)

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
