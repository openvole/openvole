# Security

OpenVole takes a defense-in-depth approach to agent safety, with multiple layers of protection.

## Filesystem Sandbox

**Enabled by default.** Every subprocess Paw runs with Node.js permission model restrictions:

- **Read access**: Paw's own package directory, project root, `.openvole/`, `node_modules/`, OS temp directory, parent directories (for module resolution)
- **Write access**: `.openvole/paws/<paw-name>/` (paw's own data directory), OS temp directory
- **Network**: Blocked by default — allowed when paw has `network` or `listen` permissions granted
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

## VoleNet (Distributed Mesh)

When [VoleNet](/volenet) is enabled, nodes exchange signed messages over a shared port. Security is **authenticate, then authorize** on every remote action:

- **Authentication** — every message is Ed25519-signed. Remote actions (`tool:call`, task/brain delegation, chat) are verified against the sender's public key in `.openvole/net/authorized_voles` before anything runs; forged or unknown senders are dropped. Messages older than 60s are rejected (replay protection).
- **Authorization** — an authenticated peer still can't act unless granted:
  - **Tools** — callable only with `tool`/`full` trust in `net.peers`, or `share.tools: true`. `denyTools` wins; an `allowTools` list (globs like `shell_*`) is authoritative. **Off by default.**
  - **Brain** — delegation requires `allowBrain: true` per peer. **Off by default**, even for `full` trust.
- **Trust model** — `authorized_voles` = who may connect (like `~/.ssh/authorized_keys`); per-peer `trust`/`allowTools`/`denyTools`/`allowBrain` = what they may do (like sudoers).
- **Public hubs** — `net.publicJoin` lets strangers self-register at a restricted **guest** trust (never `full`, `allowBrain: false`, rate-limited, peer-capped). Pair with `"demo": true` to lock the hub's config from the dashboard. See [VoleNet › Public mesh hub](/volenet#public-mesh-hub).

::: warning Network exposure
The VoleNet port has **no transport encryption by default** (traffic is signed, not encrypted → eavesdropping) and **no rate limit** on the message endpoint (DoS). Don't expose it raw to the public internet — keep it on a trusted network, behind a firewall allowlist or a VPN overlay (WireGuard/Tailscale), or enable TLS (`tls.cert`/`tls.key`). Use `publicJoin` for intentional public meshes.
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

## For Paw Developers

If your Paw spawns external processes — `child_process.exec()`, `spawn()`, launching binaries (e.g. Puppeteer spawning Chrome), or starting server processes (e.g. MCP servers) — users will need to grant `childProcess: true` in their config for your Paw. Document this in your Paw's README so users know to add it.

Paws that only make HTTP requests, read/write files, or communicate over IPC do not need `childProcess` permission.
