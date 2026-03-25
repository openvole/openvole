# Changelog

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
