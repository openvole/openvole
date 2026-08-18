# Projects & Tasks

Projects are how an agent knows what it is working on. Each one is a folder in the agent's
workspace holding its own context, notes, and task queue — so changing an agent's assignment is a
conversation with the agent, not an edit to `AGENT.md` followed by a restart.

## Why this exists

An agent's instructions used to live in one file. `AGENT.md` is loaded once when the engine starts
and cached, which made it the only place to say what the agent should work on — and meant every new
piece of work was a file edit plus a restart, with identity ("you are a careful editor") tangled up
with assignment ("finish chapter 3").

Projects split those apart:

| Tier | Holds | Edited by | Loaded |
|------|-------|-----------|--------|
| **Identity** — `AGENT.md`, `SOUL.md`, `USER.md` | who the agent is, standing rules | you, rarely | once, at start |
| **Project** — `VOLE.md` | one body of work: where its files are, how to work in it | the agent | per task |
| **Task** — `tasks.jsonl` | one unit of work: goal, done-criteria, budget | the agent, on your say-so | per task |

An agent with no projects behaves exactly as it did before — nothing about the existing setup
breaks.

## Layout

```
your-agent/
└── .openvole/
    ├── AGENT.md                    identity — still yours, still rarely touched
    └── workspace/
        ├── openvole-4.17/          a project
        │   ├── .project.json         manifest
        │   ├── VOLE.md               what the agent knows about this project
        │   ├── tasks.jsonl           task queue and full state history
        │   └── notes/ drafts/        the project's own scratch space
        ├── nart-chapter-9/
        └── kid-channel-ep12/
```

A directory is a project exactly when it contains `.project.json`. The filesystem is the index, so
there is nothing to keep in sync — and a project folder is portable: send one to another agent with
VoleDrop, or sync it over VoleNet.

## Context: VOLE.md

A markdown file written for the agent, kept beside the work. It is loaded into the system prompt
of every task in that project, so what it says is what a run knows before it starts.

Two places it can live, and both are read:

- **`VOLE.md` at the project's root** — for an attached project this belongs in the repo, checked
  in, so it travels with the code and every agent that picks the project up gets the same
  briefing. This one is loaded first.
- **`VOLE.md` in the project folder** — this agent's own accumulated notes about the work, private
  to it.

The filename is a convention, not a rule: **every markdown file at the top of the project folder
is loaded**, `VOLE.md` first, then `CONTEXT.md` if the project has one from before, then the rest
alphabetically. Split things up as it suits the project — `CONVENTIONS.md`, `GLOSSARY.md`, a brief
per workstream — and they all arrive in the prompt.

There is a total budget (20,000 characters). Anything past it is named in the prompt rather than
inlined, so the agent knows it exists and can read it with `project_file_read`. A project that has
outgrown the budget can name the files worth spending it on:

```json
{ "contextFiles": ["VOLE.md", "CONVENTIONS.md"] }
```

## Two kinds of project

`root` is the only difference between them.

**Self-contained** — no `root`. The project *is* its folder: drafts, research, generated assets.

**Attached** — `root` points at files elsewhere, like a git repo or a footage folder. The workspace
folder still holds the manifest, context, tasks, and the agent's own notes; the work happens in the
real tree.

```bash
vole project create nart-chapter-9 --kind writing
vole project create openvole-4.17 --kind code --root ~/limnr/openvole
```

::: warning A project root cannot widen the sandbox
An external `root` must already resolve inside `security.allowedPaths` (the agent's own directory
always counts). If it does not, creation fails and names the path you would have to grant.

This is deliberate: the **agent** writes project manifests, so a project that could grant filesystem
access would be a way for an agent to expand its own reach. Granting a path stays a human edit to
`vole.config.json`.
:::

## Setting up work by asking

The intended flow is that you describe the work and the agent sets it up:

> **you:** work on the openvole repo

1. The agent runs `project_scan` on the path — read-only. It detects the stack (git, pnpm,
   TypeScript, vitest…), suggests a kind, and lists the docs worth reading.
2. It reads those docs and drafts a `VOLE.md` from what it actually found.
3. It proposes the project and some opening tasks.
4. On your go-ahead it calls `project_create` and `task_create`.

