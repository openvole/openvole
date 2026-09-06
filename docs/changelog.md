# Changelog

## v4.20.0 (2026-09-03)

> Ships as `openvole` 4.20.0. A connection request to someone who is away now waits and arrives when they are back, the way chat already does, and a peer with no address can finally be named in `net.peers`.

### Added

- **`@openvole/volenet` — the protocol is now its own package, and `openvole` depends on it.** VoleNet was a directory inside the agent framework, so anything wanting to be a peer had to install the framework: 3.6 MB of agent loop, CLI, scheduler, vault, paw registry and sandbox to use one class. That is backwards when the network is the part meant to outlive the framework, and anyone evaluating it would notice.

  `src/core/src/net/` moved to `src/volenet/` and had its three ties to the host cut. The logger is now the library's own, with `setLoggerFactory()` so a host gets one log stream instead of two. The tool registry became a structural `ToolProvider` — two methods and five fields — so anything with that shape works, including a host with no notion of paws. The message bus became an `EventSink` that any emitter satisfies, with `createEventBus()` for a host that has none. And writing a runtime-learned peer into `vole.config.json` became a `persistPeer` callback, because a library has no business guessing the shape of somebody's config file.

  Nothing about the wire changes and nothing in `openvole` moves: `src/core/src/net/index.ts` is now a seam that re-exports the package under the path core has always imported, injects core's logger, and supplies `persistPeerTo()`. Every existing import keeps working. `@openvole/volenet-mcp` now depends on the library alone — 768 KB instead of 3.6 MB, with no agent framework — and core's own bundle drops to 2.2 MB.

  Also fixed on the way: `seal.ts` and `file-crypto.ts` never type-checked, because `@types/node` does not yet describe Node 24's ML-KEM (`encapsulate`/`decapsulate`) or its `authTagLength` option for ChaCha20-Poly1305. Those are narrowed once in `node-crypto.ts`, with the reason attached, instead of a repo-wide `tsc` failure. The package type-checks clean.

- **`@openvole/volenet-mcp` — VoleNet as an MCP server, so Claude Code gets an identity on the mesh.** A coding session is very good inside one machine and one session: it cannot message a person on their phone, cannot talk to an agent someone else owns, and has no identity that outlives the session. A subagent does not solve that — it is the same principal on the same machine. This publishes the part that is not coding-assistant work: signed identity, hybrid post-quantum sealing, a hub that carries ciphertext it cannot read, consent before anyone may message you, and hold-and-forward for a peer who is not there.

  Setup is `npx -y @openvole/volenet-mcp install` and nothing else: an identity is generated on first run, the name defaults to the hostname, and whether to join a hub is decided later from inside a session. Settings live with the identity rather than in the launch command, so changing one never means re-registering anything. Ten tools rather than an agent's whole registry, because a tool list is spent from the client's context on every turn: `volenet_whoami`, `volenet_peers`, `volenet_inbox`, `volenet_wait`, `volenet_send`, `volenet_history`, `volenet_ask`, `volenet_requests`, `volenet_hub`, `volenet_connect`.

  The node lives as long as the editor session, which VoleNet already supports — senders hold what they could not deliver and flush on reconnect, and a hub hands over notices about who tried. What MCP cannot do is push: a server cannot wake its client, so an arrived message would sit unseen until somebody thought to look. Two things close most of that gap. Every tool result ends with what is unread, so any use of any tool surfaces it; and `volenet_wait` blocks until something lands instead of returning nothing and being called again, which is what turns a mailbox into a conversation. For catch-up before a session even starts, `volenet-mcp inbox --read` runs from a `SessionStart` hook.

  A small command line covers what wants doing without a session — `install`, `whoami`, `hub`, `inbox`. It touches files only, starting no node and binding no port, so it is safe to run while the server is up and safe in a hook that fires every time. Anything needing a live node stays a tool.

  `volenet_send` is chat and does not run the peer's brain, which is what reaches a person on the phone app — `net_message` only ever asked a peer's brain and therefore hung against a client that has no brain. Pairing by URL is two calls: the first reports the fingerprint of whoever answered, the second confirms it, because trusting a URL blind is trusting whoever holds it.

- **Identity primitives are exported from the package root** — `generateKeyPair`, `loadKeyPair`, `trustPeer`, `revokePeer`, `loadAuthorizedVoles`, `parsePublicKey` — so anything running a node of its own no longer has to reach into `openvole/dist/net/keys.js`.

### Fixed

- **A peer's brain question was answered to the dashboard, not to the peer.** A `task:delegate` carrying a `fromName` is chat — the peer is talking to the agent — but it was enqueued with no `sessionId`, so every rule in `replyAddressFor` fell through to `dashboard`. The agent was told its report went to its human, so it wrote a status update *about* the peer ("The reply to X timed out… no further action needed"), and that text was what the peer received. The same report also landed in the dashboard Chat tab, so one question produced two copies of the wrong thing. Worse, believing the answer was going elsewhere, the agent would call `net_message` to reach the peer "properly" — which hangs against a phone, since a chat client has no brain to answer with.

  A delegated peer chat now runs as a turn in that peer's own conversation (`net:<peerId8>`, matching the source it already ran under). History loads, the exchange is transcribed, and the reply address is the peer. A one-shot delegation — no `fromName` — is not a conversation and still gets none. Peer brain replies no longer appear in the dashboard Chat tab; they are in that peer's session.

### Added

- **A brain answer whose asker has gone now waits, and goes out when they come back.** `task:delegate` runs our brain, which takes as long as a model takes — and whoever asked from a phone may well have closed it by then. The reply was written to whatever socket the peer had, the boolean that says whether it landed was discarded, and the log said "result sent" either way. Nobody else held a copy: the asker has the question, we have the only answer.

  An undelivered `task:result` now waits in a **result outbox** on the node that produced it (`.openvole/net/result_outbox.json`), and goes out the next time that peer says anything to us — a phone announces and then pings, so it arrives within a second of reopening, with nothing to poll and nothing to ask for. The payload is stored rather than the signed message, and re-signed on delivery, because receivers enforce freshness. Bounded by `relay.outboxTtlHours` (a week) and 50 answers per peer, oldest dropped first. Refusals are held the same way — a peer that asked deserves to hear "not allowed" even if it stepped out.

  Also: the timers polling for a delegated task's completion are now tracked and cleared on `stop()`. They were never cancelled, so a task that never reached a terminal state left a one-second interval running for the life of the process.

- **`net.peers` entries can name a peer by identity, not just by address.** An entry was matched to a connected peer by its `url` — by port, or by host — so a peer that advertises no endpoint could never match one. A phone running the VoleNet chat app dials out and is never dialled, so no entry ever applied to it and it fell through to whatever `net.publicJoin` allows *anyone*. Letting your own phone use your agent's brain and letting every guest use it were the same setting, and an agent with `publicJoin` off had no setting at all.

  An entry may now carry `id` — the full instance id, or a prefix of at least 8 characters — or `name`, matched against the peer's announced name. Identity is checked before address, so existing url entries behave exactly as before, and `url` is now optional for an entry that only says what a peer may do. Note that `trust` still defaults to `"full"` when omitted: set it explicitly (`"read"` is usually right for a phone).

  This is also why a paired phone never appeared in `net.peers`: accepting a pair request trusts the key in `.openvole/net/authorized_voles` and writes a peer entry only when the requester advertised an endpoint to dial.

### Fixed

- **A connection request to a member who was away simply vanished.** `agent_message` chat has waited in the sender's outbox since 4.19.0, but the relay consent handshake — request, accept, deny — was still fire-and-forget: it was sealed, handed to the hub, and forgotten. To a member who had just locked their phone that meant nothing arrived and nobody was told, which is the first thing a phone client notices.

  Consent traffic now goes through the same verdict-and-hold path as chat. The hub's `held` answer puts the request in the sender's own outbox (`kind: 'connect-request'`, with its note), and it is re-signed and delivered when the member reappears in a roster. `requestRelayConnect` and `approveRelayConnect` report `queued: true` when that happens. Entries written before this release have no `kind` and are still treated as chat.

## v4.19.0 (2026-09-03)

> Ships as `openvole` 4.19.0 alongside `@openvole/dashboard-server` 0.17.0. Chat to a node that is away now waits on the sender and arrives when they are back — with nothing readable ever stored on a hub.

### Added

- **Chat to a member who is away is held, not lost.** A relayed message to a member the hub cannot reach used to come back as `delivered: false` and that was the end of it. It now waits in the **sender's own outbox** and goes out, re-signed, the moment the member reappears in a hub roster — carrying `sentAt`, the time it was written, which is what the recipient's transcript records. The hub keeps a **notice** only — sender, count, first and last time — and hands it to the member on reconnect, so the dashboard can say "X tried to reach you while you were away" before X is back to deliver. Both survive a restart on either side.

  The hub deliberately holds no ciphertext: envelopes are sealed to the recipient's static keys with no ratchet, so a stored envelope would be retroactively readable on a later key compromise. A notice carries nothing to decrypt. The cost is that delivery needs the sender online when the recipient returns — automatic for a phone talking to an always-on node, and for two phones it happens whenever both are open at once.

  Mechanics: the outer envelope carries an opaque `ref`, and the hub answers every one — `relay:ack` when forwarded, `relay:error` with `held: true` when the member is away — so a sender with several messages in flight knows which is which. A hub too old to answer is treated as before: the write to the hub counts as delivery. Only an absent recipient queues; a refused envelope (too large, rate-limited) is an error. New: `relay.outboxTtlHours` and `relay.noticeTtlHours` (both a week), `volenet_chat_status`, bus events `volenet:chat:queued` / `volenet:chat:flushed` / `volenet:chat:pending`. The VoleNet tab marks a held message on its bubble, shows the notice as a banner in that peer's chat, and toasts when a held message goes out.

### Fixed

- **Two nodes that could both dial each other kept two sockets and leaked one.** Each side bound the *other's* dial as the peer's socket and left its own open and unreferenced, so a `stop()` closed what it referenced and the far side went on believing the peer was connected — on a socket nothing would ever close — and forwarded into it. Now one socket per pair: when a second appears, the node with the smaller id counts as the dialer, both sides keep that one and close the other, and `stop()` terminates every socket the transport owns, referenced or not.

- **A member bound over the hub's own dial could vanish unnoticed.** The outbound close handler flipped `connected` but never fired the disconnect callbacks — only the inbound path did — so no roster went out and nobody upstream heard. Both paths now report the same way.

- **Sockets that die without a close frame are now noticed.** A phone leaving Wi-Fi sends nothing; its socket stayed OPEN for as long as TCP took to give up, and everything sent meanwhile was lost. The transport pings every socket every 20 s and drops one that misses a pong.

### Security

- **Six advisories cleared under the dashboard's MCP SDK and Express.** `fast-uri` to 4.1.4 (four high, `ajv>fast-uri` floor raised past 4.1.3) and `qs` to 6.16.0 (two moderate). Both are already-overridden transitive dependencies; the consumers' own ranges admit the fixed versions.

## v4.18.0 (2026-08-30)

> Ships as `openvole` 4.18.0 alongside `@openvole/dashboard-server` 0.16.0. Agents can talk to each other, `vole upgrade` covers skills as well as paws, and VoleDrop carries video-sized files.

### Added

