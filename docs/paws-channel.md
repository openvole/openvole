# Channel Paws

A channel is how your agent and a person reach each other. Channel Paws carry messages **in** — an incoming message becomes a task in the agent loop — and **out**, when the agent has something to say on its own initiative.

The **dashboard chat is built in** — every agent has it, nothing to install. External platforms are Paws:

| Paw | Platform | Install |
|-----|----------|---------|
| `paw-telegram` | Telegram | `vole paw add @openvole/paw-telegram` |
| `paw-slack` | Slack | `vole paw add @openvole/paw-slack` |
| `paw-discord` | Discord | `vole paw add @openvole/paw-discord` |
| `paw-whatsapp` | WhatsApp | `vole paw add @openvole/paw-whatsapp` |
| `paw-msteams` | Microsoft Teams | `vole paw add @openvole/paw-msteams` |
| `paw-voice-call` | Voice calls (Twilio) | `vole paw add @openvole/paw-voice-call` |

A Paw is a channel because its manifest says `"category": "channel"` — that is what core reads. Both kinds land in the same registry and work the same way for the agent.

## The agent starting a conversation

Replying is automatic: you send a message, the task result flows back to where it came from. The other direction needs a channel, and this is the case people hit first.

A **self-initiated run has nobody to reply to.** A heartbeat or scheduled task carries no session, so an agent instructed "ask me before you ship" has no chat to answer into — historically it would write the question into a file or a task result nobody was watching. With a channel loaded it calls that channel's send tool instead:

```
chat_send      → the dashboard chat
telegram_send  → your Telegram
slack_send     → a Slack channel
```

Sending is **one-way and non-blocking**. The agent asks and moves on; your answer arrives later as a normal inbound message (a chat reply, a Telegram message), which becomes its own task with the conversation's history behind it. Nothing waits on a human mid-run.

### The dashboard chat channel (built in)

`chat_send({ text, session? })` is a **core tool** — no Paw, no install, nothing to configure. It posts to the `dashboard` session (the Chat tab) unless you name another:

```
chat_send({ text: "Blocked on the index bump — ship it or hold?" })
```

The dashboard chat is core's own surface: no credentials, no external service, nothing a subprocess sandbox would protect. So the send path is built in, while channels that talk to *someone else's* platform stay Paws.

The message is filed into the transcript by [`paw-session`](/paws-infrastructure), so it is real chat history — it raises an unread badge and a toast, and it is waiting for you even if the browser was closed when it was sent. Without `paw-session` loaded the tool says so in its result rather than reporting a delivery that leaves no trace.

### Telling the agent to use it

Channels are advertised in the system prompt automatically — id, what it reaches, and which tool sends on it — so instructions in `AGENT.md` can stay in plain language:

```markdown
- Ask me for confirmation through the dashboard chat. Never park questions in journal.md.
```

The agent matches "dashboard chat" to the `chat` channel itself. With exactly one channel loaded, even "message me" resolves. Channel Paws also stay visible under [tool horizon](/configuration#tool-horizon) — a channel you have to discover first is a channel that goes unused.

## How Channels Work

1. The Channel Paw connects to the external platform (bot API, webhook, etc.)
2. When a message arrives, the Paw creates a **task** with a unique **session ID**
3. The task enters the agent's task queue and runs through the agent loop
4. The Brain's response is sent back through the Channel Paw to the platform

### Session IDs

Each channel generates session IDs based on the platform's user/chat identifiers:

```
dashboard          — the dashboard chat (built in)
telegram:123456    — Telegram chat ID
slack:C01234       — Slack channel ID
discord:987654     — Discord channel ID
cli:default        — CLI session
```

Session IDs enable conversation continuity through `paw-session` — the agent remembers context from previous messages in the same session.

### "Thinking..." Pattern

Channel Paws typically send a "Thinking..." placeholder message when a task is received, then update it with the final response. This gives users feedback that the agent is processing their request.

## Configuration Example

```json
{
  "paws": [
    {
      "name": "@openvole/paw-telegram",
      "allow": {
        "network": ["api.telegram.org"],
        "env": ["TELEGRAM_BOT_TOKEN"]
      }
    }
  ]
}
```

## Security Considerations

Channel Paws expose your agent to external users. Use [tool profiles](/security#tool-profiles) to restrict which tools channel users can access:

```json
{
  "toolProfiles": {
    "paw": {
      "deny": ["shell_exec", "fs_write", "fs_delete"]
    }
  }
}
```

This prevents Telegram/Slack/Discord users from triggering dangerous tools like shell execution or file deletion.

## Writing a Channel Paw

Two things make a Paw a channel:

1. `"category": "channel"` in `vole-paw.json` — core reads this to advertise the channel, keep its tools visible under tool horizon, and skip it in headless mode (no human is attached there).
2. A send tool named `<id>_send`, where the id is your Paw name minus the `@openvole/paw-` prefix. Core prefers that exact name, falls back to any `*_send`, then to a lone tool.

Report messages that cross the channel on the bus so the rest of the system can see them:

```ts
transport.send('emit', {
  event: 'channel:message',
  data: { channel: 'chat', dir: 'out', sessionId: 'dashboard', text, ts: Date.now() },
})
```

`paw-session` files these into the transcript (`dir: 'out'` as the agent, `'in'` as the human) and the dashboard surfaces them live. Core publishes **only** the `channel:*` namespace from a Paw — a sandboxed Paw must not be able to emit `task:completed` and drive core's own subscribers — so anything else is logged and dropped. Inbound messages still become tasks via `transport.createTask(input, { sessionId })`; the event is the record, not the trigger.
