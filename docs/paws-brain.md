# Brain Paws

The Brain is a Paw — the core is LLM-ignorant. Swap models by swapping Brain Paws. All Brain Paws implement the same `think()` interface.

## Available Brain Paws

| Paw | Provider | Install |
|-----|----------|---------|
| `paw-ollama` | Local models via Ollama | `npx vole paw add @openvole/paw-ollama` |
| `paw-claude` | Anthropic Claude | `npx vole paw add @openvole/paw-claude` |
| `paw-openai` | OpenAI (GPT-4, etc.) | `npx vole paw add @openvole/paw-openai` |
| `paw-gemini` | Google Gemini | `npx vole paw add @openvole/paw-gemini` |
| `paw-xai` | xAI Grok | `npx vole paw add @openvole/paw-xai` |

## Configuration

Set the active brain in `vole.config.json`:

```json
{
  "brain": "@openvole/paw-ollama",
  "paws": [
    {
      "name": "@openvole/paw-ollama",
      "allow": {
        "network": ["127.0.0.1"],
        "env": ["OLLAMA_HOST", "OLLAMA_MODEL"]
      }
    }
  ]
}
```

Each Brain Paw needs its own environment variables. Common examples:

| Paw | Environment Variables |
|-----|----------------------|
| `paw-ollama` | `OLLAMA_HOST`, `OLLAMA_MODEL` |
| `paw-claude` | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` |
| `paw-openai` | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| `paw-gemini` | `GOOGLE_API_KEY`, `GEMINI_MODEL` |
| `paw-xai` | `XAI_API_KEY`, `XAI_MODEL` |

## BRAIN.md

Each Brain Paw scaffolds a `BRAIN.md` file in its local config directory on first run:

```
.openvole/paws/paw-ollama/BRAIN.md
```

This file is the **system prompt** — it overrides the default system prompt entirely. Edit it to customize how the Brain behaves. The Brain Paw owns this file, not the core.

## Identity Files

All Brain Paws load these optional identity files from `.openvole/` on startup:

| File | Purpose |
|------|---------|
| `BRAIN.md` | System prompt (per-brain, in paw data dir) |
| `SOUL.md` | Agent personality and tone |
| `USER.md` | User profile and preferences |
| `AGENT.md` | Operating rules and constraints |

## How think() Works

1. The core calls `think()` on the Brain Paw with the current context
2. The Brain Paw builds the system prompt from BRAIN.md, identity files, metadata, tools, and skills
3. It sends the prompt + message history to the LLM
4. The LLM returns either a text response (final answer) or tool calls (continue loop)
5. The Brain Paw returns the plan to the core

The core doesn't know which LLM was used, what API was called, or how the prompt was built. It just receives a plan.
