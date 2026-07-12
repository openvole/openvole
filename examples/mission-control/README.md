# 🎛️ Vole Mission Control

A **zero-cost, fully-scripted OpenVole demo** — four agents, one orchestrator, no API keys, no LLM bill. Every layer below the words is real: real isolated engines, the real control plane, the real orchestrator reverse-RPC. Only the brains are scripted (`BRAIN_PROVIDER=mock` with a scenario file each).

> The honest magic trick: **the words are canned, the machinery is live.** When the queen "lists her fleet," that's a real `agent_list` against the registry. When she sends the chef a task, a real `agent_submit` crosses the control plane, the chef's engine really runs it, and the queen really reads the result back with `agent_task_status`.

## Cast

| Agent | Role |
|---|---|
| **queen** 👑 | Orchestrator (registry-flagged). Delegates by magic words. |
| **chef-vole** 🍽️ | Answers only in menus. It's always acorn risotto. |
| **bard-vole** 🪶 | Turns whatever the queen forwards — your literal words — into a haiku. |
| **scout-vole** 🔭 | Files dramatic field reports about the garden. |

## Run it

Needs `openvole` ≥ 4.6 and `@openvole/paw-brain` ≥ 2.4 (scenario mode). Until 2.4.0 is on npm, point at a local pawhub build:

```bash
bash setup.sh                                # or: PAWHUB_DIR=~/limnr/pawhub bash setup.sh
vole serve                                   # in this directory — open the printed URL
```

In the dashboard: **start all four agents**, open the **queen** (note her orchestrator badge), and chat:

| Say | What actually happens |
|---|---|
| `fleet` | Real `agent_list` — live registry data in the reply |
| `dinner` | Real `agent_submit` → chef-vole runs the task → `agent_task_status` reads the menu back |
| `a poem about rubber ducks` | Your words are forwarded **verbatim** to bard-vole (interpolated into the task) — the haiku reply quotes you |
| `scouting report` | scout-vole files from the field |
| `how is the chef` | Real `agent_state` — chef's live engine internals |
| `release the voles` | Three simultaneous `agent_submit`s — open each agent's Chat and watch |

Also worth showing off: each worker's **Overview** tab lists the queen's tasks in its real task queue, and the whole thing survives restarts because it's all just the normal engine.

## How the scripting works

Each agent's brain is `@openvole/paw-brain` in **mock scenario mode**: `BRAIN_MOCK_SCENARIO` points at a JSON file of `match` (regexes against the visitor's message) → `steps` (real tool calls, then a reply). Replies and tool params interpolate live data:

- `{{user}}` — the visitor's message (how the bard gets your words)
- `{{last_result}}` — the previous tool call's full result
- `{{last.taskId}}` — any field of it (how submit chains into task_status)

Edit `agents/*/.openvole/paws/paw-brain/scenario.json` and restart the agent — the show is yours to rewrite.

## Hosting it publicly (demo.openvole.com-style)

- Every agent runs `"demo": true` — the dashboard **refuses config and identity writes**, so visitors can look but not rewire.
- `vole serve` prints a **tokenized URL** — share that link; the token gates everything.
- Bind explicitly on a public box: `VOLE_DASHBOARD_HOST=0.0.0.0 VOLE_DASHBOARD_PORT=3000 vole serve`, and put a reverse proxy with TLS in front.
- Mock brains mean a stuck-open browser tab costs you nothing.
