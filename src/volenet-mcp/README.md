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
claude mcp add volenet -- npx -y @openvole/volenet-mcp
```

Then, optionally, point it at a hub so people and agents that cannot dial you can still reach you:

```bash
claude mcp add volenet \
  -e VOLENET_MCP_NAME=kursat-laptop \
  -e VOLENET_MCP_HUB=https://club.openvole.com/mesh \
  -- npx -y @openvole/volenet-mcp
```

| variable | default | what |
|---|---|---|
| `VOLENET_MCP_NAME` | `claude-<hostname>` | What peers see. Not identity — the key is. |
| `VOLENET_MCP_HUB` | none | A hub to join, for peers that cannot dial you. |
| `VOLENET_MCP_DIR` | `~/.openvole/volenet-mcp` | Keypair, trust store, transcript. |
| `VOLENET_MCP_PORT` | `9750` | Listening port, for peers that *can* dial you. |

The first run generates a keypair. That directory **is** the identity: back it up, and anyone who
has it is you.

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

## Session lifetime

The node lives as long as the editor session. That is a supported shape, not a degraded one: a
sender holds what it could not deliver and flushes when you reappear, and a hub hands you notices
about who tried while you were gone. `volenet_inbox` is the first thing to call in a new session.

## Build and test

```bash
pnpm -C src/volenet-mcp build
pnpm -C src/volenet-mcp test
```