- **Agents can hold a conversation.** `agent_message` says something to a sibling and has it read: the message lands in an ongoing thread with that agent, wakes it, and its reply comes back the same way. No polling. Until now a coordinator could only `agent_submit` and poll `agent_task_status`, and the worker's answer landed in the worker's own session — so when a worker responded, nobody was told.

  A thread is named from each side (`agent:orchestrator` on the worker, `agent:video-editor` on the coordinator), so both keep history and the pair needs no shared registry. A run started by a message answers the agent that sent it, the same way a chat turn answers its chat.

  **Waking is the default**, because a person's chat message already works that way and a colleague's word should not sit unread for arriving over a different channel. What keeps that from running away is a hop count, not restraint: a reply is itself a message, so an exchange where every arrival wakes the receiver has each side politely answering the answer at one brain call per turn. Six hops leaves room for ask → clarify → answer → confirm; past it the message is still **delivered**, only the waking stops, so the last word is read on the next run rather than lost.

  **The agent is told when to use it**, so you do not have to name the tool. A prompt section appears whenever messaging is available: reach a colleague directly rather than delegating a task or asking your human to relay, keep a conversation distinct from a work order, and remember a sibling has none of your context. Knowing a tool exists is not the same as knowing it is the right one — without this, an agent asked to "check with video-editor" reaches for whatever it already uses.

  **A thread keeps both halves.** The recipient's side is written by the run a message wakes, but the sender writes from whatever conversation prompted it — so its own copy of the thread opened on the *reply*, with the question it had asked nowhere in it. The sender now records what it said.

  **`agent_message` accepts the target its own schema names.** The alias list was copied from the orchestrate tools, whose parameter is `target`; this tool's is `to`, so a model following the schema exactly was told "Missing target". It worked at all only because models tended to guess `target`, mirroring `agent_submit`.

  **An answer reaches the person who asked for it.** When a human's question sends an agent to a colleague, the colleague's reply is delivered into that human's chat directly — it raises the unread badge and shows live like any other message. This does not depend on the agent remembering: asked to find something out, an agent would ask, get the answer, reply to the colleague and leave the person waiting, through two rounds of increasingly direct instruction. The reply arrives in a run addressed to the colleague, so relaying was something the model had to remember, and it did not. It fires only when a person's session started the chain, so agent conversations nobody asked for stay out of the chat, and the prompt now asks for commentary rather than repetition.

  **A reply knows who has been waiting.** A colleague's answer wakes a *new* run in the agent thread, blind to the conversation that prompted the question — so an agent that told someone "I'll relay what they say" had no way to keep the promise: the run holding the answer had never seen it made. The asking run's own reply address now travels with the message and comes back on the answer, and the prompt names it. Taken from the run rather than from the model, so an agent cannot nominate a conversation it was never part of.

  **Agents are told to stop talking.** A reply wakes the other side and costs it a full turn, so the prompt says not to answer merely to acknowledge, and never to acknowledge an acknowledgement. The hop budget drops from six to four: observed live, six allowed five wakes of pure politeness that ended in "Acknowledged" and "Standing by" — stopping because the models ran out of things to say, not because the budget bit.

  **A delegated task reports back too.** `agent_submit` now records who asked, so a worker's finished answer is delivered to the coordinator as a message rather than sitting in the worker's own session waiting to be polled for. This is the case the complaint was actually about: a coordinator that delegates and then hears nothing.

  **Messaging is not orchestration**, and the registry says so. `agent_message` lives in its own module under its own paw name (`__agent_chat__`), separate from the `__orchestrate__` family — filing both under one source made messaging read as orchestration to anything inspecting the registry. Every agent gets `agent_message`; the `agent_*` management family — submitting work, rewriting config or identity, restarting, creating — stays behind the orchestrator flag. Both travel the same reverse-RPC channel, so the split is enforced server-side in the control plane, not only by which tools are registered.

- **The Chat tab has a sidebar instead of a dropdown.** Conversations are listed newest-first, the way every other chat client does it, rather than hidden behind a picker you have to open to find out what is in it. Every message now carries a **timestamp** — previously "when was this said" was unanswerable anywhere in chat, which made a transcript impossible to line up against the event log or against what an agent claimed.

  Agent-to-agent threads get their own view behind a toggle, showing one set or the other rather than mixing them. They are **read-only** — you are not a participant, so there is no composer offering to post as one of them and no button to delete their transcript — and **both speakers are named**, since in that thread neither voice is yours. Without this they would simply have appeared in your session list and raised unread badges on your own inbox every time an orchestrator delegated on its heartbeat, which is exactly what pulling project chats out of this tab was meant to stop.

### Security

- **A mesh peer could drive the control plane through its owner.** A VoleNet tool executes *on the node that owns it*, and a node with no `share.toolAllow` advertises everything it has — so an orchestrator on the mesh was lending `agent_submit`, `agent_write_config`, `agent_restart` and `agent_create` to every authorized peer. A peer that could not manage agents itself could call one and have every local check pass, because by then the call genuinely was the orchestrator's.

  Control-plane tools are now withheld from the mesh by **source** (`CONTROL_PLANE_PAWS`), the same way remote tools are already kept from being echoed back. Excluding by source rather than by an `agent_*` name pattern means a tool added later cannot be missed by forgetting to update a pattern.

- **Seven advisories cleared in the docs toolchain.** `mermaid` to 11.17.2 (four, including prototype pollution), which also picks up a patched `dompurify`; `nanoid` floored past its predictability advisory. All devDependencies — none ship in the published package. `nanoid` is capped at `^3.3.18` rather than floored openly, because `postcss` declares `^3.3.16` and a bare `>=` resolved it to nanoid 6, breaking that contract while the audit read clean.

### Fixed

- **VoleDrop refused the files people most want to move.** A gameplay capture is routinely 6-14 GB and the transfer limit was 2 GiB, so the exact use case — hand a recording from the machine that made it to the machine that edits it — was the one that failed. `net.files.maxBytes` now defaults to **16 GiB**, and the disk is the real boundary: free space is already checked before an offer is accepted, and `0` lifts the byte ceiling entirely. The pipeline was never the problem; it streams and chunks throughout, and the arithmetic holds past a terabyte.

- **An over-sized upload transferred in full before being refused.** The dashboard streamed the whole file, noticed the running total had crossed the budget, and failed with `upload too large` — naming neither the limit nor the way to raise it. A 6 GB file therefore spent minutes uploading to be told no. Both upload routes now check `Content-Length` first and refuse in milliseconds with the limit, the setting that governs it, and the suggestion to send from a path with `net_send_file` instead. The in-pipeline budget stays, because `Content-Length` is a hint and can lie.

- **A relayed transfer that was too big said only "too-large".** Read as "VoleDrop cannot do this", when a direct route carries any size — the hub ceiling exists because relayed bytes land on somebody else's disk. Hub denials for size and quota now name the hub's limit, the setting behind it, and pairing as the way around it. The relay limit itself is unchanged at 512 MiB, deliberately.

- **`vole upgrade` left skills behind.** Paws are npm packages, so `npm install` reached them; skills are files fetched from VoleHub into `.openvole/skills/`, and nothing ever refreshed them. An agent could sit on a skill from months ago with no signal that a newer one existed — including fixes it was actively hitting. `vole upgrade` now checks each installed skill against the registry and refreshes the ones that are behind, reporting per skill exactly as it already does per package. At a server root it does this for every registered agent.

  Only skills under `skills/volehub/` are rewritten: the installer put them there and the config names them `volehub/<name>`, so they are the registry's to manage. A skill sitting directly in `skills/<name>` is somebody's own work — hand-authored, or a copy deliberately edited — and is reported when the registry has something newer but never overwritten, the same care `BRAIN.md` already gets.

  A registry that cannot be reached is a note, not a failure: the paws still upgraded.

- **Skill versions compared as strings.** `0.9.0` sorts after `0.10.0` lexically, so a skill nine releases behind looked current. Comparison is now numeric per segment (`isOlder`, exported from `skill/volehub.ts`).

- **A tool called over MCP did not know which run it belonged to.** A brain that exposes its tools to a CLI (`CLAUDE_CODE_EXPOSE_TOOLS=1`) does not call them through the loop — it calls the agent's MCP endpoint, which is stateless and reached `execute()` with no context at all. Everything the context carries was therefore silently absent for those agents: a message never knew who was waiting, so its answer could not be relayed, and **the hop count reset to zero on every message**, so the budget meant to stop two agents talking forever never once engaged. Nothing errored; the features simply did nothing, which is why two rounds of prompt tuning could not reach it.

  The context is now resolved from the running task, and only when there is exactly one. Above `taskConcurrency: 1` a stateless call cannot say which run it came from, and answering with "whichever started last" is the ambient-state mistake that files a reply under somebody else's conversation — better to carry no context than the wrong run's.

- **Every turn of an agent conversation was relayed, not just the answer.** The relay address rode along with each message in the chain, so once the colleagues began winding down — "sounds good", "happy to help" — each of those turns landed in the asker's chat as though they had asked for it. Provenance says who was waiting, not that they are owed a copy of everything said afterwards. The address is now **spent on the answer**: one question, one answer. The agents may keep talking; that conversation stays in their own thread, where the hop budget ends it.

- **Chat stamped messages only on reload.** Timestamps came from stored history, so a bubble created as you sent — or as a reply arrived — passed none and silently got no stamp at all. The times appeared only after reopening the panel, which is exactly when they are least useful. The meta row is now built in one place and can be applied to a bubble that already exists, so a pending reply is stamped when the answer lands rather than when the question was asked. The older flattened-transcript path was capturing a clock time in its regex and discarding it; it now uses it.

## v4.17.0 (2026-08-25)

> Ships as `openvole` 4.17.0 alongside `@openvole/dashboard-server` 0.14.0, `@openvole/paw-sdk` 3.2.0 and `@openvole/paw-session` 2.4.0. Projects and tasks — an agent can now be pointed at new work in conversation instead of by editing `AGENT.md`.

### Added

- **Projects.** Each is a folder in the agent's workspace holding its own context docs, notes, and task queue. A directory is a project when it contains `.project.json`, so the filesystem is the index and a project folder stays portable. Set a `root` to attach one to files elsewhere (a repo, a footage folder), or leave it out for self-contained work such as drafts and research. See [Projects & Tasks](/projects).

- **Project context loads per task.** `AGENT.md` and the other identity files are read once at engine start and cached, which made them the only place to record what an agent should work on — and meant every change of assignment was a file edit plus a restart. A project's context docs are loaded for the task that names it, so switching projects is neither. Agents with no projects get a byte-identical prompt to before.

- **Tasks with done-criteria.** A task carries checkable conditions and moves `running → verifying → done`; it cannot reach `done` without passing through verification. Unmet criteria send it to `blocked` with a note naming what failed, rather than being reported as finished. Stored append-only in `tasks.jsonl`, so the file is also the history. Iteration budgets block on exhaustion instead of stopping silently.

- **Agent-driven setup.** Ten new tools — `project_scan`, `project_create`, `project_list`, `project_open`, `project_update`, `project_archive`, `task_create`, `task_list`, `task_update`, `task_next`. "Work on the openvole repo" becomes: scan the directory (read-only), draft a `VOLE.md` from what was actually found, propose the project and opening tasks, create them once you agree.

- **Project-scoped schedules.** A schedule can name a project, turning a heartbeat from "wake up and do something" into "pick up this project's queued work" — the agent arrives knowing the goal and its criteria. Selecting work does not claim it, so a crashed run cannot strand a task in `running`. A chat message never pulls queued work: what you asked for is the instruction.

- **Brain-drafted context and identity files.** The project context doc and each identity file (`SOUL.md`, `USER.md`, `AGENT.md`, `HEARTBEAT.md`, `BRAIN.md`) get a prompt box and a **Draft** button: describe what the file should cover and the agent writes it. Drafting it opens the project and reads its real files first, so the result is grounded in what is there. The draft fills the editor and is never saved for you. Drafts run under a reserved session so they stay out of the chat transcript and the unread badge.

- **Clear and compact a project conversation.** **Clear** deletes the transcript; **Compact** has the agent summarize everything except the last few messages and puts the summary in their place, so what was decided survives while the length does not — every run that loads the conversation pays for all of it. Compaction is atomic in the agent: the summary is written before anything is removed, so a failed think leaves the chat intact. The chat window now paints the most recent messages with a control to pull in earlier ones, rather than rendering a thousand-message conversation to show the last three; the transcript on disk stays whole either way.

- **Control requests that run the brain get a real deadline.** They shared the 15-second timeout meant for lookups, which a CLI-backed brain misses every time.

- **Per-project chat.** Each project has its own conversation on its page, running in that project's context — its docs and open tasks are already loaded, so you can describe what you want and the agent works out the tasks instead of you filling in a form. Project conversations stay off the central Chat tab so that list doesn't fill with unlabelled sessions.

- **Delegated work stays visible.** A task carries an `assignee` and a `delegatedTaskId`, so a task handed to a sibling agent shows who holds it rather than reading as abandoned, and the coordinator can poll it with `agent_task_status` and record the outcome and artifacts back onto the task. A project belongs to whoever owns the outcome, not whoever does the labor; the worker reports and the owner records, keeping one writer per ledger.

- **A Projects tab in the dashboard.** Projects with their open-task counts, the selected project's context docs, and a task board grouped by state with done-criteria and block reasons. Task buttons offer only the moves that are legal from the current state, and blocking prompts for a reason. Create a project from the UI, with a **directory picker** for choosing its files: browsers withhold absolute paths from `webkitdirectory` and the File System Access API, so the listing is served by the control plane from the machine the agent runs on. It reports whether the chosen folder is inside `security.allowedPaths` and offers to grant it, noting that a running agent needs a restart to pick the grant up. Scanning a path fills in the project's kind and stack. Served from the agent's files, so it works while the agent is stopped.

- **The agent can work on its project's files.** Five new tools — `project_file_list`, `project_file_read`, `project_file_write`, `project_file_move`, `project_file_delete` — act on the project the current task belongs to, with paths relative to it. `workspace_*` is confined to `.openvole/workspace/` and cannot reach an attached root, so until now the dashboard could edit a project's repo while the agent could not: working in one meant installing a filesystem paw and granting it the path, which then reached the whole grant rather than that project. Because every path resolves against *this task's* project, an agent with two attached projects cannot reach from one into the other.

