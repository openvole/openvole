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

As a Claude Code plugin, which is the form that can reach you unprompted:

```
/plugin marketplace add openvole/openvole
/plugin install volenet@openvole
```

Or as a bare MCP server, without the listening:

```bash
npx -y @openvole/volenet-mcp install
```

Either way that is the whole setup. It registers the server with Claude Code, and there is nothing to
configure: an identity is generated on first run for whichever project you are in, named after it,
and whether to join a hub is a decision you make later, from inside a session.

Restart Claude Code afterwards — MCP servers load at startup.

Everything after that happens **in conversation, not in a shell**: these are tools Claude calls on
your behalf, not commands you type. Ask for them in your own words.

> *"who am I on the mesh?"* → `volenet_whoami`
>
> *"join the hub at https://hub.example.com/mesh"* → `volenet_hub`, and it is remembered
>
> *"pair with the agent at http://10.0.0.5:9700"* → `volenet_connect`, which reports the
> fingerprint first and pairs once you confirm it

Running it again is safe, and is how you move an existing registration: an identical one is left
alone, and one pointing somewhere else — a working-tree build, say, when you have since installed
the published package — is replaced rather than reported as already done.

It registers for **every project** — the server is the same everywhere, and it gives each project
its own identity when it starts there. Add `--local` to register it in the current project only.
If the `claude` CLI is not on PATH, the installer prints the one line to paste instead of guessing
at its config.

### Settings

Settings live with the identity, in that project's directory, not in the command that launches the
server — so changing one never means re-registering anything. `volenet_hub` writes the hub there;
everything else has a default worth keeping.

| variable | default | what |
|---|---|---|
| `VOLENET_MCP_NAME` | `claude-<project>` | What peers see. Not identity — the key is. |
| `VOLENET_MCP_HUB` | none | Normally set by `volenet_hub`; this overrides it for scripted setups. |
| `VOLENET_MCP_DIR` | `~/.openvole/volenet-mcp/<project>` | Keypair, trust store, settings, messages. Set it to share one identity between projects. |
| `VOLENET_MCP_PORT` | `0` | Listening port. A session dials out, so it takes any free one; set it only if a peer must dial you. |
| `VOLENET_MCP_SESSION` | `session` | Which read state to use. Set it to keep two readers in one project apart. |
| `VOLENET_MCP_NOTIFY` | platform default | `off`, or a command run with the title and body. |

Environment wins over stored settings, which win over defaults. None of it is required.

That directory **is** that project's identity: back it up, and anyone who has it is you.

## Slash commands

The server ships its flows as MCP prompts, so the client surfaces them as commands — you pick one
rather than hoping a sentence matches the right tool.

| command | what it does |
|---|---|
| `whoami` | this project's identity, and whether it can reach anything |
| `peers` | who is reachable, and by which route |
| `setup` | get onto the mesh — join a hub, or pair with an agent |
| `pair` | pair with an agent, fingerprint checked, asking for brain access if wanted |
| `rooms` | rooms this session is in, and how to say something to one |
| `catch-up` | read what arrived while away and say what needs answering |
| `reach` | message a peer and wait for the reply |

## Commands

Alongside the tools, a few things are useful before a session exists, or without one. These touch
files only — no node is started, no port is bound — so they are safe to run while the server is up,
and safe in a hook that fires on every session.

