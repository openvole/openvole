# Brain Paws

The Brain is a Paw — the core is LLM-ignorant. Swap models by swapping Brain Paws. All Brain Paws implement the same `think()` interface.

## Unified Brain Paw

Use `@openvole/paw-brain` — a single unified brain paw that supports all LLM providers:

```bash
vole paw add @openvole/paw-brain
```

Set the provider via `BRAIN_PROVIDER` env var, or let it auto-detect from available API keys:

| Provider | `BRAIN_PROVIDER` | Required Env Var |
|----------|------------------|------------------|
| Ollama (local) | `ollama` | `OLLAMA_HOST`, `OLLAMA_MODEL` |
| Anthropic Claude | `anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Google Gemini | `gemini` | `GEMINI_API_KEY` |
| xAI Grok | `xai` | `XAI_API_KEY` |
| Claude Code (local CLI) | `claude-code` | none — uses the local `claude` CLI's own auth |
| Antigravity (local CLI) | `antigravity` | none — uses the local `agy` CLI's own auth |

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

**A provider must be configured.** If none is set — no `BRAIN_PROVIDER`, no provider API key, and no `OLLAMA_HOST`/`OLLAMA_MODEL` — paw-brain exits with a clear error instead of silently defaulting to Ollama (changed in 2.1.0).

### Mock provider (testing)

Set `BRAIN_PROVIDER=mock` (`echo` and `test` are aliases) for a free, deterministic brain that makes **no network calls and no LLM calls** — ideal for testing the dashboard chat, the VoleNet mesh, or the agent loop, and for CI. It has two modes:

- **echo** (default) — replies with the incoming message. Set `BRAIN_MOCK_REPLY` for a fixed reply instead.
  ```bash
  BRAIN_PROVIDER=mock BRAIN_MOCK_REPLY="pong"
  ```
- **scripted** — set `BRAIN_MOCK_SCRIPT` to a JSON array of steps, walked one per `think()` call. Each step is either `{"tool":"name","params":{...}}` to emit a tool call or `{"response":"text"}` for a final reply.
  ```bash
  BRAIN_PROVIDER=mock BRAIN_MOCK_SCRIPT='[{"tool":"shell","params":{"command":"date"}},{"response":"done"}]'
  ```

To pass the sandbox, add any mock env vars you use to the paw's `allow.env`, e.g. `"BRAIN_MOCK_SCRIPT"`, `"BRAIN_MOCK_REPLY"`.

### Claude Code provider (local CLI)

Set `BRAIN_PROVIDER=claude-code` (aliases `claudecode`, `cc`) to use the local, **authenticated Claude Code CLI** as the brain — **no API key**; it uses the CLI's own auth. Each `think()` renders the system prompt + transcript and runs `claude -p --output-format json`, returning Claude Code's final answer.

- **Auth profile** — point at a config dir with `CLAUDE_CODE_CONFIG_DIR` (e.g. `~/.claude-ep`); it maps to the CLI's `CLAUDE_CONFIG_DIR`.
- **Other env** — `CLAUDE_CODE_CMD` (default `claude`), `CLAUDE_CODE_MODEL`, `CLAUDE_CODE_PERMISSION_MODE` (e.g. `bypassPermissions`, to let Claude Code use its own tools without an interactive prompt), `CLAUDE_CODE_ARGS` (extra CLI flags), `CLAUDE_CODE_TIMEOUT_MS` (default `600000`).

Grant `"childProcess": true` (it spawns the CLI) and add the `CLAUDE_CODE_*` vars you use to the paw's `allow.env`.

#### Calling OpenVole's own tools

Set **`CLAUDE_CODE_EXPOSE_TOOLS=1`** and Claude Code can call the agent's own tools (memory, schedules, VoleNet, …) as `mcp__openvole__<tool>`, alongside its built-ins. paw-brain writes a `--mcp-config` pointing the CLI at the control plane's MCP endpoint (`/mcp/<agent>`); the engine injects `VOLE_DASHBOARD_URL`, `VOLE_AGENT_ID`, and the dashboard token, so it works automatically under `vole serve`. Add `CLAUDE_CODE_EXPOSE_TOOLS`, `VOLE_DASHBOARD_URL`, `VOLE_DASHBOARD_TOKEN`, and `VOLE_AGENT_ID` to `allow.env`. See [Dashboard → Tools over MCP](./dashboard.md#tools-over-mcp).

### Antigravity provider (local CLI)

Set `BRAIN_PROVIDER=antigravity` (aliases `agy`, `ag`) to use the local, **authenticated Antigravity CLI** (`agy`, Google's successor to the Gemini CLI) as the brain — **no API key**; it uses the CLI's own auth. Each `think()` renders the system prompt + transcript and runs `agy --print`, returning the CLI's final answer.

- **Model** — `ANTIGRAVITY_MODEL` (run `agy models` to list what your account can reach — `gemini-3.x`, `claude-*`, `gpt-oss-*`).
- **Other env** — `ANTIGRAVITY_CMD` (default `agy`), `ANTIGRAVITY_AGENT`, `ANTIGRAVITY_EFFORT` (`low`|`medium`|`high`), `ANTIGRAVITY_MODE` (`accept-edits`|`plan`), `ANTIGRAVITY_SKIP_PERMISSIONS`, `ANTIGRAVITY_SANDBOX`, `ANTIGRAVITY_ADD_DIR`, `ANTIGRAVITY_CWD`, `ANTIGRAVITY_ARGS`, `ANTIGRAVITY_TIMEOUT_MS` (default `600000`), `ANTIGRAVITY_MAX_PROMPT_BYTES`.

Grant `"childProcess": true` (it spawns the CLI) and add the `ANTIGRAVITY_*` vars you use to the paw's `allow.env`.

> **No OpenVole tool access.** Unlike `claude-code`, this provider does **not** expose OpenVole's own tools to the CLI: `agy` has no per-invocation `--mcp-config`, so it runs its own agent loop with its own tools and returns a final **text** answer — it makes no OpenVole tool calls. Use it as a text/chat brain, not for an agent that must drive OpenVole tools (memory, schedules, VoleNet, sub-agents). The prompt is passed as a command-line argument, so it is bounded by `ARG_MAX` (~1 MB); an oversized prompt fails fast with a clear error — lower `loop.maxContextTokens` or raise `ANTIGRAVITY_MAX_PROMPT_BYTES`.

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
