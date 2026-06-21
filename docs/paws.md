# Paws Overview

**Paws are tool providers.** They connect OpenVole to the outside world — APIs, databases, browsers, messaging platforms. Each Paw runs in an isolated subprocess with capability-based permissions.

All paws live in [PawHub](https://github.com/openvole/pawhub) and are installed via npm.

## Installing Paws

```bash
vole paw add @openvole/paw-telegram
vole paw add @openvole/paw-browser
vole paw list
```

## Build an Embedded App

A paw can ship its own UI — a **panel** — that appears under the dashboard's **Apps** tab whenever the paw is loaded in a space. It renders as a sandboxed `iframe` served by the control plane, with **no per-paw web server and no extra port**. [`@openvole/paw-markets`](/dashboard#apps-embedded-paw-panels) is a complete working example.

### 1. Declare the panel in the manifest

In your paw's `vole-paw.json`:

```json
{
  "name": "@openvole/paw-markets",
  "panel": { "title": "Markets", "html": "panel.html" }
}
```

`title` is the label shown in the Apps nav; `html` is a static file shipped inside the paw package.

### 2. Write `panel.html`

A self-contained HTML file. Call your paw's tools with a **relative** `fetch` to `tool/<name>` — the control plane proxies it straight to the tool, **brain-free** (no LLM in the loop):

```html
<!doctype html>
<html>
  <body>
    <button id="go">Quote AAPL</button>
    <pre id="out"></pre>
    <script>
      // Relative to the panel URL (/panel/<space>/<paw>/) — calls the paw's tool directly.
      function callTool(name, params) {
        return fetch('tool/' + name, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params || {}),
        }).then((r) => r.json())
      }
      document.getElementById('go').onclick = async () => {
        const res = await callTool('stock_quote', { symbols: ['AAPL'] })
        document.getElementById('out').textContent = JSON.stringify(res, null, 2)
      }
    </script>
  </body>
</html>
```

::: warning
Every asset path in `panel.html` must be **relative** — the panel is served under `/panel/<space>/<paw>/`, so absolute paths like `/style.css` won't resolve. Inline your CSS/JS, or reference files relatively.
:::

### 3. Ship the file

Add `panel.html` to your `package.json` `files` array so it's published with the package:

```json
{ "files": ["dist", "vole-paw.json", "panel.html", "README.md"] }
```

### 4. Try it

Install the paw into a space (the **Config** tab, or `vole paw add` inside the space's directory) and start the space — your panel appears under the **Apps** tab.

### How it's served

- **HTML** → `GET /panel/<space>/<paw>/`
- **Tools** → `POST /panel/<space>/<paw>/tool/<toolName>` → runs `tool.execute(params)` over IPC and returns its JSON

Because tool calls go straight to your paw with no Brain, panels are deterministic and free — ideal for dashboards, forms, and live views over your paw's data.

## All 27 Official Paws

### Brain (1 + 5 legacy)

LLM providers that power the Think phase. [Learn more](/paws-brain)

| Paw | Purpose |
|-----|---------|
| `paw-brain` | **Unified multi-provider brain** (Anthropic, OpenAI, Gemini, xAI, Ollama) |
| `paw-ollama` | *(deprecated)* Local LLM via Ollama |
| `paw-claude` | *(deprecated)* Anthropic Claude models |
| `paw-openai` | *(deprecated)* OpenAI models |
| `paw-gemini` | *(deprecated)* Google Gemini models |
| `paw-xai` | *(deprecated)* xAI Grok models |

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
| `paw-dashboard` | *(deprecated — use [`vole serve`](/dashboard))* Single-engine web dashboard |
