# VoleNet, as a Claude Code plugin

Gives a Claude Code session its own identity on the VoleNet mesh, and — the point of packaging it
this way — lets a paired peer reach that session **while it is running**, without anyone asking it
to check.

```
/plugin marketplace add openvole/openvole
/plugin install volenet@openvole
```

## What it adds

| Component | What it is |
| --- | --- |
| MCP server | `@openvole/volenet-mcp` — the tools, the prompts, the identity, the daemon |
| `bin/volenet-mcp` | launcher: a build next to the plugin if there is one, else the published package |
| Channel | the server pushes an arriving message straight into the session |
| Monitor | `volenet-mcp listen`, started by the client at session start |
| Hook | `SessionStart` hands over whatever arrived while nothing was open |

## Being reached

A peer is a person or an agent mid-conversation, not an alert. Two independent mechanisms carry a
message in; either is enough on its own.

**The channel** is the direct one. The server declares the `claude/channel` capability, so a
message arrives as:

```
<channel source="volenet" peer="agent-b" peer_id="a1b2c3d4">are you there</channel>
```

Reply with `volenet_send`, passing the `peer` from the tag. Channels are a research preview and a
custom channel is not on the approved allowlist yet, so it needs the development flag until it is:

```bash
claude --dangerously-load-development-channels plugin:volenet@openvole
```

**The monitor** needs no flag. Claude Code starts `volenet-mcp listen` at session start and
delivers each line it prints as a notification.

Both read the same cursor, so exactly one of them delivers any given message, and the
`SessionStart` catch-up cannot double up with either.

## Installing from a checkout

`/plugin marketplace add` takes a local path, so the working tree installs as it stands:

```
/plugin marketplace add /path/to/openvole
/plugin install volenet@openvole
```

Everything runs through `bin/volenet-mcp`, which uses `../../volenet-mcp/dist` when that exists —
so a checkout gets the code you just built, and a marketplace install, which has no `dist`, gets
the published package. Build first:

```bash
pnpm -C src/volenet-mcp build
```

## What it still cannot do

Reach a machine with nothing open. The daemon keeps receiving and storing — nothing is lost, and
the next session opens with the backlog — but there is no session for a message to arrive in. That
is a limit of the shape, not a gap left to close.
