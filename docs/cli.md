# CLI Commands

The `vole` CLI is the primary interface for managing your OpenVole agent.

::: tip
Install with `npm install -g openvole` (the package is **openvole**; the command is `vole`). To run without installing: `npx openvole <command>` — **not** `npx vole`, which is an unrelated package.
:::

::: warning Removed commands
The single-engine commands `vole init`, `vole start`, and `vole run` have been removed. OpenVole now runs as a **server** — use [`vole serve`](#dashboard-agents); every agent is fully isolated (its own config, paws, identity, and data).
:::

## Dashboard & Agents

### `vole serve`

Start the **control-plane dashboard** — one web server that manages all your agents from the browser. This is the primary way to run and operate OpenVole.

```bash
vole serve
```

By default it listens on `http://localhost:3000`; set `VOLE_DASHBOARD_PORT` to change the port.

On first run it generates a **session token** (persisted at `<root>/.openvole/dashboard-token`, or supply `VOLE_DASHBOARD_TOKEN`) and prints a tokenized URL — open *that* URL; the token is required to reach the dashboard, its WebSocket, and panel routes. It binds all interfaces (`0.0.0.0`) by default; set `VOLE_DASHBOARD_HOST=127.0.0.1` to restrict it to localhost. See [Security › Dashboard / Control Plane](/security#dashboard-control-plane).

**Root resolution** — `vole serve` operates on an OpenVole *root* directory (which holds an `agents.json` registry; a legacy `spaces.json` root is recognized too). The root is resolved in this order:

1. `VOLE_HOME` if set — an explicit override that always wins.
2. Otherwise the current directory, if it is already a root (contains `agents.json`).
3. Otherwise the current directory, if it is empty (ignoring `.DS_Store`, `.git`, `.gitignore`) — it becomes a **new** root.
4. Otherwise it refuses to start with a clear error. If a legacy `~/.openvole` with agents exists, it prints how to reach it.

```bash
# Use a dedicated directory as your root
mkdir ~/agents && cd ~/agents && vole serve

# Or pin a fixed root from anywhere
VOLE_HOME=~/agents vole serve
```

> [!NOTE]
> The implicit global `~/.openvole` root (used regardless of the current directory) is gone. If your agents live there, run `cd ~/.openvole && vole serve` or `VOLE_HOME=~/.openvole vole serve`.

See the [Dashboard guide](/dashboard) for the full walkthrough.

### `vole agent`

Manage agents from the CLI. (The dashboard's agent switcher does the same things visually.) These commands operate on the same **root** `vole serve` resolves — `VOLE_HOME` if set, else the current directory when it is a root or empty — so run them from your server directory.

> [!NOTE]
> Agents were called **spaces** before v4.6. `vole space …` still works as a deprecated alias, a legacy `spaces.json` registry is read transparently (the next write migrates it to `agents.json`), and an existing `space-template` is still honored.

| Command | Description |
|---------|-------------|
| `vole agent create <name>` | Scaffold a new agent (clones your template if set). Add `--orchestrator` to let it manage its siblings. |
| `vole agent orchestrate <name> [on\|off]` | Grant or revoke an agent's authority to manage its siblings (see below). |
| `vole agent template` | Create or locate the template that new agents clone. |
| `vole agent list` | List agents and their running status. |
| `vole agent status [name]` | Show live status (pid, port). |
| `vole agent start <name>` | Start an agent's engine (its own process). |
| `vole agent stop <name> \| --all` | Stop an agent (or all agents). |
| `vole agent switch <name>` | Set the active agent. |
| `vole agent remove <name> [--purge]` | Remove an agent. Add `--purge` to delete its files on disk. |

```bash
vole agent create research
vole agent start research
vole agent list
```

> [!WARNING]
> `vole agent remove <name>` removes the agent from the registry but **keeps its files**. Add `--purge` to permanently delete the agent's directory (config, identity, installed paws, data). Deleting an agent from the dashboard is equivalent to `--purge`.

#### Orchestrator agents

An agent flagged as **orchestrator** gets a set of `agent_*` tools when it runs under `vole serve`: list siblings, submit tasks to them, read/write their config and identity files, restart/start/stop them, and create new agents. This lets one agent supervise the others — pair it with the `vole-orchestrate` skill from VoleHub for the playbook.

- The flag lives in the server's `agents.json` registry — **outside every agent's sandbox** — and the control plane re-checks it on every request, so `off` takes effect immediately. Granting (`on`) requires restarting the agent under `vole serve`.
- Guardrails: an orchestrator cannot stop/start/restart **itself**, cannot **remove** agents at all, and config writes go through the same sandbox-weakening refusal as the dashboard.
- Detached agents (`vole agent start`) have no control channel — orchestrator tools require `vole serve`.
- Creating (or granting) an orchestrator **seeds an orchestrator `AGENT.md` brief** — unless you've already customized the identity, which is never overwritten. The system prompt also states the authority whenever the `agent_*` tools are registered, so the agent always knows what it is.

## Paw Management

### `vole paw add`

Install a Paw from npm and add it to your config.

```bash
vole paw add @openvole/paw-telegram
vole paw add @openvole/paw-browser
```

### `vole paw remove`

Remove an installed Paw.

```bash
vole paw remove @openvole/paw-telegram
```

### `vole paw list`

List all loaded Paws.

```bash
vole paw list
```

### `vole paw create`

Scaffold a new Paw project.

```bash
vole paw create my-custom-paw
```

## Skill Management

### `vole skill add`

Add a local skill.

```bash
vole skill add my-skill
```

### `vole skill remove`

Remove a skill.

```bash
vole skill remove my-skill
```

### `vole skill list`

List all loaded skills.

```bash
vole skill list
```

### `vole skill create`

Create a new local skill with a template SKILL.md.

```bash
vole skill create email-triage
```

## VoleHub

[VoleHub](https://github.com/openvole/volehub) is OpenVole's skill registry. Installs pull **every bundled file** (SKILL.md + scripts/references) and verify each against a per-file SHA-256 in the registry's `INDEX.json`.

### `vole skill install`

Install a skill (and all its files) from VoleHub.

```bash
vole skill install resolve-autocut
```

### `vole skill hub` / `vole skill uninstall`

List installed VoleHub skills, or remove one.

```bash
vole skill hub
vole skill uninstall resolve-autocut
```

### `vole skill publish`

Print a skill's `files` manifest (paths + SHA-256 hashes) to add to `INDEX.json` when contributing to VoleHub.

```bash
vole skill publish ./skills/my-skill
```

## ClawHub

### `vole clawhub install`

Install a skill from [ClawHub](https://clawhub.ai).

```bash
vole clawhub install summarize
```

### `vole clawhub remove`

Remove an installed ClawHub skill.

```bash
vole clawhub remove summarize
```

### `vole clawhub search`

Search for skills on ClawHub.

```bash
vole clawhub search email
```

## Tool Commands

### `vole tool list`

List all registered tools (from manifests, no paw spawning).

```bash
vole tool list
```

Use `--live` to boot the full engine and discover MCP tools:

```bash
vole tool list --live
```

### `vole tool call`

Call a tool directly without going through the Brain. Useful for debugging.

```bash
vole tool call list_schedules
```

## VoleNet

Distributed agent networking. See [Configuration → `net`](/configuration#net-volenet) for the config fields.

### `vole net init`

Generate an Ed25519 keypair for this instance. Pass an optional name.

```bash
vole net init my-instance
```

### `vole net show-key`

Display this instance's public key — share it with peers so they can trust you.

```bash
vole net show-key
```

### `vole net trust`

Trust a peer's public key (paste the string from their `vole net show-key`).

```bash
vole net trust "vole-ed25519 ..."
```

### `vole net join`

Join a public mesh hub: registers with the hub over HTTP, trusts its key, and adds it as a peer in `vole.config.json`. Use `--name` to set the name advertised to the hub.

```bash
vole net join https://hub.example.com:9700 --name my-laptop
```

### `vole net revoke`

Remove trust for a peer by instance ID or key.

```bash
vole net revoke <instance-id-or-key>
```

### `vole net peers`

List trusted peers.

```bash
vole net peers
```

### `vole net status`

Show a network status overview.

```bash
vole net status
```

## Utility Commands

### `vole upgrade`

Upgrade OpenVole and all installed paws to their latest versions.

```bash
vole upgrade
```

### `vole --version`

Show the installed OpenVole version.

```bash
vole --version
```