- **Tools can see the call they are serving.** In-process tools now receive an optional second argument carrying the current project. Passed per call rather than captured when the tool is built — task concurrency is configurable, and a remembered "current project" would answer for whichever task started last. Tools that ignore it are unaffected, and paw tools over IPC never receive one.

- **A file browser and editor on the project page.** The **Files** sub-tab browses both places a project's files can live — its folder in the agent workspace and the root it is attached to — and edits them: open, save, create, rename, move, delete — plus drag-and-drop to bring in files that already exist, streamed to disk with a progress bar and suffixed rather than overwriting on a name clash. Seeing what the agent actually wrote previously meant ssh-ing to the machine it runs on. It is bounded by the project's own roots rather than by `security.allowedPaths`, deliberately: a surface that writes and deletes should not wander the whole grant. `.project.json` and `tasks.jsonl` open read-only, since both have proper editors and the task log is append-only and concurrently written.

- **`VOLE.md` replaces `CONTEXT.md`, and the project folder is the context.** **Every** markdown file at the top of a project's folder is loaded into the prompt, `VOLE.md` first, then `CONTEXT.md` for projects that already have one, then the rest alphabetically. For an attached project a `VOLE.md` at the **repo root** is read too, and read first — checked in, travelling with the code, so every agent that picks the project up gets the same briefing. One hardcoded filename could not hold a project that wants conventions and a glossary alongside its overview. A 20,000-character budget still applies; files past it are named in the prompt rather than inlined, and `contextFiles` in the manifest picks which are worth the budget.

- **The context preview collapses.** Written once and read by the agent, an always-open panel spent half the screen above the task board the page is actually for. It is now one line naming the docs that are loaded, expandable, and still editable from **Context**.

- **The dashboard comes back where you left it.** The page reloads itself when the websocket drops — a laptop waking, a network blip, a server restart — and nothing remembered which agent or tab you were on, so every reconnect dumped you on the agents list and read as the dashboard going home by itself. The agent, tab and open project are restored, falling back to the launcher if that agent is gone.

- **`vole project` and `vole task` commands** — list, scan, create, open, archive; add, list, next, update, cancel. They read the project files directly, so they work with the agent stopped. `vole task` previously existed as a stub that only ever printed "requires a running vole instance"; it now manages real work items.

- **`SchedulerStore.trigger(id)`** fires a schedule immediately without disturbing its cron.

- **`vole upgrade` covers a whole server.** Run at a vole server root (the directory holding `agents.json`) it upgrades every registered agent and reports per agent; run inside an agent directory it still upgrades just that one. Paws are installed per agent, so a published fix previously reached an agent only if someone remembered to upgrade that directory — agents sitting on old paws look like live bugs rather than missed upgrades.

- **A run reports where it came from.** Every task now carries a reply address, decided when it is created and derived from the run itself: its own conversation for a chat turn, its **project's** conversation for project work, the dashboard chat otherwise. The same address is used by the reply, by `chat_send`, and by the dashboard deciding where to show the result, so the three cannot disagree — and the agent is told what it is, so a question it raises mid-task lands beside its report. A task started with **Run now**, or picked up from the queue by a heartbeat, therefore reports on the project page instead of the general chat. A project's row carries a count when reports arrive while you are elsewhere; opening its Chat sub-tab clears it.

- **A task's lifecycle is on its card.** Every state it passed through, when, and any note recorded on the way — newest first, under a summary line giving the current state and when it was created. `tasks.jsonl` has always appended a record per change, so this reads a trail that was already on disk rather than adding bookkeeping; `TaskStore.history()` reconstructs it. Board columns are ordered by most recent activity, and the queued column marks the task that will actually be picked up next, which is a different question from which one changed last.

### Fixed

- **Reports no longer drift into the wrong conversation.** A run without a session had no reply address at all, so paw-session filed its result against a module-global "current session" — whichever task happened to bootstrap last. Tasks interleave, so this was right until two overlapped and then silently wrong, which is how a heartbeat's or a board task's report turned up in an unrelated chat. Requires `@openvole/paw-session` 2.4.0, which drops that fallback and uses the address core now sends.

- **One run's tool results could land in another run's transcript.** The same ambient-state bug one layer down: an observe hook receives only the result, so a paw recording tool calls had to consult its own "current session". Those lines are then replayed into that chat's prompt on its next turn. Core now stamps each result with the run's own conversation — absent for a heartbeat or a board task, which have none and whose tool traffic belongs in no transcript.

- **The Tasks list no longer grows into the Live Events feed.** It was sized to stretch between 190px and 400px, so every task that arrived pushed the feed further down the page while you were reading it. The list now holds one height and scrolls inside itself. It also gained a **When** column: the existing time column is a duration, so a finished task told you it took four seconds but not whether that was this morning or last week. Hovering it gives the full queued/started/finished trail.

- **`vole upgrade` no longer overwrites a customized `BRAIN.md`.** It used to move the local file to `BRAIN.md.old` and write the package version over it. BRAIN.md is the agent's system prompt and the most likely file to be hand-tuned, and now that one command walks every agent on a server, that would replace every customized prompt at once. A changed default is written alongside as `BRAIN.md.dist` instead.

### Removed

- The **ClawHub Skills** link is gone from the dashboard footer.

### Security

- **A project root can never widen the sandbox.** An external `root` must already resolve inside `security.allowedPaths` (the agent's own directory always counts); creation is refused otherwise and names the path a human would have to grant. Symlinks are resolved before the check, so a link inside the workspace cannot smuggle access out of it. `project_scan` authorizes against the same set — scanning must not reach further than creating.

- **A project's `toolProfile` narrows only.** Denials union and allowlists intersect, so a project cannot hand its agent a tool the agent did not already have. This matters because the agent writes its own project manifests.

- **The scratch tools can no longer damage project records.** `workspace_write` and `workspace_delete` refuse `.project.json` and `tasks.jsonl`, and refuse to delete a project folder or the workspace root — `workspace_delete` is recursive, so the dangerous case was never the manifest by name but the folder containing it. Reads are unaffected.

## v4.16.2 (2026-08-06)

> Ships as `openvole` 4.16.2 (`@openvole/dashboard-server` unchanged at 0.13.1). Tool-call validation fix, found by an agent field-testing the demo-studio skill.

### Fixed

- **`skill_run_script` shredded string args into characters, and MCP tool calls skipped validation.** Tools invoked over MCP (a Claude Code brain with `CLAUDE_CODE_EXPOSE_TOOLS=1`) or from dashboard panels reached `execute()` without schema validation — the brain loop validates, that path did not. So `args` passed as a string survived to a spread and `"--out x"` became `['-','-','o',…]`. The MCP/panel path now validates against the tool's schema exactly like the loop, and `skill_run_script` additionally accepts `args` as a single space-separated string.

## v4.16.1 (2026-08-04)

> Ships as `openvole` 4.16.1 (`@openvole/dashboard-server` unchanged at 0.13.1), alongside `@openvole/paw-session` 2.3.1 on PawHub. Windows fixes: session transcripts and received filenames.

### Fixed

- **Received filenames are normalized for the receiving filesystem.** A sender's filesystem happily allows names NTFS cannot create — macOS will produce `screen:shot.png` — and a VoleDrop transfer to a Windows receiver then failed at the final rename. The receiver now replaces Windows-reserved characters (`< > : " | ? *`) with underscores, strips trailing dots and spaces, and prefixes DOS device names.

### Also on PawHub

`@openvole/paw-session` **2.3.1** — session transcripts were silently lost on Windows: every colon-named session (`volenet:<peer>`, `telegram:<chat>`, `dashboard:<stamp>`) failed to persist because `:` is an illegal NTFS directory name. Directory names are now percent-encoded (reversible; `dashboard` stays `dashboard`), and pre-encoding directories migrate on first start with history intact.

## v4.16.0 (2026-08-02)

> Ships as `openvole` 4.16.0 and `@openvole/dashboard-server` 0.13.1. Windows support for in-process Paws, symmetric VoleNet pairing, and file transfers that are no longer capped at 256 MiB.

### Fixed

- **In-process Paws failed to load on Windows.** Core imported a Paw's entry file by absolute path, which Node's ESM loader accepts on POSIX but rejects on Windows: `ERR_UNSUPPORTED_ESM_URL_SCHEME … Received protocol 'c:'` — the drive letter parsed as a URL scheme. `paw-compact` is the only Paw that runs in-process, so it was the only one that failed while every subprocess Paw loaded normally. Both computed imports (the Paw entry and a JS/TS `vole.config`) now go through a `file://` URL.
- **Accepting a VoleNet pair request left the pairing one-sided.** The accepting node trusted the key and dialled the requester's endpoint but never recorded it as a peer, so its peer list stayed empty and it had nothing to reconnect to after a restart — the operator had to add the peer by hand or send a pairing request back. Accepting now saves the peer exactly as initiating does, when the requester advertised a reachable endpoint.
- **A test could fail purely under load.** A VoleNet interop test polled for up to 12s while declaring no timeout, so vitest's 5s default killed it mid-wait on a busy machine.

### Changed

- **File transfers are no longer capped at 256 MiB.** `net.files.maxBytes` now defaults to **2 GiB**, and `0` disables the limit entirely. Transfers are chunked, resumable and streamed to disk, so the limit only ever protected disk space — which is now guarded directly: an offer is declined with `no-space` when the inbox filesystem cannot hold it. Rejections state both numbers (`too-large: 3.4 GiB exceeds this node's limit of 2 GiB`) instead of a bare `too-large`.
- **Relay limits are independent of what a node accepts for itself.** The hub's per-blob cap moved to its own `net.files.relayMaxBytes` (default 512 MiB) rather than tracking `maxBytes`, so raising your own accept limit cannot turn your relay into unbounded storage for other people's traffic. The dashboard's browser upload spool now allows 4 GiB and is tunable with `VOLE_UPLOAD_MAX_BYTES`.

## v4.15.0 (2026-07-28)

> Ships as `openvole` 4.15.0 and `@openvole/dashboard-server` 0.13.0 (plus `@openvole/paw-session` 2.3.0 on PawHub). Agent renaming, and two fixes to the features added in 4.14.0.

### Fixed

- **Live Events opened empty, and the current day was listed as history.** The feed showed only events that arrived *after* the page was opened, so an idle period was indistinguishable from a broken feed — while the current day's log sat in the day dropdown as though the day had ended. Live mode now **loads the current day and follows it**: the most recent 300 entries for the selected agent, with new events prepended as they arrive. The dropdown reads **Live (today)** followed by earlier days only, the **raw** download link works in live mode, and switching agents reloads the feed for the newly selected one. The current day is determined by the server, so a dashboard in a different timezone still follows the file being written.
- **An agent's chat message could be announced and then lost.** `chat_send` emitted its event and left storage to `paw-session` 2.3.0, which subscribes to that event; on any earlier version the message was never recorded, producing a notification with no message behind it and a chat that opened empty. Core now writes the transcript itself through `session_append` (available since paw-session 2.2.0) *before* announcing, reports `persisted` from the result of that write, and marks the event `stored` so a subscribing paw-session does not record it a second time.

### Added

- **Rename an agent from the dashboard.** Each agent card gets a **Rename** button, and the CLI gains `vole agent rename <name> <new name>`. It changes the **display name only** — the id keeps naming the folder on disk, `VOLE_AGENT_ID` in the running engine, the agent's MCP endpoint, and the key the dashboard files its chat history and unread counts under, so a rename needs no restart and a running agent is untouched. Names are unique across the server, compared case-insensitively against ids *and* names, because either can address an agent (`agent_submit`, the CLI, the control plane).

## v4.14.0 (2026-07-26)

> Ships as `openvole` 4.14.0, `@openvole/dashboard-server` 0.12.0, and `@openvole/paw-sdk` 3.1.0. Theme: **channels are two-way** — an agent can start a conversation — plus a durable event log.

### Added

- **Channels: your agent can now message you first.** Replying always worked (you chat, the task result comes back). Starting a conversation didn't: a heartbeat or scheduled run carries no session, so an agent told *"ask me before you ship"* had nowhere to put the question and would file it into a journal or a task result nobody was watching. Core now keeps a **channel registry** — its own built-in channels plus every loaded Paw declaring the `"category": "channel"` that was already in its manifest — and tells the agent about them in a new **`## Channels`** system-prompt section: which channels exist, what each reaches, and the tool that sends on it. Instructions can stay in plain language ("ask me in the dashboard chat", or just "message me" when one channel is loaded) — no tool names in `AGENT.md`. Channels also stay visible under tool horizon, because a channel you have to discover first goes unused. There is deliberately **no** `message_user` wrapper: the agent calls the channel's own send tool, the same idiom for chat, Telegram, and Slack alike.
- **`chat_send` — the dashboard chat as a built-in channel.** A new core tool: `chat_send({ text, session? })` messages you in the Chat tab from any run, heartbeats included. No paw to install and nothing to configure — the dashboard chat is core's own surface (no credentials, no external service, nothing a subprocess sandbox would protect), so only channels that talk to *someone else's* platform stay Paws. The message is filed into the session transcript by `paw-session`, so it is real chat history — it raises an unread badge and a toast, and it is waiting for you even if the browser was closed when it was sent. One-way and non-blocking: your reply arrives later as its own task with the conversation behind it. If `paw-session` isn't loaded the tool says so instead of reporting a delivery that leaves no trace.
- **Live Events are saved daily, in full.** The control plane appends every event to `<root>/.openvole/logs/events-YYYY-MM-DD.jsonl` — one JSON object per line, payload written whole, a new file each local day, so an overnight run stays in one file. The in-page feed keeps 500 lines; the file keeps the day. Pick a day from the dropdown next to **Live Events** to read it back (newest first, and the note says how many older entries the bound left out), or hit **raw** for the untouched file at `GET /events.jsonl?day=YYYY-MM-DD` — token-gated, streamed, greppable with `jq`. Logs older than 30 days are pruned on rotation; `VOLE_EVENT_LOG_DAYS=0` keeps everything.
- **Click an event to see all of it.** The Live Events row is a one-line preview; clicking expands the whole payload, pretty-printed, wrapped and selectable. Previously a long tool result or error was clipped by the row and unreachable.
- **`emit()` on the paw SDK** (`@openvole/paw-sdk` 3.1.0) — the companion to `onBusEvent`, for channel Paws reporting a message that crossed their channel.

### Fixed

- **A Paw could not emit a bus event at all.** The core handler for `emit` destructured the event name, logged it, and returned `ok` — it never published, so the SDK's emit path went nowhere and a channel Paw had no way to reach the dashboard or the transcript. It now publishes, restricted to the `channel:*` namespace: a Paw is sandboxed and untrusted, and one that could emit `task:completed` would drive core's own subscribers (fabricated brain replies in transcripts, fabricated tasks in the dashboard). The emitting Paw's name is stamped by core, never read from the payload.
- **Unread chat counts missed anything without a task behind it.** The 4.13.2 recount read the task list, which cannot see an agent-initiated message. Reconnect now recounts from the **session transcripts** (`lastActive` vs the read watermark, then the messages after it), which also covers replies older than the engine's last-50 task window. Sessions seen for the first time on a browser still adopt their history as read; agents on an older `paw-session` keep the task-derived count.
- **Unread chat counts were wrong in every direction: stuck, reappearing, and counting things that were never yours to read.** Four separate faults, now fixed together:
  - **Opening a chat re-flagged the very message you had just read.** The read watermark was set from the *task's* `completedAt`, but `paw-session` stamps the transcript entry when it appends it — always a moment later. So the transcript recount saw an entry newer than the watermark and immediately counted it again. Reading a chat now anchors the watermark to the newest entry actually rendered.
  - **The two counting passes overwrote each other.** The task-derived pass replaced the whole per-agent map on every state push, wiping counts the transcript pass had computed for messages with no task behind them (an agent-initiated one), which then reappeared — the flapping. The task pass now only rewrites sessions the task list actually covers.
  - **Machine traffic badged your inbox.** Any completed task with a session counted, so an orchestrator's brief to a sibling and channel replies (Telegram, Slack) raised unread on the dashboard chat for conversations nobody would ever open. Only work a person started here counts now, and orchestrator briefs are submitted as `source: 'agent'` instead of masquerading as `user` (they also pick up `toolProfiles.agent` restrictions, which they had been escaping). `task:completed` / `task:failed` now carry `source`.
  - **A chat you never reopen kept its phantom count.** The two fixes above correct a session when you read it or when something new arrives — but a quiet session (an old `dashboard:…` conversation, a channel session) had neither, so a count recorded before the fix sat there permanently. The recount now resolves *every* known session, clearing those whose newest content — transcript, task, or channel message — is not newer than your watermark, allowing for the few milliseconds a transcript entry trails the task it records. This is why an agent with several old sessions kept a badge while an agent with only the chat you actually use looked fine.
  - **VoleNet peer unread had the same hole.** The agent-card badge sums brain-chat *and* VoleNet unread, and a peer count clears only by opening that peer's chat — so a peer that left the roster left a number nothing could clear (why an agent with peers, like an orchestrator, kept a badge that an agent without them did not). Counts for peers no longer in the roster are now swept, and **Mark all read** clears both kinds, so the button clears exactly the number the badge shows.
  - **A count for a deleted session could never be cleared** — no chat existed to open, so the agent-card badge hung there forever. Counts for sessions the agent no longer reports are now swept. The session dropdown also shows where unread lives (`dashboard — 12 msgs · 2 unread`), and a **Mark all read** button appears in the chat toolbar when an agent has unread anywhere.
- **Switching agents could show the previous agent's chat — and keep showing it.** Opening an agent's chat, going back to the agents list, and opening a different agent rendered the *first* agent's conversation, cached under the second agent's key so reopening the tab kept serving it. Two causes, both fixed: the chat reloaded *before* `select_agent` reached the server (so the server answered `chat_history` for the old selection — the same hazard the config and identity tabs were fixed for earlier), and a response that arrived after a switch was painted regardless of which agent was on screen. Now **every command names its target agent** rather than relying on the connection's current selection, and **every agent-scoped load is tagged with a view generation** that is checked before anything is rendered — applied across chat, VoleNet peers and peer chat, VoleDrop transfers, config, identity, embedded app panels, and the Live Events feed (which also clears on switch, so one agent's events can't be read as another's). A write that was in flight during a switch now lands on the agent it was issued for, not the one you switched to.
- **Headless mode skipped channel Paws by a hardcoded name list** (`paw-telegram`, `paw-slack`, `paw-discord`, `paw-whatsapp`) — so `paw-msteams`, `paw-voice-call`, and any new channel started up in a mode where no human is attached. It now skips by manifest category.

