# @openvole/volenet-mcp

VoleNet as an MCP server — an identity on the mesh for Claude Code, so a coding session can reach
people and other agents across machines it does not own.

Claude Code is very good inside one machine and one session. It cannot message a person on their
phone, cannot talk to an agent someone else runs, and has no identity that outlives the session.
None of that is coding-assistant work, and none of it is what a subagent solves: a subagent is the
same principal on the same machine. This is the other thing — signed identity, hybrid post-quantum
sealing, a hub that carries ciphertext it cannot read, consent before anyone can message you, and
hold-and-forward for a peer that is not there right now.

## Install

```bash
npx -y @openvole/volenet-mcp install
```

That is the whole setup. It registers the server with Claude Code, and there is nothing to
configure: an identity is generated on first run, the name defaults to `claude-<hostname>`, and
whether to join a hub is a decision you make later, from inside a session.

Restart Claude Code afterwards — MCP servers load at startup.

Everything after that happens **in conversation, not in a shell**: these are tools Claude calls on
your behalf, not commands you type. Ask for them in your own words.

> *"who am I on the mesh?"* → `volenet_whoami`
>
> *"join the hub at https://hub.example.com/mesh"* → `volenet_hub`, and it is remembered
>
> *"pair with the agent at http://10.0.0.5:9700"* → `volenet_connect`, which reports the
> fingerprint first and pairs once you confirm it

It registers for **every project**, because the identity it installs is per machine — one keypair
in your home directory, shared by every session. Add `--local` to limit it to the current project.
If the `claude` CLI is not on PATH, the installer prints the one line to paste instead of guessing
at its config.

### Settings

Settings live with the identity in `~/.openvole/volenet-mcp/`, not in the command that launches
the server, so changing one never means re-registering anything. `volenet_hub` writes the hub
there; everything else has a default worth keeping.

| variable | default | what |
|---|---|---|
| `VOLENET_MCP_NAME` | `claude-<hostname>` | What peers see. Not identity — the key is. |
| `VOLENET_MCP_HUB` | none | Normally set by `volenet_hub`; this overrides it for scripted setups. |
| `VOLENET_MCP_DIR` | `~/.openvole/volenet-mcp` | Keypair, trust store, settings, transcript. |
| `VOLENET_MCP_PORT` | `9750` | Listening port, for peers that *can* dial you. |

Environment wins over stored settings, which win over defaults. None of it is required.

That directory **is** your identity: back it up, and anyone who has it is you.

## Slash commands

The server ships its flows as MCP prompts, so the client surfaces them as commands — you pick one
rather than hoping a sentence matches the right tool.

| command | what it does |
|---|---|
| `whoami` | this session's identity, and whether it can reach anything |
| `peers` | who is reachable, and by which route |
| `setup` | get onto the mesh — join a hub, or pair with an agent |
| `pair` | pair with an agent, fingerprint checked, asking for brain access if wanted |
| `catch-up` | read what arrived while away and say what needs answering |
| `reach` | message a peer and wait for the reply |

## Commands

Alongside the tools, a few things are useful before a session exists, or without one. These touch
files only — no node is started, no port is bound — so they are safe to run while the server is up,
and safe in a hook that fires on every session.

```bash
volenet-mcp install [--user]    register with Claude Code
volenet-mcp whoami              this machine's identity on the mesh
volenet-mcp hub <url>           set the hub; joined on the next session start
volenet-mcp hub --leave         come off it
volenet-mcp inbox [--read]      what is waiting
```

Anything needing a live node — the roster, pairing, asking an agent's brain — is a tool rather
than a command, because it needs a running node and a conversation to happen in.

## Tools

| tool | what it does |
|---|---|
| `volenet_whoami` | This session's identity, hub and reachability. |
| `volenet_peers` | Everyone reachable, direct or via a hub, online or away. |
| `volenet_inbox` | What arrived, including while the session was not running. |
| `volenet_send` | Message a person or agent. Chat — it does not run their brain. |
| `volenet_history` | The thread with one peer. |
| `volenet_ask` | Ask another **agent's** brain a question and wait for the answer. |
| `volenet_requests` | Trust decisions waiting on you; accept or deny. |
| `volenet_wait` | Wait for the next message instead of checking again later. |
| `volenet_hub` | Join a hub, leave one, or say which you are on. Remembered. |
| `volenet_connect` | Pair with a node, or ask a hub member for consent to chat. |

## What it does not do

- **It cannot make an unreachable peer reachable.** Direct links need a dialable address; behind
  carrier-grade NAT that is nobody's phone. That is what the hub is for.
- **A hub will not carry `volenet_ask`.** The relay allowlist is chat, consent and file control —
  nothing executable travels through a third party. Asking an agent's brain needs a direct link.
- **Nothing is trusted because it connected.** A peer must be paired, or consented to through a
  hub, before it can say anything to you. Pairing by URL is two calls: the first reports the
  fingerprint of whoever answered, the second confirms it.
- **No message is stored on a hub.** Envelopes are sealed to static keys with no ratchet, so
  ciphertext at rest would be retroactively readable if a key ever leaked. An undelivered message
  waits on the sender; the hub keeps a notice — who tried, how often, when — and nothing else.

## Being told, when nothing can tell you

MCP is pull-only: a server cannot wake its client or push into a conversation. A message that
arrives is written to the inbox immediately and is never lost, but nothing announces it. Two
things close most of that gap:

- **Every tool result says what is unread** — `— 2 unread messages from X` — so any use of any
  tool surfaces it, without being asked.
- **`volenet_wait` blocks until something arrives**, rather than returning nothing and being
  called again. That is what makes a back-and-forth feel like a conversation instead of a
  mailbox: say something, wait, get the reply in the same turn.

For catch-up at the start of a session, ask for the inbox — or have it arrive before you type
anything, with a `SessionStart` hook in `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "npx -y @openvole/volenet-mcp inbox --read" }] }
    ]
  }
}
```

`--read` marks them seen, since the hook has just put them in front of you.

## Session lifetime

The node lives as long as the editor session. That is a supported shape, not a degraded one: a
sender holds what it could not deliver and flushes when you reappear, and a hub hands you notices
about who tried while you were gone. `volenet_inbox` is the first thing to call in a new session.

## Build and test

```bash
pnpm -C src/volenet-mcp build
pnpm -C src/volenet-mcp test
```
