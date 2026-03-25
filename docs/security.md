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