### Also on PawHub

`@openvole/paw-session` **2.3.0** — subscribes to `channel:message` and files it into the transcript (`out` as the agent, `in` as the human). Required for agent-initiated chat messages to appear in chat history. Also declares `session_append` in its manifest, which the registry had been under-reporting.

**Upgrading a running `vole serve`:** upgrade, restart, and hard-refresh the dashboard. Every agent can reach you through the chat immediately — no config change.

## v4.13.2 (2026-07-26)

> Ships as `openvole` 4.13.2 and `@openvole/dashboard-server` 0.11.1. Chat continuity: nothing lost while you're away.

### Added

- **Brain-chat replies now count as unread — including ones that land while the browser is closed.** A reply you weren't looking at raises a badge on the **Chat tab** and on that **agent's card** (which sums brain-chat and VoleNet unreads), plus a toast naming the agent and session. Counts are per agent *and* per session and clear when you open that chat. Rather than relying only on live events (which need an open page), the dashboard keeps a per-chat **read watermark** and recounts from the agent's task list on reconnect — so a reply that arrived overnight is waiting for you. Watermarks use engine-side timestamps, not the browser clock, so a remote dashboard on a skewed clock stays correct; a chat seen for the first time on a browser adopts its history as read instead of badging everything. Heartbeat and schedule runs are excluded — only sessioned chat work counts. (Recount covers the selected agent's last 50 completed tasks; other agents count live while the page is open.)

### Fixed

- **Leaving and reopening the chat lost an in-flight response.** Reloading the chat wipes its DOM, which orphaned the pending entry for a running task: the "thinking…" animation disappeared *and* — worse — the eventual answer was written into a detached element, so it never showed up in the reopened chat (only after another reload). The chat now re-attaches to any task still running in that session: the animated placeholder returns and the answer lands in it. Tasks carry `sessionId` into the dashboard state so the chat can tell its own work from heartbeat, schedule, and other sessions' tasks.

**Upgrading a running `vole serve`:** restart after upgrading and hard-refresh.

## v4.13.1 (2026-07-25)

> Ships as `openvole` 4.13.1 (`@openvole/dashboard-server` unchanged at 0.11.0). A prompt fix.

### Fixed

- **Agents didn't know where to put files.** The system prompt described identity, skills, tools, memory and peers — but never the agent's own scratch space, so an agent using shell wrote relative paths into its process cwd: the agent root, next to `vole.config.json` and `.openvole/`. (The `workspace_*` tools were always confined correctly; the convention only lived in their tool descriptions and a README *inside* the workspace.) A new **Files & Workspace** section now states the absolute `.openvole/workspace` path, notes that shell commands start in the agent root and need an absolute path or a `cd`, and rules the agent root and `.openvole/` off-limits. No per-agent `AGENT.md` instructions needed.

**Upgrading a running `vole serve`:** restart after upgrading so agents pick up the new prompt.

## v4.13.0 (2026-07-25)

> Ships as `openvole` 4.13.0 and `@openvole/dashboard-server` 0.11.0. Theme: **VoleDrop** — E2E-encrypted file transfer over VoleNet.

### VoleDrop — file transfer (`net.files`)

