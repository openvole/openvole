# Changelog

## v1.3.0 (2026-03-28)

### Cost Tracking
- Per-LLM-call cost estimation with provider pricing table (Anthropic, OpenAI, Gemini, xAI, Ollama)
- Brain paws report token usage via `AgentPlan.usage` — core tracks per-task cost
- `costAlertThreshold` config — warn when a task exceeds a dollar threshold
- `costTracking` mode: `auto` (local Ollama = free, cloud = priced), `enabled`, `disabled`
- Auto-detects Ollama local vs cloud via `:cloud` suffix in model name

### Task Priority & Dependencies
- Priority levels: `urgent` > `normal` > `low` — priority-aware queue scheduling
- Task dependencies: `dependsOn: [taskId]` — tasks wait until prerequisites complete

### Smarter Compaction
- Two-phase compaction: Phase 1 shrinks seen tool results in-place (works even with few messages), Phase 2 does full structured summary
- Fixes the "compact did nothing" issue when large tool results hit 75% budget but message count was low

### Memory Intelligence
- paw-memory `onCompact` hook — auto-extracts user preferences and key facts before messages are compacted away
- paw-memory `onObserve` hook — extracts tool usage patterns every 10 successful calls

### Provider Fallback Chains
- paw-brain: `BRAIN_FALLBACK` env var — if primary provider errors, automatically retry with fallback
- Supports `BRAIN_FALLBACK_MODEL` and `BRAIN_FALLBACK_BASE_URL`

### Dashboard
- Cost column in tasks table — shows $ amount and token count per task
- Task priority visible in query response

### Testing
- 210 tests (was 182): 22 cost tracker tests, 6 priority/dependency tests

## v1.2.0 (2026-03-28)

### Context Engine
- **ContextBudgetManager** — centralized token estimation (4 chars/token text, 2 chars/token JSON), budget calculation, and priority-based 5-pass trimming
- **System prompt builder** — moved from brain paws to core, eliminating 992 lines of duplicated code across 5 brain paws. Static-first ordering for provider prompt cache optimization
- **Token-based compaction** — triggers at 75% of maxContextTokens (replaces message-count threshold)
- **Budget guardrails** — blocks LLM calls when fixed costs exceed maxContextTokens, detailed PRE-COMPACT and FINAL budget logging with per-role token breakdown
- **Unseen tool result protection** — tool results not yet seen by the Brain are never trimmed, preventing stuck loops from lost results
- **Image handling** — extracts base64 from tool results, passes to Brain as provider-native image blocks (Anthropic, OpenAI, Gemini, xAI, Ollama)
- **Stuck loop detection** — 3-tier escalation: warn at 5, dampen at 10, circuit breaker at 15 identical tool calls
- **Bootstrap file caps** — 20K chars/file, 50K total for identity files, 20K for memory
- **Timing logs** — context build time and LLM round-trip duration logged per iteration
- New config: `maxContextTokens` (default: 128000), `responseReserve` (default: 4000)

### Unified Brain Paw
- **@openvole/paw-brain** — single brain paw supporting all LLM providers (Anthropic, OpenAI, Gemini, xAI, Ollama)
- Auto-detects provider from available API keys, or set `BRAIN_PROVIDER` explicitly
- Generic `BRAIN_API_KEY`, `BRAIN_MODEL`, `BRAIN_BASE_URL` with provider-specific overrides
- Legacy brain paws (paw-claude, paw-openai, paw-gemini, paw-xai, paw-ollama) deprecated

### Desktop Automation
- **paw-computer: hierarchical UI tree** — recursive traversal with parent-child indentation on macOS (AppleScript) and Windows (UI Automation), replacing flat element dump
- Global 200-element cap, respects max_depth parameter

### Other
- Random thinking spinner phrases (including vole-themed: "burrowing deeper...", "pawing at it...")
- Updated .env.example, vole.config.json.example, README with paw-brain as default
- Fix 4 audit vulnerabilities via pnpm overrides (brace-expansion, nodemailer)
- 28 official paws (1 unified brain + 5 legacy)
- 182 tests

## v1.1.0 (2026-03-26)
- Error recovery — `paw:crashed` event emitted on subprocess exit, running tasks auto-fail instead of hanging
- `vole tool list --live` — boots engine in headless mode to discover MCP tools
- Documentation site at [openvole.github.io/openvole](https://openvole.github.io/openvole/)
- paw-mcp: runtime MCP server management (`mcp_add_server`, `mcp_remove_server`, `mcp_list_servers`)
- Vulnerability fixes: esbuild, picomatch, yaml, nodemailer, undici, file-type

## v1.0.3 (2026-03-25)
- Chat-style CLI with welcome screen and thinking spinner
- Silent console mode — all logs to file only
- Fast parallel shutdown
- vole upgrade fixes (single npm install, BRAIN.md scaffolding)
- Dashboard URL reads from VOLE_DASHBOARD_PORT env var

## v1.0.2 (2026-03-24)
- vole upgrade improvements (paw data dirs, BRAIN.md scaffolding)
- vole --version reads from package.json dynamically

## v1.0.1 (2026-03-24)
- IPC transport singleton fix
- --allow-addons for childProcess paws
- paw-computer: desktop automation (mouse, keyboard, screen)

## v1.0.0 (2026-03-23)
- Sub-agent support (spawn_agent + get_agent_result)
- BM25 ranked search in paw-memory
- vole upgrade CLI command
- Filesystem sandbox enabled by default
- BRAIN.md ownership moved to brain paws
- Tool name conflict auto-prefix
- Compact phase reordering (perceive → compact → think)
- 149 tests
- 27 official paws

## v0.4.0 – v0.4.1 (2026-03-22)
- Filesystem sandbox with Node.js --permission model
- Headless mode for vole run
- Schedule persistence fixes
- Parallel paw loading
- Dashboard state refresh coalescing
- CONTRIBUTING.md for both repos

## v0.3.0 – v0.3.1 (2026-03-21)
- Cron scheduling (replacing interval-based)
- Late tool registration for MCP
- Local paw configs (.openvole/paws/)
- Brain narration detection and retry

## v0.1.0 – v0.2.0 (2026-03-20)
- Initial release
- Agent loop, tool registry, paw system, skill system
- Ollama brain paw, Telegram channel
- Memory, session, compact, dashboard paws
- Vault, workspace, heartbeat, scheduling
