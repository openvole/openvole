# Brain Paws

The Brain is a Paw — the core is LLM-ignorant. Swap models by swapping Brain Paws. All Brain Paws implement the same `think()` interface.

## Unified Brain Paw

Use `@openvole/paw-brain` — a single unified brain paw that supports all LLM providers:

```bash
npx vole paw add @openvole/paw-brain
```

Set the provider via `BRAIN_PROVIDER` env var, or let it auto-detect from available API keys:

| Provider | `BRAIN_PROVIDER` | Required Env Var |
|----------|------------------|------------------|
| Ollama (local) | `ollama` | `OLLAMA_HOST`, `OLLAMA_MODEL` |
| Anthropic Claude | `anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Google Gemini | `gemini` | `GEMINI_API_KEY` |
| xAI Grok | `xai` | `XAI_API_KEY` |

> Legacy single-provider paws (`paw-ollama`, `paw-claude`, `paw-openai`, `paw-gemini`, `paw-xai`) are deprecated but still available.

## Configuration

Set the active brain in `vole.config.json`:

```json
{
  "brain": "@openvole/paw-brain",
  "paws": [
    {
      "name": "@openvole/paw-brain",
      "allow": {
        "network": ["*"],
        "env": ["BRAIN_PROVIDER", "BRAIN_API_KEY", "BRAIN_MODEL",
                "OLLAMA_HOST", "OLLAMA_MODEL", "OLLAMA_API_KEY",
                "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]
      }
    }
  ]
}
```

Generic env vars (`BRAIN_API_KEY`, `BRAIN_MODEL`) work across all providers. Provider-specific env vars (e.g. `GEMINI_API_KEY`) take precedence over generic ones.

## BRAIN.md

The Brain Paw scaffolds a `BRAIN.md` file in its local config directory on first run:

```
.openvole/paws/paw-brain/BRAIN.md
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