You review a draft instead of writing one. Everything the agent learns later goes back into
`VOLE.md`, so the next run starts informed rather than re-deriving it.

## Tasks

A task is a goal plus **done-criteria** — conditions that can actually be checked:

```bash
vole task add openvole-4.17 "Port paw-database off better-sqlite3" \
  --criteria "pnpm -C src/core test passes" \
  --criteria "no better-sqlite3 in any package.json"
```

The criteria are the point. A task moves `running → verifying → done`, and it cannot reach `done`
without passing through `verifying`, where the agent checks its work against those conditions. If
one does not hold, the task goes to **`blocked`** with a note saying which — rather than being
reported as finished.

### States

| State | Meaning |
|-------|---------|
| `queued` | waiting to be picked up |
| `running` | being worked on |
| `verifying` | checking the done-criteria |
| `blocked` | stopped and recoverable — criteria unmet, budget spent, or needs you. Carries a reason |
| `done` | verified complete |
| `failed` | gave up; can be requeued |
| `cancelled` | called off |
| `waiting_approval` | reserved for the approval gate (not yet active) |

Tasks are stored append-only, so `tasks.jsonl` is also the history: how long something sat queued,
what blocked it, how many times it was retried.

### Budgets

`--priority` orders the queue. A task can also carry an iteration budget; exhausting it moves the
task to `blocked` with the reason, never a silent stop halfway.

## Working on the files

The `project_file_*` tools act on the project the current task belongs to. Paths are relative to
the project and cannot address anything outside it — `..`, absolute paths, and symlinks pointing
out are each refused. A `root` argument picks which of the project's two places to act in:

| `root` | Where |
|--------|-------|
| `root` *(default when the project has one)* | the attached files — the repo or folder the project points at |
| `workspace` | the project's own folder: `VOLE.md`, notes, drafts |

A self-contained project has only the second, so the choice collapses.

These exist because `workspace_*` is confined to `.openvole/workspace/` and cannot reach an
attached root at all. Without them, working in a repo meant installing a filesystem paw and
granting it the path — which then had the run of the whole grant, not just this project.

::: tip Projects isolate each other
Because every path resolves against *this task's* project, an agent with two attached projects
cannot reach from one into the other through these tools. Scope arrives per call rather than being
remembered, so this holds at task concurrency above 1 as well.

It does **not** extend to `paw-shell` or `paw-filesystem`: those are sandboxed per agent by
`security.allowedPaths`, which a project cannot narrow. A project that needs strict isolation
should deny them in its `toolProfile`.
:::

## Scheduled work

A schedule can be scoped to a project, which turns a heartbeat from "wake up and do something" into
"pick up this project's queued work". When a scoped schedule fires, the agent arrives already
knowing the goal and its done-criteria.

Selecting work does not claim it — a crashed run can never strand a task in `running`. A chat
message never pulls queued work either: what you asked for is the instruction.

## Narrowing tools per project

A project may carry a `toolProfile` that restricts which tools are available while working on it:

```json
{ "toolProfile": { "deny": ["net_send_file"] } }
```

This can only ever narrow. Denials from the project and from the task are unioned, allowlists are
intersected — so a project can never hand its agent a capability the agent did not already have.

## Delegated work

A project belongs to whoever owns the **outcome**, not whoever does the labor. A channel that
spans editing, thumbnails and publishing belongs with the coordinator; work that lives entirely in
one agent belongs to that agent.

