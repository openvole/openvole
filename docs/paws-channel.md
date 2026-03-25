# Channel Paws

Channel Paws receive messages from external platforms and route them into the agent loop as tasks. They enable your agent to communicate through messaging apps, voice calls, and other interfaces.

## Available Channel Paws

| Paw | Platform | Install |
|-----|----------|---------|
| `paw-telegram` | Telegram | `npx vole paw add @openvole/paw-telegram` |
| `paw-slack` | Slack | `npx vole paw add @openvole/paw-slack` |
| `paw-discord` | Discord | `npx vole paw add @openvole/paw-discord` |
| `paw-whatsapp` | WhatsApp | `npx vole paw add @openvole/paw-whatsapp` |
| `paw-msteams` | Microsoft Teams | `npx vole paw add @openvole/paw-msteams` |
| `paw-voice-call` | Voice calls (Twilio) | `npx vole paw add @openvole/paw-voice-call` |

## How Channels Work

1. The Channel Paw connects to the external platform (bot API, webhook, etc.)
2. When a message arrives, the Paw creates a **task** with a unique **session ID**
3. The task enters the agent's task queue and runs through the agent loop
4. The Brain's response is sent back through the Channel Paw to the platform

### Session IDs

Each channel generates session IDs based on the platform's user/chat identifiers:

```
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
