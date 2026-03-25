# Paws Overview

**Paws are tool providers.** They connect OpenVole to the outside world — APIs, databases, browsers, messaging platforms. Each Paw runs in an isolated subprocess with capability-based permissions.

All paws live in [PawHub](https://github.com/openvole/pawhub) and are installed via npm.

## Installing Paws

```bash
npx vole paw add @openvole/paw-telegram
npx vole paw add @openvole/paw-browser
npx vole paw list
```

## All 27 Official Paws

### Brain (5)

LLM providers that power the Think phase. [Learn more](/paws-brain)

| Paw | Purpose |
|-----|---------|
| `paw-ollama` | Local LLM via Ollama |
| `paw-claude` | Anthropic Claude models |
| `paw-openai` | OpenAI models |
| `paw-gemini` | Google Gemini models |
| `paw-xai` | xAI Grok models |

### Channel (6)

Receive messages from external platforms. [Learn more](/paws-channel)

| Paw | Purpose |
|-----|---------|
| `paw-telegram` | Telegram bot channel |
| `paw-slack` | Slack bot channel |
| `paw-discord` | Discord bot channel |
| `paw-whatsapp` | WhatsApp bot channel |
| `paw-msteams` | Microsoft Teams channel |
| `paw-voice-call` | Voice calls via Twilio (inbound + outbound) |

### Tool (11)

Provide tools the Brain can call. [Learn more](/paws-tool)

| Paw | Purpose |
|-----|---------|
| `paw-browser` | Browser automation (Puppeteer) |
| `paw-shell` | Shell command execution |
| `paw-filesystem` | File system operations |
| `paw-mcp` | MCP server bridge |
| `paw-email` | Email sending (SMTP/IMAP) |
| `paw-resend` | Email via Resend API |
| `paw-github` | GitHub integration |
| `paw-calendar` | Google Calendar integration |
| `paw-tts` | Text-to-speech (ElevenLabs, OpenAI) |
| `paw-stt` | Speech-to-text (OpenAI Whisper) |
| `paw-computer` | Desktop automation (mouse, keyboard, screen) |

### Infrastructure (4)

Lifecycle hooks and internal services. [Learn more](/paws-infrastructure)

| Paw | Purpose |
|-----|---------|
| `paw-memory` | Persistent memory with source isolation |
| `paw-session` | Session/conversation management |
| `paw-compact` | Context compaction (in-process) |
| `paw-dashboard` | Real-time web dashboard |