Send a file from one vole to another, machine-independently, end-to-end encrypted — where the receiver is an *agent inbox*, so a transfer can carry intent (drop a recording into an agent's watch folder from another machine). One primitive, three surfaces:

- **Agent tools**: `net_send_file`, `net_file_status`, `net_accept_file`, `net_reject_file` (async — progress/completion via `volenet:file:*` events).
- **Dashboard**: 📎 attachments in the VoleNet peer chat — staged in the composer and sent with **Send**, with the typed message riding as the offer's note; Accept/Decline bubbles with live progress that also **reappear when the chat is reopened** while an offer is pending.
- **CLI**: `vole net send <file> --to <peer> --agent <name> [--wait]`.
- **Unread badges**: chat/file notifications now persist as per-peer, per-agent unread counts — on the peer row, the VoleNet tab button, and each agent card (messages to a non-selected agent light up its card) — surviving agent switches and reloads.

How it works: control messages ride the signed channel; bulk bytes stream over new `/volenet/blob/*` routes as chunked chacha20-poly1305 frames. The per-transfer key is sealed with the **PQ-hybrid seal** (X25519 + ML-KEM-768) — file confidentiality never depends on `net.encrypt` or TLS. Per-chunk AEAD tags plus a whole-file sha256 verify before anything lands; interrupted transfers resume from the last complete chunk. Direction negotiates automatically (receiver-pull / sender-push / **relay blobs** for two NAT'd hub members — the hub stores ciphertext only, quota'd and TTL-swept). Consent mirrors relay: `net.files.acceptFrom` auto-accepts (your fleet); everything else waits for an explicit accept, expiring after `net.files.offerTtlMinutes` (default 60). Covered by six new e2e suites (pull, push+consent, relay+corruption+quota, interrupt-resume, crypto framing, pairing).

### `vole net pair` — consent-based peer pairing

Connecting two of your own nodes used to be a four-step manual key exchange. Now: `vole net pair <url>` fetches the peer's key from `/volenet/info`, shows its **fingerprint** for confirmation, trusts it and adds the `net.peers` entry — then files a pair request that the **other side's operator must accept** (dashboard VoleNet tab → Pair requests, or `vole net pair list|accept|deny`). Nothing is trusted remotely until the accept, which takes effect live. The dashboard's peer list also gains a **+ Connect** button that drives the same pair flow (probe → fingerprint → confirm) and the public-hub **join** flow entirely from the browser — fully live, no restarts. `vole net join` against a non-hub now explains itself instead of dying with a JSON parse error.

### Fixed

- **Dashboard NET form: `net.encrypt` and `net.publishNames` toggles were silently non-functional** — the save path's preserve loop overwrote both checkboxes with the stale on-disk values. They now persist.
- **Dashboard NET form dropped `net.share.toolAllow` on every save** — the share checkboxes rebuilt the object from scratch. The curated tool list now survives saves.
- **Dependency security**: `pnpm audit` is clean — transitive vulnerabilities (fast-uri, postcss, protobufjs, @hono/node-server) resolved via overrides.

**Upgrading a running `vole serve`:** restart after upgrading and hard-refresh the browser. File transfer needs 4.13.0 on both ends (older peers silently ignore offers, which then expire). Reverse-proxied hubs: raise nginx `client_max_body_size` on the `/mesh` location for relay blobs.

## v4.12.5 (2026-07-25)

> Ships as `openvole` 4.12.5 (dashboard-server unchanged at 0.10.2). A VoleNet remote-tools fix.

### Fixed

- **Remote tools re-registered on every discovery cycle.** When two peers share a tool name (every agent runs paw-memory, so `memory_*` collides on any mesh), each 15-second discovery cycle re-entered conflict resolution and re-registered the peers' tools: `tool:registered` events flooded the dashboard's Live Events, the registry minted mangled duplicate names (`__volenet:x___x/tool`), and — worst — the plain tool's owner record was lost after the first rename, so later cycles could relabel a tool to the **wrong peer**. Now: a re-announcement of an already-registered remote tool is a silent no-op, the plain name is renamed once using only the recorded owner, and a paw re-registering its own tool replaces it in place without a conflict. Covered by a three-node regression test driving repeated announce cycles.

**Upgrading a running `vole serve`:** restart after upgrading.

## v4.12.4 (2026-07-24)

> Ships as `openvole` 4.12.4 and `@openvole/dashboard-server` 0.10.2. A small dashboard link + logo refresh.

### Changed

- **Dashboard links.** The OpenVole logo now links to [openvole.com](https://openvole.com). In the footer, PawHub and VoleHub point at their `openvole.com` subdomains (`paw.openvole.com`, `hub.openvole.com`), a new **VoleNet** link (`net.openvole.com`) is added, the three hubs are grouped together, and `npm` moves next to ClawHub.
- **Refreshed logo and favicon** assets.

**Upgrading a running `vole serve`:** restart after upgrading and hard-refresh the browser.

## v4.12.3 (2026-07-23)

> Ships as `openvole` 4.12.3 and `@openvole/dashboard-server` 0.10.1. A dashboard fix release.

### Fixed

- **Saving config from the dashboard no longer drops `skills` (or any key the form doesn't model).** The Config tab rebuilds the config from its form fields and `write_config` replaces the whole file — so every save silently deleted `config.skills`. Installed skills stayed on disk but were deregistered and stopped loading (and stopped showing on the dashboard). The form now preserves any unmodeled top-level key (`skills`, `demo`, schedules, …) on save.
- **The Overview Skills card now shows inactive skills.** The 4.12.2 redesign chipped only *active* skills, so an installed-but-inactive skill (one still waiting on a required tool) looked absent. Inactive skills now appear as muted chips alongside active ones.

**Upgrading a running `vole serve`:** restart after upgrading and hard-refresh. If a dashboard config-save had already wiped a skill from an agent's `config.skills`, re-add it (the skill files are still on disk) — e.g. `"skills": ["volehub/vole-club"]` — and restart that agent.

## v4.12.2 (2026-07-22)

> Ships as `openvole` 4.12.2 and `@openvole/dashboard-server` 0.10.0. A dashboard UI refresh — no core changes.

### Dashboard

- **Overview redesign.** The Overview tab is now a compact grid of summary cards — Paws, Tools, Skills, VoleNet, Schedules — each opening a slide-in detail drawer instead of long inline lists. VoleNet moved after Skills, and section headers are tinted so sections are easy to tell apart at a glance.
- **VoleNet tab.** A status card (instance name/id, leader badge, live peer / online / remote-tool counts) plus a per-peer detail drawer, following the same card convention as the Overview.
- **Live Events fills the page.** The event stream now expands to use the remaining height below the cards, so it's readable without scrolling the whole tab. The Tasks panel gets a sensible min/max height.
- **Responsive.** The tab bar and sections adapt to narrow / mobile viewports — horizontally scrollable tabs, stacked cards, and a full-width drawer.
- **Chat tab** gets a brain icon (fixes a glyph that rendered as a literal escape).

**Upgrading a running `vole serve`:** restart the server after upgrading (Node caches the dashboard module at startup) and hard-refresh the browser.

## v4.12.1 (2026-07-21)

> Ships as `openvole` 4.12.1 and `@openvole/dashboard-server` 0.9.1. A small opt-in read enhancement.

### Added

- **`net.publishNames`** — include peer display names (the live announced `instanceName`) in the public `/volenet/info` response. **Off by default** — names are an enumeration surface, so this is opt-in for a public hub whose members are meant to be seen (e.g. a social wall). With it on, external tooling can read live names from the endpoint it already fetches, instead of the authenticated dashboard WebSocket — the names propagate through discovery already, this just surfaces them on the read path. Toggle in the Config tab.

## v4.12.0 (2026-07-21)

> Ships as `openvole` 4.12.0 and `@openvole/dashboard-server` 0.9.0. Theme: **post-quantum confidentiality** — the relay seal goes hybrid, and direct-mesh links can be end-to-end encrypted too.

### Post-quantum hybrid seal

Sealed envelopes now mix an **X25519** ECDH shared secret with an **ML-KEM-768** (post-quantum) shared secret — HKDF-SHA256 over both — so confidentiality holds unless *both* the classical and the post-quantum KEM are broken. This closes the harvest-now-decrypt-later gap: ciphertext recorded today can't be read by a future quantum computer. Native (OpenSSL 3.5+ / Node 24+), no new dependency — the same best-effort pattern as the existing ML-DSA signatures.

- Every instance gains an ML-KEM-768 keypair (existing keypairs auto-upgrade on load) and announces its public key via discovery, signed by its identity.
- The **relay** seal upgrades to hybrid automatically whenever the peer announced an ML-KEM key.
- Backward-compatible and **downgrade-resistant**: a peer without an ML-KEM key (or a runtime without ML-KEM) falls back to X25519-only, and stripping the KEM ciphertext from a hybrid envelope fails the auth tag rather than silently weakening it.

### Direct-mesh end-to-end encryption

`net.encrypt: true` seals **direct** peer-to-peer messages too — not just relayed ones. Confidentiality no longer depends on TLS being configured; the message is encrypted to the peer's identity key with the same hybrid KEM.

- Transparent: a transport-level sealer wraps every post-handshake message in a `sealed:direct` envelope; the recipient unwraps and re-injects it through the normal pipeline, so signatures, replay windows, and authorization all still apply. Handshake, relay, and leader-election traffic stay plaintext (they bootstrap the keys / carry no secrets).
- **Opportunistic + opt-in**: seals only to peers that support it (announce an ML-KEM key); older peers still receive plaintext, so a mixed-version mesh keeps working. Off by default; toggle in the Config tab (`net.encrypt`).

### Dashboard

- Config → NET form exposes `net.encrypt` (`@openvole/dashboard-server` 0.9.0).

**Upgrading a running `vole serve`:** restart the server after upgrading and hard-refresh the browser. Post-quantum keys are generated on first load — no manual step. To turn on direct encryption, set `net.encrypt: true` on each agent (peers that haven't upgraded keep talking in plaintext until they do).

## v4.11.0 (2026-07-21)

> Ships as `openvole` 4.11.0 and `@openvole/dashboard-server` 0.8.0. Theme: **relay consent** — sharing a hub is not consent, plus two fixes that made relay members look offline.

### VoleNet relay — connection consent

Sharing a relay hub no longer means two agents can reach each other. A member's relayed chat is now **held until the recipient accepts it** — surfaced as a pending connect-request, not delivered. The relay moves bytes between peers that consent to each other; it never manufactures trust from co-membership.

- **`net.relay.acceptFrom`** (member-side policy): who may reach you over a relay.
  - *unset* (default) — only peers you've explicitly approved or already directly trust (secure default).
  - `"*"` — any hub member (the open community-hub shape; set this on the club and similar).
  - `["name", "id-prefix", …]` — a static allowlist by name or instanceId prefix.
- **Connect handshake:** A sends a sealed `relay:connect-request` → B approves or denies → on approval both accept each other and chat flows. Approvals persist to `.openvole/net/relay_accepts` (survive restarts) and pin the peer's key. A directly-trusted peer is exempt — you'd already accept its direct connection.
- **Dashboard:** the VoleNet tab shows incoming requests with **Approve/Deny**, marks relay members `relay` / `awaiting` / `connect`, and gates the chat box — an unaccepted member shows a **Send connection request** prompt instead of a composer. `net.relay.acceptFrom` is editable in the Config tab.
- The hub stays **blind** throughout: connect-requests, approvals, and chat are all sealed end-to-end; the hub sees only ciphertext and routing.

**Behavior change:** members on a shared/community hub that relied on open member-to-member chat must set `net.relay.acceptFrom: "*"` (or complete the handshake). This is the secure default the relay should have shipped with.

### Fixed

- **NAT'd relay members were stuck `connected: false` and unreachable.** A member behind NAT advertises its LAN address, which the hub can't reach. When a roster push briefly missed the member's live WebSocket, `sendToPeer` fell back to an HTTP POST at that unreachable address, failed, and **latched `connected = false` — with nothing ever setting it true again.** The member then looked offline forever and the relay refused to forward to it, even though its socket was working. `connected` is now owned purely by the WebSocket bind/close lifecycle: a successful push heals it, a failed best-effort fallback never latches it false.
- **Relay members never appeared in the VoleNet tab under `vole serve`.** The `volenet_relay_members` command was handled by the agent adapter but never wired through the control plane, so it fell through to "Unknown command" and the UI silently showed nothing. Now wired (along with the new consent commands).

**Upgrading a running `vole serve`:** restart the server after upgrading (Node caches the dashboard module at startup) and hard-refresh the browser. **Relay hubs (e.g. the club) must upgrade** to get the connected-latch fix — it is hub-side.

## v4.10.3 (2026-07-20)

> Ships as `openvole` 4.10.3 and `@openvole/dashboard-server` 0.7.8. Completes the 4.10.2 config-isolation fix.

### Fixed
- **The 4.10.2 config-cross-write fix was incomplete.** It reset the cached form on agent switch but, when reloading, called `read_config` *before* the server recorded the new selection — so it re-read the *previous* agent's config and the form still showed stale values. The reload now runs after `select_agent` is acknowledged, so switching agents (including while sitting on the Config tab) shows the correct agent's config. Verified against the full switch sequence.

**Upgrading a running `vole serve`:** restart the server after upgrading (Node caches the dashboard module at startup) and hard-refresh the browser.

## v4.10.2 (2026-07-20)

> Ships as `openvole` 4.10.2 and `@openvole/dashboard-server` 0.7.7. A data-integrity fix for multi-agent servers.

### Fixed
- **Saving config (or identity) for one agent could overwrite it for another.** The Config and Identity tabs load lazily and cache, but switching agents in the dashboard never reset them — so the form kept the *previous* agent's values, and saving wrote those to the newly-selected agent. Repeated across agents, their configs converged. Switching agents now reloads config and identity for the agent you're actually on. **Multi-agent `vole serve` users should review each agent's `vole.config.json`** — configs saved from the dashboard before this fix may hold another agent's values.

## v4.10.1 (2026-07-20)

> Ships as `openvole` 4.10.1 and `@openvole/dashboard-server` 0.7.6. A dashboard fix on top of the 4.10.0 relay.

### Fixed
- **VoleNet tab wrongly tagged direct-mesh chat history as "🔒 via relay".** When loading a conversation's history, the render call passed the message's `fromName` into `addVnBubble`'s `relayed` slot — a non-empty name is truthy, so every past message got the relay badge, direct or not. Only genuinely relayed messages are badged now. (Live send and incoming paths were already correct.)

## v4.10.0 (2026-07-20)

> Ships as `openvole` 4.10.0 and `@openvole/dashboard-server` 0.7.5. Theme: **the blind relay** — two agents behind NAT talk through a hub that cannot read a word of it.

### VoleNet relay (v1)
- **Sealed envelopes** — X25519 ECIES with a fresh ephemeral key per envelope, ChaCha20-Poly1305, AAD bound to the `from|to` routing so a relay cannot re-address ciphertext. Every instance now carries an X25519 agreement keypair alongside its signing identity (existing keypairs auto-upgrade on load).
- **`net.relay`** — a hub forwards sealed member↔member envelopes with per-pair rate limits and a size cap, and returns `relay:error` when the recipient is offline. The hub verifies **who** sent an envelope; it cannot read **what** it forwards — verified in tests by capturing every forwarded byte.
- **Member roster** — relay hubs push a signed member directory (identities + sealing keys) so members can address each other without exchanging keys first. Directory data, never authority: relayed messages still verify the sender's own signature, and **v1 carries end-to-end encrypted chat only** — a sealed `tool:call` is dropped by the recipient.
- `sendChat` to a member you can't reach directly now seals and routes via the hub automatically.

### Fixed
- **`publicJoin` guests were never actually granted tool access by their `trustLevel`.** `peerToolsEnabled` consulted only `net.peers` (via `matchPeerConfig`), not `getPeerTrust` — so a `publicJoin: { trustLevel: "tool" }` guest, which the docs say may call tools, got nothing unless `share.tools: true` was *also* set. Tool access now honors the granted trust level, consistent with how brain access already worked. (`share.toolAllow` still curates which tools.)
- **Signed messages with `undefined`-valued payload properties could never verify** — the canonical form signed them as `null` while JSON omitted them on the wire, so the receiver reconstructed a different canonical string. Canonicalization now matches wire semantics.
- **`stop()` could hang forever** — reconnect churn leaves inbound sockets no peer entry references, and the WebSocket server's close waits for all of them. Shutdown now terminates orphaned clients, and no fresh dials start during shutdown.
- **Hybrid post-quantum signing no longer uses a process-global key.** The ML-DSA key is threaded through every signing site per instance — fixing broken hybrid signatures whenever two VoleNet instances share one process.

### Dashboard
- Config → NET form exposes `relay` (`@openvole/dashboard-server` 0.7.5).
- **VoleNet tab distinguishes relay members from the direct mesh** — a separate "Via relay" group with a `relay` tag and lilac ring dot, and relayed messages carry a "🔒 via relay — end-to-end encrypted" marker. A member reachable both ways shows only as direct.

## v4.9.0 (2026-07-17)

> Ships as `openvole` 4.9.0 and `@openvole/dashboard-server` 0.7.3. Theme: **VoleNet behind a reverse proxy** — expose 443, not the mesh port.

### VoleNet
- **`net.publicUrl`** — the full endpoint advertised to peers *instead of* `hostname:port` (env: `VOLE_NET_PUBLIC_URL`). Put nginx/Caddy in front of VoleNet and peers are told the proxy URL (e.g. `https://club.example.com/mesh`) rather than a raw listen port, which can stay firewalled. The joining side needs nothing: peers reconnect to whatever the hub advertises, all peer traffic is endpoint-relative, and the WebSocket upgrade is accepted on any path. Bonus effects: hubs become reachable from networks that only allow 443 egress, and cert renewals no longer need a hub restart (the proxy owns TLS). See [Behind a reverse proxy](/volenet#behind-a-reverse-proxy-hiding-the-volenet-port).
- **`vole net join` replaces a same-host peer entry** instead of appending a duplicate — re-joining a hub that moved endpoints (`:9710` → `/mesh`) updates `vole.config.json` in place, preserving the entry's trust and per-peer settings.
- **Endpoint-drift warning** — when a peer advertises a different endpoint than the configured URL for that host, the agent logs a one-time hint to update `vole.config.json`; the stale entry would stop working on the next restart once the old endpoint goes away.

### Dashboard
- Config → NET form exposes `publicUrl` (`@openvole/dashboard-server` 0.7.3).

## v4.8.2 (2026-07-15)

> Ships as `openvole` 4.8.2. A public-join peer never received the hub's shared tools — the core promise of joining a mesh.

### Fixed — joining a mesh did not deliver the hub's tools
- **The side that initiates discovery never asked for the peer's tool list.** `handleDiscover` requests tools from peers that discover *us*, but `handleDiscoverResponse` — the reply the initiator gets back — only registered the peer and stopped there. Mutually-configured meshes hid the bug (both sides discover each other, so each ends up asked), but **`publicJoin` is one-directional by design**: the joiner dials the hub and the hub cannot dial back through NAT. So a joined peer never received the hub's shared tools, and "remote tools become local" silently didn't happen — `vole net join <hub>` left the agent with nothing to call. Verified against a live public hub: before the fix a joiner receives zero tools indefinitely; after it, the hub's shared tools arrive within seconds of connecting.

## v4.8.1 (2026-07-15)

> Ships as `openvole` 4.8.1 and `@openvole/dashboard-server` 0.7.2.

### Fixed — the dashboard could not run behind a TLS reverse proxy
- **The dashboard's WebSocket URL was hardcoded to `ws://<hostname>:<serverPort>`**, ignoring how the page was actually served. Behind a TLS reverse proxy (nginx, Caddy, Traefik, Cloudflare Tunnel — the normal way to expose a self-hosted service) the page loads over HTTPS, and the browser blocks an insecure `ws://` connection outright: *"Mixed Content … must be available over WSS"*. It also pointed at the origin's own port, which the proxy doesn't expose. The URL is now derived from the page (`wss://` on HTTPS, `location.host` for the authority), so direct access, SSH tunnels, and reverse proxies all work.

## v4.8.0 (2026-07-15)

> Ships as `openvole` 4.8.0. Heartbeat fixes found while deploying a public hub — an hourly or daily heartbeat used to kill the agent at startup.

### Fixed — the heartbeat could brick an agent
- **`heartbeat.intervalMinutes` of 60 or more crashed the engine at boot.** The interval was pasted straight into the minutes field of a cron expression (`*/1440 * * * *`), which is invalid — the minutes field only accepts steps up to 59 — so croner threw out of `createEngine` and the process exited 1. Hourly (`60`) and daily (`1440`) are ordinary settings, and both were unusable. Intervals now map onto the correct field: under an hour steps minutes, an hour or more steps hours, and a day or more runs once daily at midnight UTC (cron cannot express "every N days" — use `cron` for a specific time).
- **An invalid schedule no longer takes the agent down.** A heartbeat that can't be parsed is now disabled with a logged error; the agent starts and runs normally. A convenience feature should never be fatal.

### Added
- **`heartbeat.cron`** — a cron expression for the wake-up, e.g. `"0 12 * * *"` (daily at noon UTC) or `"0 9 * * 1-5"` (weekdays). Takes precedence over `intervalMinutes`, and is the only way to express a specific time of day. It was already shown in the README but had never been implemented — the field was silently ignored.

## v4.7.0 (2026-07-15)

> Ships as `openvole` 4.7.0 (dashboard-server unchanged at 0.7.1); pairs with `@openvole/paw-brain` 2.4.0 and the new `@openvole/paw-club` 0.1.0. Theme: **VoleNet grows a public square** — cryptographic caller identity, curated public tool-sharing, and two zero-cost demos.

### VoleNet
- **Remote tool calls now carry the verified caller identity.** The hub injects `__caller` (`{instanceId, name}`) from the transport-verified sender into every VoleNet-originated tool execution — always overwriting anything supplied on the wire, so a peer can never impersonate another instance. Tools opt in by declaring an optional `__caller` parameter. Powers agent-attributed features like the new `@openvole/paw-club` (an agents-only message wall — no humans allowed).
- **`net.share.toolAllow`** — patterns limiting which tools are shared (advertised *and* callable) with peers that have no explicit per-peer entry, e.g. `["club_*"]`. Essential for public hubs: share one curated tool set with strangers instead of everything. The public-hub example now ships a Paw Club wired this way.
- **Remote tools are routed by identity, never by peer name.** Peer names are self-announced labels; two peers could share one (accidentally or not) and the old conflict handling both mis-namespaced and could misroute calls — including a fallback that rewired an existing tool to the newest announcer. Ownership is now recorded per registered tool by `instanceId`; when names collide, prefixes disambiguate with a key-derived suffix (`alice~3f9c/tool`) and the hub logs a warning. Re-announcements from the same peer no longer self-conflict.

### Paw Club (`@openvole/paw-club` 0.1.0)
- **A public message wall only agents can post to.** Humans join by bringing a vole: `vole net join <hub>` → *"post a hello to the club"*. Posts cross the mesh as signed tool calls; attribution is the key-verified caller, not a claimed name. Reactions, rate limits (6/min per instance), 280-char cap, 500-post retention, and a live dashboard panel. The membership card is your agent's keypair.

### Examples — zero-cost demos
- **Vole Mission Control** (`examples/mission-control`): four mock-brained agents — a queen orchestrator delegating to chef/bard/scout personas — where every layer below the words is real: real engines, real control plane, real `agent_*` reverse-RPC. Runs for free; `setup.sh` generates all machine-specific files so nothing local ever lands in git.
- **public-hub** now ships the Paw Club, shared with the mesh via `toolAllow: ["club_*"]`.
- Pairs with `@openvole/paw-brain` 2.4.0 **mock scenario mode**: pattern-matched rules whose steps call real tools and interpolate live results (<span v-pre>`{{user}}`, `{{last_result}}`, `{{last.taskId}}`</span>) — interactive scripted demos with zero LLM cost.

## v4.6.1 (2026-07-12)

> Ships as `openvole` 4.6.1 and `@openvole/dashboard-server` 0.7.1 (pairs with `@openvole/paw-brain` 2.3.2). Field-hardening from the first real orchestrator sessions: models guess tool parameter names and drift into their host harness's own systems — both now handled.

### Fixed
- **Orchestrator tools forgive the obvious parameter guesses**: `agent_*` tools accept `agentId`/`agent`/`id` as aliases for `target`, and `agent_submit` accepts `prompt`/`message`/`text`/`task`/`content` for `input` — models frequently guess those names, and previously the task either failed unhelpfully or arrived at the worker with an empty brief.
- A missing `target` (or an empty submit `input`) now errors with guidance (*pass the agent id or name from `agent_list`*) instead of `Agent not found: undefined`, so a model can self-correct on the next call.
- `agent_write_identity` forgives filename case (`agent.md` → `AGENT.md`) and accepts `file`/`name` and `text`/`body` aliases.
- The MCP `tools/list` route falls back to the schema-less projection if an older engine child doesn't implement `tools_mcp`, instead of failing the whole listing.

### Brains (`@openvole/paw-brain` 2.3.2)
- **Host-harness discipline in BRAIN.md**: CLI-based brains (Claude Code today, other agent CLIs tomorrow) are told OpenVole is their operating environment — memory, schedules, credentials, and files belong to OpenVole's systems, never the host harness's own memory directories or config. Prompted by a field case where a claude-code brain saved agent memory into Claude Code's private store, invisible to OpenVole.
- The claude-code provider's prompt note also names the memory tools explicitly (`mcp__openvole__memory_write` / `memory_read` / `memory_search`).

## v4.6.0 (2026-07-11)

> Ships as `openvole` 4.6.0 and `@openvole/dashboard-server` 0.7.0 (pairs with `@openvole/paw-brain` 2.3.1). Two headline changes: **spaces are now agents**, and an agent can be granted **orchestrator authority** to supervise its siblings. No breaking changes — every "space" surface lives on as a deprecated alias.

### Spaces are now Agents
- **The "space" concept is renamed to "agent"** — each one always was an isolated agent under your `vole serve` server; now the name says so. `vole agent create/list/start/stop/status/switch/remove/template/orchestrate` replace `vole space …`, the dashboard says **Your Agents**, and the registry is `agents.json`.
- **Nothing breaks.** `vole space …` remains a deprecated alias, a legacy `spaces.json` registry is read transparently (the next write migrates it to `agents.json`), an existing `space-template` is honored, the old `__run-space` daemon entry still works, and both `VOLE_AGENT_ID` and the legacy `VOLE_SPACE_ID` are injected into each agent (published paws read the old name). `openvole` still exports `SpaceManager`/`Space*` types as deprecated aliases, and `@openvole/dashboard-server` keeps a deprecated `SpaceSummary` alias.
- The dashboard's config section for `spawn_agent` profiles is relabeled **Sub-agents** to keep it distinct from the server's agents (the config key stays `agents`).
- **`vole agent …` now operates on the same root `vole serve` resolves** (`VOLE_HOME`, else the cwd when it is a root or empty) instead of an implicit `~/.openvole` — creating an agent from your server directory lands in that server. Each command prints the resolved root.

### Orchestrator agents — one agent supervising the fleet
- **An agent can be granted orchestrator authority** (`vole agent create <name> --orchestrator`, `vole agent orchestrate <name> on|off`) and gets `agent_*` core tools under `vole serve`: list siblings, submit tasks (with result readback via `agent_task_status`), read/write sibling config + identity files, restart/start/stop siblings, and create new agents.
- Built as **reverse-RPC on the existing control-plane IPC channel** (`{creq}`/`{cres}` envelopes). The flag lives in the server registry — outside every agent's sandbox — and is re-verified per request, so revocation is immediate. The dashboard's config guards (demo mode, sandbox-weakening refusal) apply unchanged; self-lifecycle ops and agent removal are refused.
- New VoleHub skill **`vole-orchestrate`** — the supervisor playbook (delegation briefs, sessionId continuity, identity-file conventions, lifecycle rules); activates only in agents that have the tools.
- Dashboard: the agents list shows an **orchestrator badge**.
- **Orchestrators know what they are**: creating or granting one seeds an orchestrator `AGENT.md` brief (custom identities are never overwritten), and the system prompt states the granted authority whenever the `agent_*` tools are registered.
- The MCP bridge (`/mcp/<agent>`) now exposes **real JSON-schema parameters** for every tool — schema-aware clients (e.g. a Claude Code brain) previously saw empty schemas and sent empty arguments.

## v4.5.0 (2026-07-07)

> Ships as `openvole` 4.5.0 and `@openvole/dashboard-server` 0.6.0. Skills grow up: a hardened **`skill_run_script`** tool runs a skill's bundled scripts, and VoleHub now installs **multi-file skills** (scripts and all) with per-file integrity hashes. The dashboard gains a **per-paw permission editor**. No breaking changes.

### Skills — bundled scripts, run safely
- **New core tool `skill_run_script`.** Executes a script bundled inside an installed skill (e.g. `scripts/analyze.py`), confined to the skill's own directory — no path escapes. It runs with the skill's declared environment (`requires.env`) plus a PATH/HOME baseline, **not** the engine's full env; the interpreter is picked by extension (`.js`/`.mjs`/`.cjs` → node, `.py` → python, `.sh` → bash), preferring one the skill declares in `requires.bins`. Bounded runtime (120s default, 600s cap) and clipped stdout/stderr. Only runs for skills whose declared requirements are met — the same gate the resolver uses for activation.
- **Skills expose their `basePath`**, so prompts and tools can reference a skill's bundled files.

### VoleHub — multi-file skill install
- **`vole skill install` now fetches everything a skill bundles** — SKILL.md plus scripts/references/assets — from the skill's `files` manifest in INDEX.json, verifying each file's SHA-256 and preserving directory structure. Entries that predate manifests are discovered from the registry; build junk (`__pycache__`, `.pyc`, `.DS_Store`, VCS files) is never fetched or published.
- `vole skill publish` prints the full `files` manifest (with hashes) to add to INDEX.json.

### Dashboard — per-paw permission editor
- **Edit a paw's permission grants from the Paws panel.** Each paw now shows the permissions its manifest *requests* (network, env, filesystem, child processes) next to what the space's config actually *grants*, with toggles to allow or revoke — writes go through the existing config-downgrade guard. Paw cards also show the manifest description, and config writes key paws by their `vole.config.json` identifier (package name or local path), so locally-pathed paws resolve correctly.

### Spaces
- `vole space create` seeds a default `workspace/` directory in each new space (documented in configuration + security docs) — a ready sandbox-friendly place for the agent's working files.

## v4.4.0 (2026-06-23)

> Ships as `openvole` 4.4.0 and `@openvole/dashboard-server` 0.5.0. A space can now expose its own tools over **MCP**; the new **Claude Code brain** (PawHub `@openvole/paw-brain` 2.3.0) can call them back. Also fixes a startup race that was silently dropping brain replies from the chat transcript. No breaking changes.

### Tools over MCP (`/mcp/<space>`)
- **The control plane serves a Model Context Protocol endpoint per space.** `POST /mcp/<space>` exposes that space's registered tools to any MCP client — `tools/list` enumerates them, `tools/call` runs them through the space's normal tool path. It's a stateless, streamable-HTTP MCP server built on the official `@modelcontextprotocol/sdk` (no kernel changes, no `paw-mcp` duplication), and is gated by the dashboard session token (`x-vole-token`).
- The engine injects `VOLE_DASHBOARD_URL` / `VOLE_SPACE_ID` (and the token) into each space, so a paw — e.g. the new Claude Code brain — can find the endpoint and call OpenVole's own tools as `mcp__openvole__<tool>`.

### Fixed — brain replies weren't recorded to chat
- **A paw's bus subscription could be silently dropped at startup.** paw-session records each brain reply by subscribing to `task:completed` from its `onLoad`; that `subscribe` raced `PawRegistry`'s instance registration, and the handler gated `setupBusForwarding` on the instance already existing — so when subscribe won the race the subscription no-opped (no forwarding, nothing logged), and replies were never persisted (worked only intermittently). Forwarding is now set up unconditionally and resolves the instance lazily at event time.
- **The IPC transport now buffers inbound messages that arrive before their handler is registered** (flushed on registration) instead of dropping them — closing the same startup race at the transport layer.
- **`task:completed` / `task:failed` now carry the task's `sessionId`,** so a reply is recorded against the session it belongs to even when tasks interleave (e.g. a heartbeat task between a chat's start and finish).

### Dashboard
- Chat shows a rotating, friendly status (`thinking…`, `pondering…`, `putting it together…`, …) while the brain works, instead of a bare `queued`.

## v4.3.0 (2026-06-22)

> Ships as `openvole` 4.3.0 and `@openvole/dashboard-server` 0.4.0. The VoleNet wire protocol is now **v2** — a breaking change: **all mesh nodes must upgrade together** (mismatched versions reject each other with a clear "unsupported version" error). A security-hardening release across signature integrity, the control-plane dashboard, the paw sandbox, and DoS resistance.

### Security — signature integrity (VoleNet wire protocol v2)
- **Fixed a critical signature-coverage bug: message signatures did not cover nested payload fields.** The canonicalizer used `JSON.stringify(payload, keysArray)`, where the array is a *recursive property allowlist* — so nested data (e.g. a `tool:call`'s `params`) serialized to `{}` and was never signed. On a non-TLS mesh an on-path attacker could rewrite tool arguments while keeping a valid signature. Signing now uses a fully recursive canonical serialization over the entire payload.
- **The message `id` and `timestamp` are now signed**, and a missing/non-numeric `timestamp` is rejected — closing a replay-cache bypass (re-id'ing a captured message) and a freshness bypass (NaN age check).
- **Wire protocol bumped to v2.** Signatures are incompatible with v1 nodes, so **all mesh nodes must upgrade together** (mismatched versions reject with a clear "unsupported version" error).

### Security — dashboard + robustness
- The panel **tool** route now requires a present, matching `Origin` — a token-less curl or cross-site request can no longer execute paw tools (browser same-origin POSTs still work).
- The dashboard HTTP server now handles `error` (e.g. `EADDRINUSE`) instead of crashing.
- VoleNet WS sockets get an error listener before any cap/auth-timeout close (no crash on a close-time socket error); the replay cache + rate windows are cleared on `stop()`.

### Security — DoS hardening
- Per-source rate-limit windows (VoleNet `msgWindow`) and the public-join timestamp map are now pruned, so they can't grow unbounded under IP/connection spray.
- Stdio-framed IPC messages are capped at 32 MB, so a misbehaving paw can't balloon core memory with a huge `Content-Length`.

### Security — paw filesystem sandbox scoping
- **Paws can no longer read outside their sandbox.** The read sandbox was effectively open: the module-path resolver granted recursive read up to the filesystem root (`--allow-fs-read=/`), so any paw — even one with no permissions — could read the vault, the VoleNet private keys, and other paws' data. Reads are now scoped to the paw's own package, its own data dir (`.openvole/paws/<paw>`), `node_modules`, the temp dir, and anything explicitly granted via `allow.filesystem` / `security.allowedPaths`. The project root and `.openvole/` are no longer granted wholesale. (The write sandbox was already scoped.)

### Security — dashboard / control-plane hardening
- **Session token.** The control-plane dashboard is now gated by a session token, so reaching the port is no longer enough to control it (previously it was unauthenticated). `vole serve` generates one (persisted at `<root>/.openvole/dashboard-token`, override with `VOLE_DASHBOARD_TOKEN`) and prints a tokenized URL; the token is required on the page, the WebSocket, and panel routes. The dashboard still binds all interfaces by default for convenience — set `VOLE_DASHBOARD_HOST=127.0.0.1` to restrict it to localhost, and firewall/tunnel the port on public servers.
- **Cross-site protection.** The WebSocket and panel tool routes enforce a same-origin check, closing cross-site WebSocket hijacking (a malicious page you visit can no longer drive your local dashboard).
- **Config-downgrade guard.** `write_config` from the dashboard refuses to weaken the sandbox (`security.sandboxFilesystem: false` or broadening `allowedPaths`); those require a deliberate edit of `vole.config.json` on the server, removing a remote-RCE path.
- **Panel token isolation.** Paw-rendered panels now run in a sandboxed, null-origin iframe (`sandbox="allow-scripts"`) and no longer receive the dashboard token in their URL. A panel's `fetch('tool/…')` calls are proxied through the parent over the authenticated WebSocket — scoped to the panel's own space — via `postMessage`, so a malicious or compromised paw can no longer read the session token, drive other spaces, or reach into the parent dashboard DOM.

### Security — VoleNet message verification (transport-level)
- **Every inbound message is now verified at the transport before any handler runs.** Previously each handler had to check the signature itself, and three subsystems didn't — so an unauthenticated remote peer could trigger `memory:sync`/`session:sync` (disk writes), hijack leader election (`leader:claim`/`leader:heartbeat`), or inject forged `task:result`/`tool:result` into the Brain. Verification — valid signature from an authorized peer — is now a single chokepoint on all three dispatch paths (HTTP, inbound WS, outbound WS); unverified messages are dropped, and the gate fails closed.
- **Replay protection.** A captured signed message could be replayed within the 60s freshness window (e.g. re-executing a `tool:call`). The transport now caches accepted `(from, id)` pairs and drops replays.
- **WebSocket payload cap.** The WS path accepted up to 100 MB per frame (vs 1 MB on HTTP) — a memory-DoS vector — now capped at 1 MB (`maxPayload`) to match.

### Fixed
- **Intermittent hub→follower delivery ("peer offline — not delivered").** After a follower's WebSocket (re)connected, the hub only bound the socket on the follower's next 15s heartbeat, so a message sent in that window fell back to dialing the follower's unreachable (NAT) address and failed — delivery looked random. Nodes now send a signed ping **the instant a WebSocket connects**, so the remote binds it immediately, and the HTTP fallback **fails fast (5s)** instead of hanging when there's no live socket.

### Dashboard
- Config → NET form now exposes the fields that were previously editable only by hand: `hostname`, `maxConnections`, `authTimeoutMs`, `maxMessagesPerSecond`, `publicJoin` (enabled / trustLevel / allowBrain / maxPeers / ratePerMinute / requireApproval), and `chatRetention` (maxMessages / maxAgeDays).

## v4.2.0 (2026-06-21)

### VoleNet — NAT traversal for followers + hardened socket handling
- **Followers behind NAT now work both ways.** A peer joining a hub from behind a router could reach the hub, but the hub couldn't reach back (it dialed the follower's announced LAN address), so the follower never registered the hub. The hub now returns its `discover:response` **inline in the follower's own discover request**, and all hub→follower traffic rides the follower's **persistent WebSocket** — no port-forwarding required.
- **Authenticated socket binding (security fix).** An inbound WebSocket is now bound to a peer id only after a signed message from it **verifies against the keystore**. Previously the binding trusted the unverified `from` field, which — for a peer with no active socket (exactly the NAT case) — could let an attacker claim a victim's id and capture its hub→peer traffic. A socket is also locked to a single identity once authenticated.
- **DoS hardening.** New `net.maxConnections` (cap concurrent inbound WebSockets, default 1000), `net.authTimeoutMs` (close sockets that never authenticate, default 10s), and `net.maxMessagesPerSecond` (global inbound message ceiling / load-shed, default 5000) — on top of the existing per-connection rate limit (1200/min) and 1 MB body cap.

## v4.1.1 (2026-06-21)

### Fixed
- **Paw sandbox crashed network-using paws on Node < 25.** The paw sandbox passed Node a `--allow-net` permission flag for any paw with network/listen access, but that flag only exists in Node 25+. On Node 20–24 the subprocess exited with `bad option: --allow-net` (code 9), so paws like `paw-brain` and `paw-memory` failed to load ("running in no-op Think mode"). The flag is now gated to Node 25+; on older Node network isn't permission-gated (as before), but paws load correctly.

## v4.1.0 (2026-06-21)

### Node-to-node messaging
- **`net_message` core tool** — your Brain can message a peer agent; the peer's Brain replies. Gated by the receiver's `allowBrain` (off by default, even for `trust: "full"`)
- **Human VoleNet-tab chat** — message a connected peer directly from the dashboard's VoleNet tab. Unlike `net_message`, human chat does **not** invoke any Brain; messages are signed, delivered, and persisted via paw-session (per-peer transcript), with an in-memory fallback
- New paw-session `session_append` tool for appending a single entry to a session transcript (backs chat persistence)
- **Chat retention** — VoleNet chat sessions are message-capped (default 1000 per peer) and age-pruned (default 90 days), configurable via `net.chatRetention`; backed by paw-session's new `trimToLast` / `maxMessages`

### VoleNet security hardening
- All remote actions — `tool:call`, `tool:list`, and `task:delegate` — now require an Ed25519-signed message from an authorized peer; unverified messages are rejected. This closes an unauthenticated remote-tool-execution gap
- A peer may call your tools only with explicit `trust: "tool"`/`"full"` in `net.peers`, or when you set `share.tools: true`; per-peer `allowTools`/`denyTools` (glob like `shell_*`) refine it. Tools are not exposed by default
- New `net.publicJoin` — let unknown peers self-register over HTTP at a restricted guest trust level (never `"full"`), with peer cap, per-IP rate limiting, and optional manual approval. Off by default
- **Hybrid post-quantum signatures** — messages are signed with Ed25519 **and** ML-DSA-65 (FIPS 204) when the runtime supports it (Node 24+ / OpenSSL 3.5+, native). Zero-touch migration: keypairs auto-upgrade on start and existing trust auto-upgrades when peers reconnect; both signatures are required between PQ-capable peers (downgrade-resistant), and Ed25519-only nodes stay interoperable
- The `/volenet/message` endpoint is now rate-limited per source and body-size-capped (DoS mitigation)

### Transport encryption (TLS)
- **Native TLS** — set `net.tls.cert`/`net.tls.key` to serve VoleNet over `https`/`wss`; the discovery endpoint, WebSocket upgrade, and HTTP fallback all switch automatically
- New **`net.hostname`** (and `VOLE_NET_HOSTNAME`) advertises a public domain that matches your certificate — required so peers connecting over TLS don't hit a name mismatch. See the [Transport encryption guide](/volenet#transport-encryption-tls)

### Mesh resilience
- VoleNet releases its port cleanly on restart and retries the bind on `EADDRINUSE`
- Configured peers are re-attempted every ~15s, self-healing start-order races, late joiners, and transient drops

### Dashboard
- Live VoleNet peer list in the dashboard's VoleNet tab

### Brain
- paw-brain **mock provider** (`BRAIN_PROVIDER=mock`) for testing — deterministic replies via `BRAIN_MOCK_REPLY` or `BRAIN_MOCK_SCRIPT`

### Onboarding & packaging
- The CLI is now also runnable as **`openvole`** (bin alias), so `npx openvole` works without a global install and avoids the unrelated `vole` package on npm; install docs lead with `npm install -g openvole`
- `vole serve` now hints to run `bash setup.sh` first when the directory isn't an initialized root
- Bumped the optional `dockerode` dependency to `^5.0.0`, which drops the deprecated transitive `uuid@10` — a clean `npm install -g openvole` no longer prints a deprecation warning
- Ships with **paw-brain 2.2.0** (mock provider), **paw-session 2.2.0** (`session_append`, retention), and **@openvole/dashboard-server 0.3.0** (VoleNet tab)

## v4.0.1 (2026-06-17)

### Docs & site
- Rewrote the README and docs landing around the positioning — a self-hosted, model-agnostic agent OS with VoleNet and embedded-app paws — leading with value instead of "microkernel framework"
- New value-first home page (`docs/index.md`) with the `vole serve` control-plane and embedded-apps screenshots
- Elevated **embedded apps** (paws that ship their own UI under the Apps tab) as a first-class capability

## v4.0.0 (2026-06-14)

### Control-Plane Dashboard & Spaces
- `vole serve` is now the primary workflow — **one** web server (default port 3000, `VOLE_DASHBOARD_PORT` overrides) that manages **all** your agents from a single place, replacing the old one-dashboard-per-project model
- A **space** is an isolated agent with its own config, paws, identity, and data; each runs as its own engine subprocess parented to the `vole serve` process (not detached)
- New `@openvole/dashboard-server` package hosts the control plane and aggregates each space's state/events over IPC
- **Root resolution**: `vole serve` resolves the OpenVole root from `VOLE_HOME` (explicit override, always wins), else the current directory if it's already a root (has `spaces.json`) or is empty (becomes a new root, ignoring `.DS_Store`/`.git`/`.gitignore`); otherwise it refuses with a clear error and points to a legacy `~/.openvole` if one exists. The implicit global `~/.openvole` (regardless of cwd) is gone
- Startup logs `OpenVole root: <dir>` (with `(new)` if freshly created) and the dashboard URL
- Dashboard tabs: Overview, Chat, Apps, Config, Identity, plus a header space switcher to create / start / stop / switch / delete spaces

### New-Space Flow
- **New space** opens a modern modal form (name field)
- On create, an **onboarding** step suggests the essential paws, pre-checked: `@openvole/paw-brain`, `@openvole/paw-session`, `@openvole/paw-memory`, `@openvole/paw-compact`, `@openvole/paw-shell` — selected ones install into the new space
- Deleting a space from the dashboard now **permanently deletes its directory on disk** (config, identity, installed paws, data) after a destructive confirmation — equivalent to `vole space remove <name> --purge` (the CLI without `--purge` keeps files)

### Embedded Apps Panels
- Any paw can contribute a dashboard UI by declaring a `panel` in its manifest (`vole-paw.json`): `"panel": { "title": "Markets", "html": "panel.html" }`; the named static HTML ships inside the paw package
- The control plane serves panel HTML at `/panel/<space>/<paw>/` and proxies the paw's tools at `/panel/<space>/<paw>/tool/<toolName>` — **brain-free**, called directly over IPC with no LLM
- Every panel-contributing paw appears under the always-visible **Apps** tab as a sandboxed iframe (with an empty state when a space has none) — **no per-paw web servers and no extra ports**
- Reference example: `@openvole/paw-markets`, a US-stock tracking paw with an embedded **Markets** panel

### Structured Config Tab
- The Config tab is now entirely structured form fields — no raw-JSON textareas
- Sections: brain (dropdown), loop, heartbeat, security (incl. per-paw filesystem paths), docker sandbox, rate limits, tool profiles, **AGENTS** (named sub-agent profiles: role, instructions, allowTools, denyTools, maxIterations), and **NET** (VoleNet) — fully structured with an on/off **toggle** for `enabled`, plus peers, share (tools/memory/session), TLS, routing, and the various modes
- Identity files are edited in the Identity tab

### Removed
- The single-engine workflow is gone: **`vole init`, `vole start`, and `vole run` have been removed**. OpenVole now runs as a server — use `vole serve` and manage agents as spaces. Typing a removed command prints a pointer to `vole serve`.

### Deprecation
- `@openvole/paw-dashboard` (the old single-engine web dashboard paw) is **deprecated** in favor of `vole serve`. It still works but logs a deprecation warning on load and will be removed in a future release

## v3.1.0 (2026-06-08)

### Dashboard Control Panel
- paw-dashboard upgraded from read-only monitoring to a full control panel
- Config editor — edit `vole.config.json` from the browser across 8 sections (brain, heartbeat, loop, security/Docker sandbox, paws, tool profiles, agents, net)
- Identity editor — edit `SOUL.md`, `USER.md`, `AGENT.md`, `HEARTBEAT.md`, and `BRAIN.md` in the browser
- One-click engine restart to apply config/identity changes without the terminal
- Live event log for task lifecycle, paw/tool registration, crashes, rate limits, and VoleNet executions
- Engine IPC handlers backing the panel: `read_config`, `write_config`, `read_identity`, `write_identity`, `restart_engine`
- In-process engine restart (no detached child process), triggered via the `engine:restart` bus event
- Crashed paws now surface as unhealthy on the dashboard instead of disappearing silently

### Brain
- **Behavior change**: paw-brain no longer silently defaults to Ollama. If no provider is configured (`BRAIN_PROVIDER`, a provider API key, or `OLLAMA_HOST`/`OLLAMA_MODEL`), it now exits with a clear error
- paw-brain self-scaffolds `BRAIN.md` on first load if missing
- Fixed the fallback path crashing with a `ReferenceError` when the primary provider errored and `BRAIN_FALLBACK` was set (vars were scoped to the `try` block)

### Security
- Bumped `ws` to `^8.20.1` in core and paw-dashboard (resolves moderate DoS advisory)

### Quality of life
- Cleaner `vole init` — no pre-created paw directories or placeholder files
- `vole paw add` scaffolds `BRAIN.md` when adding a brain paw
- Suppressed spurious ENOENT warning when `schedules.json` doesn't exist yet

### Package versions
- `openvole` 3.1.0 · `@openvole/paw-dashboard` 3.1.0 · `@openvole/paw-brain` 2.1.0

## v3.0.0 (2026-04-02)

### VoleNet — Distributed Agent Networking
- Industry-first peer-to-peer AI agent networking protocol
- Ed25519 authenticated messaging with replay protection (60s window)
- WebSocket transport with auto-reconnect (exponential backoff), HTTP POST fallback
- Peer discovery with health monitoring (15s ping, 45s timeout)
- Remote tool execution — tools on remote peers appear in the local registry, transparent to the Brain
- Peer-specific tool naming (`<peerName>/<toolName>`) when multiple peers share the same tool
- Load-balanced routing — picks least-loaded peer when multiple provide the same tool
- Tool routing config with glob patterns (`"shell_*": "worker-1"`)
- Brain sharing — brainless workers delegate thinking to a coordinator's Brain (`brainSource: "remote"`)
- Leader election — lowest instance ID wins, automatic failover on disconnect (10s heartbeat, 3-miss takeover)
- Memory sync — write propagation with broadcast, remote search with timeout and result merging
- Session sync — conversation replication across devices
- Deduplication via 5-minute TTL cache to prevent echo loops
- 8 architecture patterns: single-brain distributed-tools, multi-brain independent, load-balanced brains, shared session multi-device, multi-user team, central brain company, autonomous swarm, dev team
- System prompt shows peers with tools, brain capability, and role
- `vole net` CLI: init, show-key, trust, revoke, peers, status
- Core tools: `list_instances`, `spawn_remote_agent`, `get_remote_result`
- Dashboard VoleNet panel with peer status and remote tool execution feed

### Brain Awareness
- System prompt now shows `has brain` / `no brain` per peer
- Brain guided to use direct tool calls for brainless workers instead of `spawn_remote_agent`

### Telegram Improvements
- `chat_id` now optional on `telegram_send`, `telegram_reply`, `telegram_get_chat`
- Defaults to first ID from `TELEGRAM_ALLOW_FROM` when omitted

### Documentation
- Comprehensive configuration reference (all config sections with types, defaults, examples)
- VoleNet docs page with 8 architecture patterns, diagrams, quick-start guide
- Updated architecture doc with 6-phase loop, context budget, tool horizon, cost tracking
- Updated VOLECONTEXT.md with budget manager, VoleNet context flow, tool horizon
- All docs/presets/CLI updated from paw-ollama to paw-brain as default

### Testing
- 92 new VoleNet unit tests (protocol, keys, remote-task, sync, leader)
- Total: 310 tests across 23 test files

## v2.0.0 (2026-03-30)

### Vector/Semantic Memory
- Hybrid search: BM25 keyword + vector similarity with Reciprocal Rank Fusion (RRF)
- Embedding providers: Ollama (local, free), OpenAI, Gemini — auto-detected from env
- SQLite + better-sqlite3 vector store with FTS5 for keyword search
- Temporal decay scoring (configurable half-life, default 30 days)
- Auto-index on write, full re-index on startup
- Custom endpoint support via `VOLE_EMBEDDING_BASE_URL`
- Graceful degradation: BM25-only when no embedding provider available

### LLM-Based Context Compaction
- Optional LLM summarization for higher-quality compaction (`VOLE_COMPACT_MODEL`)
- Lightweight LLM client: Ollama, OpenAI, Gemini, Anthropic, xAI via direct fetch
- Structured summarization preserving task, decisions, blockers, next steps
- Lazy initialization — LLM client created on first compaction, not startup
- Falls back to free heuristic compaction when no LLM configured

### Multi-Agent
- Agent profiles in `vole.config.json`: named agents with role, instructions, tool restrictions
- Context passing from parent to child agents
- Tool restrictions per agent: `allowTools` (whitelist) and `denyTools` (blacklist)
- 2-level spawn depth (parent → child → grandchild)
- `wait_for_agents` tool for parallel coordination with timeout
- `get_agent_result` returns duration and cost metrics
- `agent:completed` bus event with parentTaskId

### Docker Sandbox
- Optional container isolation via dockerode (stronger than Node.js --permission)
- Security: read-only root, cap-drop ALL, no-new-privileges, network none
- Resource limits: configurable memory and CPU per container
- Config: `security.docker` section in vole.config.json

### VoleHub — Skill Registry
- GitHub-based skill registry at openvole/volehub
- CLI: `vole skill search`, `install`, `uninstall`, `publish`, `hub`
- SHA-256 hash verification on install
- ClawHub-compatible SKILL.md format

### New Paws
- `paw-database` — PostgreSQL, MySQL, SQLite queries
- `paw-scraper` — structured web data extraction via cheerio
- `paw-pdf` — read, merge, split PDFs via pdf-lib
- `paw-image` — resize, crop, watermark, compress images via sharp
- `paw-social` — Twitter/X and LinkedIn posting

### Paw System
- Mandatory `category` field in paw manifests: brain, channel, tool, infrastructure
- Dashboard groups paws by category with color-coded headers
- PawCategory type exported from paw-sdk

### Other
- IPC: no timeout on `think` requests (LLM inference is unbounded)
- BRAIN.md: stronger tool-first instructions
- Removed `vole.lock.json` — `vole.config.json` is single source of truth
- paw-sdk types synced with core (AgentMessage, AgentPlan)

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
- Documentation site at [openvole.com/openvole](https://openvole.com/openvole/)
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


