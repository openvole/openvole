# Dashboard

`vole serve` starts the **control-plane dashboard** — one web server that manages all of your OpenVole agents from a single place in the browser. This is the primary way to run and operate OpenVole.

```bash
vole serve
```

By default it listens on `http://localhost:3000`. Set `VOLE_DASHBOARD_PORT` to use a different port.

> [!NOTE]
> The control-plane dashboard replaces the old "one dashboard per project" model. The legacy `@openvole/paw-dashboard` is deprecated in its favor — see [Infrastructure Paws](/paws-infrastructure#paw-dashboard-deprecated). The single-engine `vole init` / `vole start` / `vole run` commands have been **removed** — OpenVole now runs as a server, and every agent is a space.

## Spaces

A **space** is an isolated agent — its own `vole.config.json`, paws, identity files, and data directory. Each running space is its own engine subprocess, parented to the `vole serve` process (not detached, so stopping `vole serve` stops them too).

One `vole serve` process manages every space under a single OpenVole **root** directory. Spaces are recorded in a `spaces.json` registry at the root.

## Root Resolution

When you run `vole serve`, the OpenVole root is resolved in this order:

1. **`VOLE_HOME`** — if set, this explicit override always wins.
2. **The current directory, if it is already a root** — it contains a `spaces.json` registry file.
3. **The current directory, if it is empty** — ignoring incidental files (`.DS_Store`, `.git`, `.gitignore`). It then becomes a **new** root.
4. **Otherwise it refuses to start** with a clear error. If a legacy `~/.openvole` with spaces exists, it tells you how to reach it.

On startup it logs the resolved root (with `(new)` if freshly created) and the tokenized dashboard URL:

```
OpenVole root: /Users/me/agents  (new)
Manage your spaces at http://localhost:3000/?token=3f9c2a…
```

> [!IMPORTANT]
> The dashboard is gated by a **session token**, generated on first run and persisted at `<root>/.openvole/dashboard-token` (or set `VOLE_DASHBOARD_TOKEN`). Open the printed URL — the token is required to reach the dashboard. It binds all interfaces by default; set `VOLE_DASHBOARD_HOST=127.0.0.1` for localhost-only, and never expose the port raw on a public network. See [Security › Dashboard / Control Plane](/security#dashboard-control-plane).

> [!TIP]
> Pick a directory to be your OpenVole root and run `vole serve` there — for example `mkdir ~/agents && cd ~/agents && vole serve`. To always serve a fixed root regardless of where you are, set `VOLE_HOME`:
> ```bash
> VOLE_HOME=~/agents vole serve
> ```

> [!WARNING]
> The old behavior — an implicit global `~/.openvole` regardless of the current directory — is gone. If your existing spaces live at `~/.openvole`, reach them with `cd ~/.openvole && vole serve` or `VOLE_HOME=~/.openvole vole serve`. The error message prints these for you.

## The Dashboard

The header has a **space switcher** to create, start, stop, switch between, and delete spaces. Each space has five tabs:

| Tab | What it shows |
|------|---------------|
| **Overview** | Paws (with health), tools, skills, tasks, schedules, and a live event log. |
| **Chat** | Talk to the agent — multiple chat sessions per channel, rendered as markdown. |
| **Apps** | Embedded paw panels (see below). Always visible. |
| **Config** | Structured form editor for the entire `vole.config.json` (see below). |
| **Identity** | Edit `SOUL.md`, `USER.md`, `AGENT.md`, `HEARTBEAT.md`, and `BRAIN.md`. |

## Creating a Space

Click **New space** in the header to open the new-space form. Enter a name, and on successful create an **onboarding** step suggests the essential paws, pre-checked:

- `@openvole/paw-brain`
- `@openvole/paw-session`
- `@openvole/paw-memory`
- `@openvole/paw-compact`
- `@openvole/paw-shell`

Whichever you keep selected are installed into the new space. (You can install more from the Config tab afterwards.)

The CLI equivalent is `vole space create <name>` — see [CLI Commands](/cli#vole-space).

## Deleting a Space

Deleting a space from the dashboard **permanently deletes its directory on disk** — config, identity, installed paws, and data — after a destructive confirmation.

> [!WARNING]
> Deletion from the dashboard is equivalent to `vole space remove <name> --purge`. The CLI's `vole space remove <name>` **without** `--purge` removes the space from the registry but keeps its files on disk.

## Config Tab

The Config tab is a fully **structured form** — no raw-JSON textareas. Edit every section of `vole.config.json` with typed fields:

- **brain** — dropdown of installed brain paws
- **loop** — iterations, compaction, tool horizon, context budget, cost tracking
- **heartbeat** — enabled, interval, run-on-start
- **security** — sandbox toggle and per-paw filesystem paths
- **docker sandbox** — image, limits, network mode
- **rate limits** — LLM/tool/task throttles
- **tool profiles** — per-source allow/deny lists
- **AGENTS** — named sub-agent profiles (role, instructions, allowTools, denyTools, maxIterations)
- **NET (VoleNet)** — fully structured with an on/off **toggle** for `enabled`, plus peers, share (tools/memory/session), TLS, routing, and the various modes

See [Configuration](/configuration) for what each field means.

## Apps — Embedded Paw Panels

Any paw can contribute its own UI to the dashboard. The **Apps** tab is always visible and shows one entry per panel-contributing paw in a left vertical nav, each rendered as a sandboxed `iframe`. If a space has no panel paws, an empty state explains how to add one.

Panels are **brain-free** — a panel's tool calls go straight to the paw over IPC, with no LLM — and there are **no per-paw web servers and no extra ports**; everything flows through the single control-plane server.

To add a panel to your own paw, see **[Build an Embedded App](/paws#build-an-embedded-app)**.

### Reference example

`@openvole/paw-markets` is a US-stock tracking paw whose **Markets** panel embeds this way. Install it into a space from the Config tab and start the space — its panel appears under the Apps tab.

## Tools over MCP

The control plane exposes each running space's own tools over the **Model Context Protocol** at `POST /mcp/<space>`, so an MCP client can drive a space's tools directly:

- `tools/list` enumerates the space's registered tools; `tools/call` runs one through the space's normal tool path (the same execution the brain uses).
- It's a stateless, streamable-HTTP MCP server built on the official `@modelcontextprotocol/sdk` — no extra ports, no per-paw servers.
- **Token-gated:** requests must carry the dashboard session token in the `x-vole-token` header.

The main consumer is the **[Claude Code brain](/paws-brain#claude-code-provider-local-cli)**: with `CLAUDE_CODE_EXPOSE_TOOLS=1`, Claude Code calls OpenVole's own tools as `mcp__openvole__<tool>` through this endpoint. The engine injects `VOLE_DASHBOARD_URL`, `VOLE_SPACE_ID`, and the token into each space, so it wires up automatically under `vole serve`.

## VoleNet Tab

The **VoleNet** tab is for talking to the *humans* behind your connected peer nodes. It has two parts:

- **Peer list** — every connected peer node, refreshed live (about every 5 seconds) with an online dot so dead peers drop off and new ones appear as they connect.
- **Per-peer chat** — pick a peer and chat with the person operating that node. Replies are answered by a **human**, not the brain, so there is **no LLM cost**. Each conversation is persisted in its own `volenet:<peerId>` [paw-session](/paws-infrastructure#paw-session) (with an in-memory fallback), so transcripts survive restarts.

This is the human-to-human messaging mode. Cross-node chat where the peer's *brain* replies automatically is a separate, brain-callable tool — the `net_message` tool — described under [VoleNet](/volenet).