When a coordinator hands a task to a sibling, delegating is not finishing. The task carries an
`assignee` (shown on the board, so it doesn't read as abandoned) and a `delegatedTaskId` — the run
id from `agent_submit`, which `agent_task_status` can poll. When the sibling reports back, the
coordinator records its artifacts and outcome on the task before verifying and closing it.

**One writer per project ledger.** The worker reports; the owner records. Letting a sibling write
into another agent's workspace would cross the isolation boundary and put two writers on the same
`tasks.jsonl`.

## In the dashboard

The agent view has a **Projects** tab: projects on the left, and for the selected one a task
board grouped by state — running, verifying, blocked, queued, done — with
each task's done-criteria and, when blocked, the reason.

The **Chat** sub-tab talks to the agent in that project's own context — its docs and open
tasks are already loaded, so you can describe what you want instead of filling in a task form and
the agent creates and updates the tasks itself. These conversations live on the project page and
stay out of the central Chat tab, which keeps that list from filling with unlabelled sessions.

The project's context docs sit above the board as a single collapsed line naming them; click to
expand, or use **Context** to edit. They are written for the agent to read, so they stay out of
the way of the board by default.

Buttons move a task to whatever states are legal from where it is, so `done` is only ever offered
after `verifying`. Blocking asks for a reason, because a board full of blocked tasks with no notes
is unreadable a week later.

The **Files** sub-tab is a file browser and editor for the project's own files. A project has at
most two places files live, and this browses both: its folder in the agent workspace, and the root
it is attached to when it has one. Switch between them with the pills at the top; with no attached
root there is only the one and the pills are hidden.

Click a folder to go into it, a file to open it. Text opens in an editor with a **Save** button;
binary files and anything over 512 KB say so rather than filling a textarea with noise. **New
file** takes a path, so `docs/notes.md` creates the folder on the way, and it refuses a name that
already exists rather than emptying that file. **rename** also moves — give it a path with
slashes. Navigating away from unsaved changes asks first.

To bring in a file that already exists, drag it onto the listing or use **Add files**. Uploads
stream to disk with a progress bar, land in the folder you were looking at when you started them,
and get a ` (n)` suffix rather than overwriting anything with the same name — if that happens the
row tells you what the file was actually called.

`.project.json` and `tasks.jsonl` show as *managed* and open read-only. They have proper editors
elsewhere — the project form and the task board — and `tasks.jsonl` is an append-only log the agent
may be writing to right now, so hand-editing it in a text box is how a project's history gets lost.

This is bounded by the project's own two roots, which is tighter than `security.allowedPaths` on
purpose: a browser that writes and deletes should not wander the whole grant. Paths that climb out
with `..`, absolute paths, and symlinks pointing outside are each refused. An attached root that is
no longer inside `allowedPaths` simply disappears from the pills rather than erroring on every
click.

Both the project's context doc and the identity files have a **Draft** button: describe what the
file should cover in a sentence and the agent writes it. For the context doc it opens the project and reads the
real files first, so what it writes is grounded rather than guessed. The draft fills the editor and
stops there — you read it and save it yourself. Drafting needs the agent running, and does not
appear in its chat.

**New** creates a project. **Browse…** opens a directory picker that walks the filesystem of the
machine the agent runs on — a browser cannot hand back an absolute path, so the listing is served
by the control plane. It says whether the folder you land on is inside the agent's allowed paths,
and offers to grant it if not; a running agent needs a restart to pick a new grant up. **Scan**
inspects the chosen path and fills in the kind and stack from what it finds. Everything here is served from the agent's files, so it works while the agent is stopped —
which is when queueing work up is most useful.

## Commands

```bash
vole project list [--all]              # projects in this workspace
vole project scan <path>               # inspect a directory (read-only)
vole project create <id> [--name <n>] [--kind <k>] [--root <path>]
vole project open <id>                 # manifest, context docs and open tasks
vole project archive <id>              # retire it, keeping every file

vole task list [projectId] [--state <s>]
vole task add <projectId> <goal...> [--criteria "..."] [--priority <n>]
vole task next [projectId]
vole task update <projectId> <taskId> --state <s> [--note "..."]
vole task cancel <projectId> <taskId>
```

These read the files directly, so they work with the agent stopped — which is usually when you want
to look.

## Moving an existing agent over

Nothing forces this: an agent with no projects keeps working exactly as before.

When you do want to split a crowded `AGENT.md`, ask the agent to propose the division — which parts
are durable identity and which are the current assignment. It can create the project and write
`VOLE.md` from the assignment half, then show you the lines to remove from `AGENT.md`.

That last step stays yours on purpose. `AGENT.md` holds the standing rules an agent operates under,
and an agent that could quietly rewrite its own rules is not one you can rely on. The agent proposes;
you edit.

## Tools the agent uses

**Setup** — `project_scan`, `project_create`, `project_list`, `project_open`, `project_update`,
`project_archive`, `task_create`, `task_list`, `task_update`, `task_next`.

**Files** — `project_file_list`, `project_file_read`, `project_file_write`, `project_file_move`,
`project_file_delete`. See below.
