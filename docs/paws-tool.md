# Tool Paws

Tool Paws provide capabilities the Brain can call during the Act phase. Each runs in a subprocess sandbox with capability-based permissions.

## Available Tool Paws

### paw-browser

Browser automation via Puppeteer. Navigate pages, click elements, extract content, take screenshots.

```bash
npx vole paw add @openvole/paw-browser
```

Requires `childProcess: true` (Puppeteer spawns Chrome).

### paw-shell

Shell command execution. Run arbitrary commands in the system shell.

```bash
npx vole paw add @openvole/paw-shell
```

| Env Variable | Purpose |
|-------------|---------|
| `VOLE_SHELL_ALLOWED_DIRS` | Directories where commands can run |

Requires `childProcess: true`.

### paw-filesystem

File system operations — read, write, list, delete files and directories.

```bash
npx vole paw add @openvole/paw-filesystem
```

### paw-mcp

Bridge MCP (Model Context Protocol) servers into the tool registry. MCP tools appear alongside Paw tools — the Brain doesn't know the difference.

```bash
npx vole paw add @openvole/paw-mcp
```

- MCP tools are **auto-discovered at runtime** as MCP servers connect
- **Late tool registration** — tools appear after the engine starts
- Config lives in `.openvole/paws/paw-mcp/servers.json`

Requires `childProcess: true` (spawns MCP server processes).

Example `.openvole/paws/paw-mcp/servers.json`:

```json
{
  "servers": [
    {
      "name": "resend",
      "command": "npx",
      "args": ["-y", "resend-mcp"],
      "env": { "RESEND_API_KEY": "$RESEND_API_KEY" }
    }
  ]
}
```

### paw-email

Email sending and reading via SMTP/IMAP.

```bash
npx vole paw add @openvole/paw-email
```

| Env Variable | Purpose |
|-------------|---------|
| `EMAIL_SMTP_HOST` | SMTP server hostname |
| `EMAIL_SMTP_PORT` | SMTP port |
| `EMAIL_USER` | Email username |
| `EMAIL_PASS` | Email password |

### paw-resend

Email sending via the Resend API — simpler alternative to SMTP.

```bash
npx vole paw add @openvole/paw-resend
```

| Env Variable | Purpose |
|-------------|---------|
| `RESEND_API_KEY` | Resend API key |

### paw-github

GitHub integration — create issues, PRs, read repos, manage workflows.

```bash
npx vole paw add @openvole/paw-github
```

| Env Variable | Purpose |
|-------------|---------|
| `GITHUB_TOKEN` | GitHub personal access token |

### paw-calendar

Google Calendar integration — create events, list upcoming events, manage calendars.

```bash
npx vole paw add @openvole/paw-calendar
```

| Env Variable | Purpose |
|-------------|---------|
| `GOOGLE_CALENDAR_CREDENTIALS` | Google service account credentials |

### paw-tts

Text-to-speech via ElevenLabs or OpenAI.

```bash
npx vole paw add @openvole/paw-tts
```

| Env Variable | Purpose |
|-------------|---------|
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `OPENAI_API_KEY` | OpenAI API key (for OpenAI TTS) |

### paw-stt

Speech-to-text via OpenAI Whisper.

```bash
npx vole paw add @openvole/paw-stt
```

| Env Variable | Purpose |
|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key |

### paw-computer

Desktop automation — mouse control, keyboard input, screen capture. Enables the agent to interact with desktop applications.

```bash
npx vole paw add @openvole/paw-computer
```

Requires `childProcess: true` and `--allow-addons` for native addon support.
