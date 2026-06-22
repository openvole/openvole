# Security

OpenVole takes a defense-in-depth approach to agent safety, with multiple layers of protection.

## Filesystem Sandbox

**Enabled by default.** Every subprocess Paw runs with Node.js permission model restrictions:

- **Read access**: the Paw's own package directory, its own data directory (`.openvole/paws/<paw-name>/`), `node_modules/` (for module resolution), the OS temp directory, plus any path explicitly granted. The project root and `.openvole/` are **not** granted wholesale — a paw can't read the vault, VoleNet private keys, or other paws' data unless you grant it.
- **Write access**: `.openvole/paws/<paw-name>/` (paw's own data directory), OS temp directory
- **Network**: Blocked by default, allowed when the paw has `network`/`listen` granted — **on Node 25+**, where the permission model can gate network access. On Node 20–24 the `--allow-net` flag doesn't exist, so network isn't permission-gated there (paws can reach the network regardless of grants). Run untrusted paws on **Node 25+** or inside Docker.
- **Child processes**: Blocked by default — allowed only when user grants `childProcess: true` in config
- **Additional paths**: Grant via `allow.filesystem` in paw config or `security.allowedPaths` globally
- **Opt-out**: Set `security.sandboxFilesystem: false` to disable (not recommended)

```json
{
  "security": {
    "sandboxFilesystem": true,
    "allowedPaths": ["/home/user/projects"]
  },
  "paws": [
    {
      "name": "@openvole/paw-shell",
      "allow": {
        "filesystem": ["./"],
        "env": ["VOLE_SHELL_ALLOWED_DIRS"],
        "childProcess": true
      }
    }
  ]
}
```

::: warning Child Process Access
Non-Node child processes (shell commands, Chrome, etc.) are **not** restricted by the filesystem sandbox — Node's permission model only applies to Node processes. Granting `childProcess: true` effectively gives the paw unrestricted filesystem access through spawned commands. Only grant this to paws you trust.
:::

## Capability-Based Permissions

Every Paw declares what it needs in its manifest. The user grants permissions in config. Effective permissions are the **intersection** — a Paw can only access what it requested AND what the user approved.

| Layer | What it controls |
|-------|-----------------|
| `network` | Outbound network domains |
| `listen` | Port binding |
| `filesystem` | File/directory access paths |
| `env` | Environment variables passed to subprocess |
| `childProcess` | Ability to spawn child processes |

## Tool Profiles

Per-source tool filtering — restrict what channel users (Telegram, Slack, etc.) can trigger:

```json
{ "toolProfiles": { "paw": { "deny": ["shell_exec", "fs_write"] } } }
```

This prevents external users from executing dangerous operations through messaging channels.

## Vault

Encrypted key-value store at `.openvole/vault.json`:

- **AES-256-GCM encryption** when `VOLE_VAULT_KEY` is set
- **Write-once semantics** — prevents hallucination overwrites
- **Metadata support** — attach service, handle, URL context to entries
- `vault_list` never exposes values

## Rate Limiting

Prevent runaway costs with configurable limits on:

- LLM calls
- Tool executions
- Task enqueue rates

## Dashboard / Control Plane

`vole serve` exposes a web control plane (default `http://localhost:3000`) that can create, start, stop, and chat with every agent and read their data. It is protected by:

- **Session token.** `vole serve` generates a token on first run — persisted at `<root>/.openvole/dashboard-token` (mode `0600`), or supplied via `VOLE_DASHBOARD_TOKEN` — and prints a tokenized URL. The token is required on the page, the WebSocket, and panel routes, so reaching the port is **not** enough to control the dashboard.
- **Bind address.** Binds all interfaces (`0.0.0.0`) by default for convenience. Set `VOLE_DASHBOARD_HOST=127.0.0.1` to restrict it to localhost.
- **Same-origin enforcement.** The WebSocket and panel-tool routes require a matching `Origin`, blocking cross-site WebSocket hijacking and token-less cross-site tool calls.
- **Sandboxed paw panels.** Paw-rendered panels run in a null-origin (`sandbox="allow-scripts"`) iframe and never receive the token; their tool calls are proxied through the authenticated WebSocket, scoped to that panel's own space. A malicious paw panel can't read the token or drive other spaces.
- **Config-downgrade guard.** Editing config from the dashboard cannot weaken the sandbox (`sandboxFilesystem: false` or broadening `allowedPaths`); those require editing `vole.config.json` on the server directly, closing a remote-RCE path.

::: warning Public exposure
Never expose port 3000 raw on a public network. Keep the token secret, prefer `VOLE_DASHBOARD_HOST=127.0.0.1` for local use, and put any remote access behind a firewall allowlist, VPN, or an authenticating reverse proxy.
:::

## VoleNet (Distributed Mesh)

When [VoleNet](/volenet) is enabled, nodes exchange signed messages over a shared port. Security is **authenticate, then authorize** on every remote action:

- **Authentication** — every message is Ed25519-signed over its full canonical form: type, sender, recipient, **id**, **timestamp**, and the **entire payload** (including nested tool arguments), so nothing can be altered without invalidating the signature. Verification happens **at the transport, before any handler runs** — a valid signature from a peer in `.openvole/net/authorized_voles` is required on every dispatch path (HTTP and WebSocket), and forged or unknown senders are dropped (fail-closed). Messages older than 60s are rejected, and accepted `(sender, id)` pairs are cached so a captured message can't be replayed within that window.
- **Authorization** — an authenticated peer still can't act unless granted:
  - **Tools** — callable only with `tool`/`full` trust in `net.peers`, or `share.tools: true`. `denyTools` wins; an `allowTools` list (globs like `shell_*`) is authoritative. **Off by default.**
  - **Brain** — delegation requires `allowBrain: true` per peer. **Off by default**, even for `full` trust.
- **Trust model** — `authorized_voles` = who may connect (like `~/.ssh/authorized_keys`); per-peer `trust`/`allowTools`/`denyTools`/`allowBrain` = what they may do (like sudoers).
- **Public hubs** — `net.publicJoin` lets strangers self-register at a restricted **guest** trust (never `full`, `allowBrain: false`, rate-limited, peer-capped). Pair with `"demo": true` to lock the hub's config from the dashboard. See [VoleNet › Public mesh hub](/volenet#public-mesh-hub).

::: warning Network exposure
The VoleNet port has **no transport encryption by default** — traffic is signed (unforgeable) but not encrypted, so it can be eavesdropped. The message endpoint *is* rate-limited (1200/min per connection) and body-capped (1 MB). For public exposure, enable [TLS](/volenet#transport-encryption-tls) (`tls.cert`/`tls.key` + a matching `hostname`) and use `publicJoin` for intentional public meshes. Otherwise keep it on a trusted network, behind a firewall allowlist or a VPN overlay (WireGuard/Tailscale).
:::

::: tip Post-quantum
Message signatures are **hybrid Ed25519 + ML-DSA-65** (FIPS 204) when the runtime supports it (Node 24+ / OpenSSL 3.5+ — native, no extra dependency). Migration is zero-touch: keypairs auto-upgrade with a PQ key on start, and trust entries upgrade automatically when peers reconnect (the PQ key rides the Ed25519-signed discovery, so it's authenticated; self-join stays **add-only** so a guest can't poison a peer's PQ key). Between PQ-capable peers both signatures are required and verified (an attacker can't strip the PQ signature to downgrade), while older Ed25519-only nodes remain interoperable.
:::

## Additional Safeguards

| Concern | Approach |
|---------|----------|
| Paw isolation | Subprocess sandbox with Node.js `--permission` flags |
| Credentials | Each Paw owns its secrets — core never sees them |
| Runaway agent | `maxIterations` + rate limiting + `confirmBeforeAct` |
| Channel safety | Tool profiles restrict which tools each task source can use |
| Vault | AES-256-GCM encryption, write-once semantics |
| Dashboard access | Session token + same-origin checks + sandboxed paw panels |

## For Paw Developers

If your Paw spawns external processes — `child_process.exec()`, `spawn()`, launching binaries (e.g. Puppeteer spawning Chrome), or starting server processes (e.g. MCP servers) — users will need to grant `childProcess: true` in their config for your Paw. Document this in your Paw's README so users know to add it.

Paws that only make HTTP requests, read/write files, or communicate over IPC do not need `childProcess` permission.