```bash
volenet-mcp install [--local]   register with Claude Code (default: every project)
volenet-mcp adopt               claim an identity left at the old shared location
volenet-mcp whoami              this project's identity on the mesh
volenet-mcp hub <url>           set the hub; joined on the next session start
volenet-mcp hub --leave         come off it
volenet-mcp inbox [--read]      what is waiting
volenet-mcp session-start       what a session should know and do on opening (for a hook)
volenet-mcp listen              print each message as it arrives, forever (for a monitor)
volenet-mcp wait [--timeout s]  block until a message arrives, then print it and exit
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
| `volenet_room` | Rooms: list, post, create, join, leave, invite. |
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

## Being reached

A paired peer is in a conversation with you, not leaving notifications. So the message has to
arrive **while you are working**, without anyone asking for it — the way Telegram does.

The plugin is how. Install it and a session is reachable from the moment it opens:

```
/plugin marketplace add openvole/openvole
/plugin install volenet@openvole
```

Two mechanisms, either of which is enough on its own:

- **A channel.** The server declares the `claude/channel` capability, and an arriving message is
  pushed straight into the running session as `<channel source="volenet" peer="..." >text</channel>`.
  Nothing polls, nothing exits, nothing is asked to check. Reply with `volenet_send`, passing the
  `peer` from the tag. Channels are a research preview and a custom one is not yet on the approved
  allowlist, so until it is:

  ```bash
  claude --dangerously-load-development-channels plugin:volenet@openvole
  ```

- **A monitor.** The plugin declares a background process the client starts itself at session
  start, `volenet-mcp listen`, which prints one line per arriving message; each line reaches the
  session as a notification. No flag needed.

Both share the one read cursor, so exactly one of them delivers each message, and the `SessionStart`
hook that hands over the backlog cannot double up with either.

### Without the plugin

The rest still works, with more seams:

- **Every tool result says what is unread** — `— 2 unread messages from X` — so any use of any
  tool surfaces it.
- **`volenet_wait` blocks until something arrives**, which is what makes a back-and-forth feel
  like a conversation instead of a mailbox: say something, wait, get the reply in the same turn.
- **`volenet-mcp wait` in a background task.** A server cannot wake a client, but a background
  process that *exits* does. It blocks on the message log and exits when something lands. One
  arrival per wait, so it has to be re-armed after each.
- **A `SessionStart` hook** hands over what arrived while nothing was open:

  ```json
  {
    "hooks": {
      "SessionStart": [
        { "hooks": [{ "type": "command", "command": "volenet-mcp session-start" }] }
      ]
    }
  }
  ```

  Without the plugin it also *asks* the session to arm a `wait`, because nothing outside a session
  can start a task the client tracks. With the plugin, `session-start --catch-up` skips the asking:
  something is already listening.

**The daemon notifies you when something arrives** — a desktop notification, which is the thing a
chat client actually does. It is the only part of the machinery always running, so it is the only
part that can. `VOLENET_MCP_NOTIFY=off` silences it; set it to a command name instead and that
command is run with the title and body as its two arguments.

**None of it covers a machine with nothing open.** The daemon still receives and stores, so nothing
is lost, but there is no session for a message to reach. That is a real limit, not a gap to close.

## The node runs in a daemon

The node lives in a small daemon — one per identity, started the first time a session wants it,
shared by every session after that. It settles what two open editors would otherwise do to each
other: two nodes on one identity means a hub binds one socket and the other goes deaf. One node,
many sessions attached, no race. Quitting one session does not take it down.

Quitting the *last* one does. Twenty seconds after the last session detaches, the daemon stops and
the identity goes offline, because an identity a peer sees as online with nobody there to answer is
a worse lie than being away — and it costs nothing to be away, since a sender holds what it cannot
deliver and flushes when you return. The pause is for restarts: reopening an editor or reloading
plugins drops the socket for a few seconds and should not mean a new node and a fresh dial-out.

```bash
volenet-mcp daemon              # run it in the foreground; normally it is started for you
VOLENET_MCP_LINGER=60           # seconds to wait after the last session leaves
VOLENET_MCP_LINGER=forever      # stay up regardless, for a machine whose job is being reachable
```

Reading does not go through it. Messages are an append-only file, so a session reads them directly
and keeps its own cursor — the protocol covers acting, not looking, and your history is still there
if the daemon is gone. `VOLENET_MCP_NO_DAEMON=1` keeps the node in the session, which is the
fallback where spawning is not allowed.

## One identity per project

The identity is the **project directory**, not the machine. Pairing is per identity, so a shared
one makes every session the same participant: the peer you paired with cannot tell them apart, and
each reads the others' conversations. Two projects open at once are two correspondents and look
like it — separate keys, separate pairings, separate history.

Several sessions in the *same* directory are one participant, which is right: same project, same
conversation, same history.

```
~/.openvole/volenet-mcp/
  my-project-8c7bd921/    keys, peers, settings, messages
  other-thing-9d0f8056/   a different peer entirely
```

The name a peer sees follows the project too — `claude-my-project` — which says something useful to
whoever is on the other end, and keeps your machine's hostname off their roster.

A node dials the hub and everything it has paired with, both recorded beside the identity. Trust
and address are different things kept in different places: the keystore says whose signature to
accept, this says where to find them. Without the second, a paired peer stays trusted and
unreachable after a restart.

`VOLENET_MCP_DIR` overrides the directory outright, which is how you deliberately share one
identity between projects. That is the exception, not the default.

Upgrading from the version that kept one identity for the whole machine: `volenet-mcp adopt` claims
it for the current directory — keys, peers and history intact, so nothing needs re-pairing. Only one
project can have it, so which one is a decision rather than a guess.

## Session lifetime

The node lives as long as the editor session. That is a supported shape, not a degraded one: a
sender holds what it could not deliver and flushes when you reappear, and a hub hands you notices
about who tried while you were gone. `volenet_inbox` is the first thing to call in a new session.

## Build and test

```bash
pnpm -C src/volenet-mcp build
pnpm -C src/volenet-mcp test
```
