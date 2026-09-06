import {
	readConfigFile,
	readIdentityFiles,
	writeConfigFile,
	writeIdentityFile,
} from '../config/index.js'
import { createAgentContext } from '../context/types.js'
import type { BusEvents } from '../core/bus.js'
import { MAX_AGENT_HOPS, agentSessionId, hopsOf, replyAddressFor } from '../core/reply-address.js'
import type { VoleEngine } from '../index.js'
import type { ToolContext } from '../tool/types.js'

/** Bus events forwarded to the control plane (mirrors the dashboard's subscriptions). */
const FORWARDED_EVENTS: Array<keyof BusEvents> = [
	'tool:registered',
	'tool:unregistered',
	'paw:registered',
	'paw:unregistered',
	'paw:crashed',
	'task:queued',
	'task:started',
	'task:completed',
	'task:failed',
	'task:cancelled',
	'rate:limited',
	'volenet:tool:executed',
	'volenet:chat',
	'volenet:chat:queued',
	'volenet:chat:flushed',
	'volenet:chat:pending',
	'volenet:relay:request',
	'volenet:relay:accepted',
	'volenet:relay:denied',
	'volenet:relay:error',
	'volenet:file:offer',
	'volenet:file:progress',
	'volenet:file:received',
	'volenet:file:sent',
	'volenet:file:failed',
	'volenet:file:rejected',
	'volenet:pair:request',
	'channel:message',
]

/**
 * The run a tool called over MCP belongs to — when that can be known without guessing.
 *
 * A brain that exposes tools to a CLI (`CLAUDE_CODE_EXPOSE_TOOLS=1`) does not call them through
 * the loop; it calls the agent's MCP endpoint, which is stateless and reaches `execute()` with no
 * context at all. Everything the context carries was therefore silently absent for those agents:
 * a message never knew who was waiting, so its answer could not be relayed, and **the hop count
 * reset to zero on every message**, so the guard against two agents talking forever never once
 * engaged. Nothing failed; the features simply did nothing.
 *
 * Resolved from the running task, and only when there is exactly one. With `taskConcurrency` above
 * one, a stateless call cannot say which run it came from, and answering with "whichever started
 * last" is the ambient-state mistake that filed replies under the wrong chat. Better to carry no
 * context than the wrong run's.
 */
export function mcpToolContext(engine: VoleEngine): ToolContext | undefined {
	const running = engine.taskQueue.getRunning()
	if (running.length !== 1) return undefined
	const task = running[0]
	const meta = (task.metadata ?? {}) as { relayTo?: unknown }
	return {
		replyTo: replyAddressFor(task),
		hops: hopsOf(task),
		relayTo: typeof meta.relayTo === 'string' ? meta.relayTo : undefined,
	}
}

/** Aggregate engine state for the dashboard (shape matches PawRegistry.handleQuery). */
function gatherState(engine: VoleEngine): Record<string, unknown> {
	return {
		tools: engine.toolRegistry.list().map((t) => ({
			name: t.name,
			description: t.description,
			pawName: t.pawName,
			inProcess: t.inProcess,
		})),
		paws: engine.pawRegistry.list().map((p) => ({
			name: p.name,
			healthy: p.healthy,
			inProcess: p.inProcess,
			transport: p.transport,
			category: p.manifest?.category ?? 'tool',
			toolCount: engine.toolRegistry.toolsForPaw(p.name).length,
			panel: p.manifest?.panel?.title ?? null,
			// Identifier as written in vole.config.json (a package name or a local path). The dashboard
			// matches state to config and sets the brain by this value — p.name is the manifest name,
			// which differs for locally-pathed paws and would not resolve if written back.
			configName: p.config?.name ?? p.name,
			// Permissions the paw's manifest requests — drives the dashboard's per-paw grant editor.
			permissions: p.manifest?.permissions ?? null,
			description: p.manifest?.description ?? '',
		})),
		skills: engine.skillRegistry.list().map((s) => ({
			name: s.name,
			active: s.active,
			missingTools: s.missingTools,
			description: s.definition.description,
		})),
		tasks: engine.taskQueue.list().map((t) => {
			const task = t as unknown as Record<string, unknown>
			return {
				id: t.id,
				source: t.source,
				input: t.input,
				status: t.status,
				createdAt: t.createdAt,
				startedAt: task.startedAt,
				completedAt: task.completedAt,
				priority: task.priority,
				// Lets the dashboard re-attach a chat's "thinking…" bubble to an in-flight
				// task after the user navigates away and back.
				sessionId: task.sessionId,
				metadata: task.metadata
					? { cost: (task.metadata as Record<string, unknown>).cost }
					: undefined,
			}
		}),
		schedules: engine.scheduler.list(),
		volenet: (() => {
			const vn = (globalThis as any).__volenet__
			if (!vn?.isActive?.()) return { enabled: false }
			const leader = vn.getLeader?.()
			return {
				enabled: true,
				instanceId: vn.getKeyPair?.()?.instanceId?.substring(0, 8) ?? 'unknown',
				instanceName: vn.config?.instanceName ?? 'vole',
				isLeader: vn.isLeader?.() ?? false,
				leaderState: leader?.getState?.() ?? null,
				// Full peer id (not truncated) — net_message chat keys per-peer sessions by it.
				peers: (vn.getInstances?.() ?? []).map((i: any) => ({
					id: i.id,
					name: i.name,
					role: i.role,
					capabilities: i.capabilities?.length ?? 0,
					lastSeen: i.lastSeen,
				})),
				remoteTools: vn.getRemoteTools?.()?.length ?? 0,
			}
		})(),
	}
}

function brainPawName(engine: VoleEngine): string | undefined {
	return engine.config.brain
		? engine.pawRegistry.resolveManifestName(engine.config.brain)
		: undefined
}

export interface ControlAdapter {
	/** Point the adapter at a freshly-created engine (after an in-process restart). */
	rebind(engine: VoleEngine): void
}

/**
 * Bridge an agent-engine to its control-plane parent over the Node IPC channel: answers
 * `{id,method,params}` requests via direct engine calls and forwards bus events as
 * `{event,data}` notifications. Only meaningful when spawned with an IPC channel.
 */
export function installControlAdapter(engine: VoleEngine, projectRoot: string): ControlAdapter {
	const send = (msg: unknown): void => {
		process.send?.(msg)
	}

	let current = engine
	let unbindBus: () => void = () => {}

	const bindBus = (eng: VoleEngine): void => {
		unbindBus()
		const offs = FORWARDED_EVENTS.map((event) => {
			const handler = (data: unknown): void => send({ event, data })
			eng.bus.on(event, handler as never)
			return () => eng.bus.off(event, handler as never)
		})

		unbindBus = () => {
			for (const off of offs) off()
		}
	}

	process.on('message', async (msg: unknown) => {
		const req = msg as { id?: number; method?: string; params?: Record<string, unknown> }
		if (req == null || req.id === undefined || !req.method) return
		const { id, method, params = {} } = req
		try {
			let result: unknown
			switch (method) {
				case 'state':
					result = gatherState(current)
					break
				case 'read_config':
					result = await readConfigFile(projectRoot)
					break
				case 'write_config': {
					const onDisk = await readConfigFile(projectRoot)
					if (onDisk.demo === true) {
						throw new Error(
							'This agent is in demo mode — configuration is read-only from the dashboard. Edit vole.config.json on the server to change it.',
						)
					}
					const newCfg = params.config as Record<string, unknown>
					// Refuse to weaken the paw sandbox from the dashboard (an exposure/CSRF RCE vector):
					// disabling the filesystem sandbox or broadening allowedPaths must be a deliberate
					// file edit on the server, not an API call.
					const oldSec = (onDisk.security ?? {}) as Record<string, unknown>
					const newSec = (newCfg.security ?? {}) as Record<string, unknown>
					const oldPaths = Array.isArray(oldSec.allowedPaths) ? oldSec.allowedPaths.length : 0
					const newPaths = Array.isArray(newSec.allowedPaths) ? newSec.allowedPaths.length : 0
					if (
						(newSec.sandboxFilesystem === false && oldSec.sandboxFilesystem !== false) ||
						newPaths > oldPaths
					) {
						throw new Error(
							'Refusing to weaken the sandbox (security.sandboxFilesystem / allowedPaths) from the dashboard. Edit vole.config.json on the server to change it.',
						)
					}
					await writeConfigFile(projectRoot, newCfg)
					result = { ok: true }
					break
				}
				case 'read_identity':
					result = await readIdentityFiles(projectRoot, brainPawName(current))
					break
				case 'write_identity': {
					const onDisk = await readConfigFile(projectRoot)
					if (onDisk.demo === true) {
						throw new Error(
							'This agent is in demo mode — identity files are read-only from the dashboard.',
						)
					}
					result = await writeIdentityFile(
						projectRoot,
						params.filename as string,
						params.content as string,
						brainPawName(current),
					)
					break
				}
				case 'submit': {
					const sessionId = params.sessionId as string | undefined
					// A project chat names its scope in the session id (`project:<id>`), so the run
					// arrives with that project's CONTEXT.md and open tasks already in the prompt.
					// Deriving it here rather than accepting metadata keeps the browser from
					// handing the loop arbitrary metadata — allowTools lives in the same bag.
					const scoped = sessionId?.match(/^project:(.+)$/)
					result = {
						ok: true,
						taskId: current.run(
							params.input as string,
							// Defaults to 'user' — the dashboard chat. The control plane passes 'agent'
							// for an orchestrator's brief so sibling-to-sibling work is not mistaken
							// for a human message (chat badges, tool profiles, memory scoping).
							(params.source as 'user' | 'agent') === 'agent' ? 'agent' : 'user',
							sessionId,
							// `fromAgent` comes from the control plane, which knows the real sender —
							// never from the browser, which would otherwise be able to name anyone
							// and have a stranger's agent answer to it.
							{
								...(scoped ? { projectId: scoped[1] } : {}),
								...(typeof params.fromAgent === 'string' && params.fromAgent
									? { fromAgent: params.fromAgent, hops: Number(params.hops) || 0 }
									: {}),
							},
						),
					}
					break
				}
				/**
				 * Run a queued project task now, without waiting for the heartbeat.
				 *
				 * The metadata is built here from the task itself rather than accepted from the
				 * caller — the dashboard must be able to say *which* task to run, not to hand the
				 * loop arbitrary metadata (allowTools and maxIterations live in the same bag).
				 *
				 * No sessionId: this is work, not conversation, so it never lands in chat or
				 * bumps the unread badge.
				 */
				case 'project_task_run': {
					const projectId = params.projectId as string
					const taskId = params.taskId as string
					const task = await current.projectTasks.get(projectId, taskId)
					if (!task) {
						result = { ok: false, error: `No such task "${taskId}" in project "${projectId}"` }
						break
					}
					const criteria = task.doneCriteria.length
						? `\n\nDone when all of these hold:\n${task.doneCriteria.map((c) => `- ${c}`).join('\n')}`
						: ''
					result = {
						ok: true,
						taskId: current.run(
							`Work on this task now: ${task.goal}${criteria}\n\nIts project context is in your Current Project section. Mark it running with task_update before you start, check the criteria yourself when you believe it is finished, and only then mark it done — if one does not hold, mark it blocked with the reason.`,
							'user',
							undefined,
							{ projectId, projectTaskId: taskId },
						),
					}
					break
				}
				/**
				 * A message from another agent: record it, then wake to read it.
				 *
				 * Waking is the default because a person's chat message already works this way — a
				 * colleague's word should not sit unread just because it arrived over a different
				 * channel. What keeps that from running away is the hop count, not restraint: a
				 * reply is itself a message, so an exchange where every arrival wakes the receiver
				 * would have each side politely answering the answer at one brain call per turn.
				 *
				 * Past the budget the message is still *delivered* — only the waking stops. The last
				 * word lands in the transcript and is read on the next run rather than vanishing.
				 */
				case 'agent_message': {
					const from = String(params.from ?? '').trim()
					const text = String(params.text ?? '').trim()
					if (!from || !text) {
						result = { ok: false, error: 'message needs a sender and text' }
						break
					}
					const hops = Number(params.hops) || 0
					const session = agentSessionId(from)
					const woke = hops < MAX_AGENT_HOPS

					// Record it ONLY when nothing will run, because a run started with this session
					// records its own opening message: paw-session appends the user turn at
					// bootstrap. Doing both wrote every message to the transcript twice — visible
					// immediately in the first real exchange, as each side showing the other's
					// message in duplicate.
					if (!woke) {
						const append = current.toolRegistry.get('session_append')
						if (append) {
							await append
								.execute({ sessionId: session, role: 'user', content: text })
								.catch(() => undefined)
						}
					}

					result = {
						ok: true,
						session,
						delivered: true,
						woke,
						taskId: woke
							? current.run(text, 'agent', session, {
									fromAgent: from,
									hops: hops + 1,
									...(typeof params.relayTo === 'string' && params.relayTo
										? { relayTo: params.relayTo }
										: {}),
								})
							: undefined,
						note: woke
							? undefined
							: `delivered to "${session}" but not woken — ${hops} hops deep, the limit is ${MAX_AGENT_HOPS}. It will be read on the next run.`,
					}
					break
				}
				/**
				 * Record something this agent said into one of its own threads.
				 *
				 * A message is written to the recipient's thread by the run it wakes, but the sender
				 * writes nothing: the call is made from whatever conversation prompted it, so its own
				 * copy of the thread never sees what it asked. The thread then reads as if it opened
				 * with the other side's answer, and the question is nowhere.
				 */
				case 'thread_append': {
					const sessionId = String(params.sessionId ?? '')
					const content = String(params.content ?? '')
					const append = current.toolRegistry.get('session_append')
					if (!sessionId || !content || !append) {
						result = { ok: false, error: 'nothing to record' }
						break
					}
					await append
						.execute({ sessionId, role: String(params.role ?? 'brain'), content })
						.catch(() => undefined)
					// `notify` puts it in front of a person: the same event the chat channel emits,
					// so an open dashboard shows it live and a closed one raises the unread badge.
					// Appending alone is silent, and a silent answer is the bug this exists to fix.
					if (params.notify && current.bus) {
						current.bus.emit('channel:message', {
							channel: 'chat',
							dir: 'out',
							sessionId,
							text: content,
							ts: Date.now(),
							pawName: '__core__',
							stored: true,
						})
					}
					result = { ok: true }
					break
				}
				case 'task_status': {
					// Result readback for orchestrators polling a delegated task (clipped for LLM context).
					const t = current.taskQueue.get(params.taskId as string)
					result = t
						? {
								ok: true,
								taskId: t.id,
								status: t.status,
								result:
									t.result && t.result.length > 8000
										? `${t.result.slice(0, 8000)}… [truncated]`
										: (t.result ?? null),
								error: t.error ?? null,
								createdAt: t.createdAt,
								completedAt: t.completedAt ?? null,
								// Just the hop depth, not the whole metadata bag — that also carries
								// allowTools and the resolved config, which a caller polling a task
								// has no business reading. Without this the reply router reads
								// undefined, resets the count to zero on every hop, and the guard
								// that stops two agents answering each other forever never fires.
								hops: Number((t.metadata as { hops?: number } | undefined)?.hops) || 0,
								relayTo: (t.metadata as { relayTo?: string } | undefined)?.relayTo ?? undefined,
							}
						: { ok: false, error: `Task not found: ${params.taskId}` }
					break
				}
				case 'chat_history': {
					// History comes from paw-session's tool (if loaded) — no file-format coupling.
					const tool = current.toolRegistry.get('session_history')
					result = tool
						? await tool.execute({ sessionId: params.sessionId, maxMessages: 500 })
						: { ok: false, history: '' }
					break
				}
				case 'chat_sessions': {
					const tool = current.toolRegistry.get('session_list')
					result = tool ? await tool.execute({}) : { ok: false, sessions: [] }
					break
				}
				case 'chat_compact': {
					// Summarize the older part of a transcript and put the summary in its place.
					//
					// A long-lived chat costs tokens on every run that loads it, and clearing is the
					// only alternative — which throws away what was decided. This keeps the decisions
					// and drops the transcript around them.
					//
					// Done here rather than orchestrated from the browser because it has to be
					// atomic: a summary written by one call and a clear issued by another can
					// interleave with the agent appending to the same session, and the failure mode
					// is a transcript with the middle missing.
					const history = current.toolRegistry.get('session_history')
					const clear = current.toolRegistry.get('session_clear')
					const append = current.toolRegistry.get('session_append')
					if (!history || !clear || !append) {
						result = { ok: false, error: 'paw-session is not loaded in this agent' }
						break
					}

					const sessionId = params.sessionId as string
					const keepLast = Math.max(0, Number(params.keepLast ?? 6))
					const read = (await history.execute({ sessionId })) as {
						ok: boolean
						history?: Array<{ role: string; content: string }>
					}
					const messages = read.history ?? []

					// Nothing to gain: the tail is the whole transcript.
					if (messages.length <= keepLast + 1) {
						result = { ok: true, compacted: false, messages: messages.length }
						break
					}

					const older = messages.slice(0, messages.length - keepLast)
					const tail = messages.slice(messages.length - keepLast)

					const transcript = older
						.map((m) => `${m.role === 'brain' ? 'Assistant' : m.role}: ${m.content}`)
						.join('\n\n')

					const ctx = createAgentContext(`compact-${Date.now()}`, 1)
					// A purpose-built prompt, not the agent's own: this is a utility call, and the
					// agent's identity and tools have nothing to do with summarizing a transcript.
					;(ctx as unknown as Record<string, unknown>).systemPrompt =
						'You compress conversation transcripts. Rewrite what follows as a compact record of what was decided, agreed, produced, and left open — in the third person, under short headings. Keep names, paths, ids, numbers and outcomes exactly. Drop pleasantries, retries and reasoning that led nowhere. This replaces the transcript, so anything you omit is gone: err towards keeping a fact. Output the summary alone, with no preamble.'
					ctx.messages = [{ role: 'user', content: transcript, timestamp: Date.now() }]

					const plan = await current.pawRegistry.think(ctx)
					const summary = plan?.response?.trim()
					if (!summary) {
						result = { ok: false, error: 'the brain returned no summary — nothing was changed' }
						break
					}

					// Only now is anything destroyed: a failed summary above leaves the chat intact.
					await clear.execute({ sessionId })
					await append.execute({
						sessionId,
						role: 'brain',
						content: `**Summary of ${older.length} earlier messages**\n\n${summary}`,
					})
					for (const m of tail) {
						await append.execute({ sessionId, role: m.role, content: m.content })
					}

					result = {
						ok: true,
						compacted: true,
						summarized: older.length,
						kept: tail.length,
					}
					break
				}
				case 'chat_clear': {
					const tool = current.toolRegistry.get('session_clear')
					result = tool
						? await tool.execute({ sessionId: params.sessionId })
						: { ok: false, error: 'paw-session is not loaded in this agent' }
					break
				}
				case 'volenet_instances': {
					const vn = (globalThis as any).__volenet__
					result = vn?.isActive() ? vn.getInstances() : []
					break
				}
				case 'volenet_relay_members': {
					const vn = (globalThis as any).__volenet__
					result = vn?.isActive() ? vn.getRelayMembers() : []
					break
				}
				case 'volenet_relay_requests': {
					const vn = (globalThis as any).__volenet__
					result = vn?.isActive() ? vn.getRelayRequests() : []
					break
				}
				case 'volenet_relay_connect': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.requestRelayConnect(params.peerId as string, params.note as string)
					break
				}
				case 'volenet_relay_approve': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.approveRelayConnect(params.peerId as string)
					break
				}
				case 'volenet_relay_deny': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.denyRelayConnect(params.peerId as string)
					break
				}
				case 'volenet_relay_revoke': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.revokeRelayConnect(params.peerId as string)
					break
				}
				case 'volenet_chat_history': {
					const vn = (globalThis as any).__volenet__
					const history = vn?.isActive() ? await vn.getChatHistory(params.peerId as string) : []
					result = { ok: true, history }
					break
				}
				case 'volenet_chat_status': {
					// What is waiting on this node for people who are away, and who tried to reach
					// this node while it was away. Neither is ever held by a hub.
					const vn = (globalThis as any).__volenet__
					result = vn?.isActive()
						? { ok: true, outbox: vn.getChatOutbox(), pending: vn.getChatPending() }
						: { ok: true, outbox: [], pending: [] }
					break
				}
				case 'volenet_chat_send': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.sendChat(params.peerId as string, params.text as string)
					break
				}
				case 'volenet_chat_clear': {
					const vn = (globalThis as any).__volenet__
					if (vn?.isActive()) await vn.clearChat(params.peerId as string)
					result = { ok: true }
					break
				}
				case 'volenet_file_send': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.sendFile(
						params.peerId as string,
						params.path as string,
						params.note as string | undefined,
					)
					break
				}
				case 'volenet_file_accept': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.acceptFile(params.transferId as string)
					break
				}
				case 'volenet_file_reject': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.rejectFile(params.transferId as string)
					break
				}
				case 'volenet_file_status': {
					const vn = (globalThis as any).__volenet__
					result = { ok: true, transfers: vn?.isActive() ? vn.listFileTransfers() : [] }
					break
				}
				case 'volenet_pair_requests': {
					const vn = (globalThis as any).__volenet__
					result = { ok: true, requests: vn?.isActive() ? vn.listPairRequests() : [] }
					break
				}
				case 'volenet_pair_accept': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					// Accepting may also grant what the request asked for. Absent, it is trust only,
					// exactly as before — a caller that does not pass a grant changes nothing.
					const grant =
						params.trust || params.allowBrain
							? {
									...(params.trust ? { trust: params.trust as 'full' | 'tool' | 'read' } : {}),
									...(params.allowBrain ? { allowBrain: true } : {}),
								}
							: undefined
					result = await vn.acceptPair(params.ref as string, grant)
					break
				}
				case 'volenet_pair_deny': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.denyPair(params.ref as string)
					break
				}
				case 'volenet_pair_probe': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.probePair(params.url as string)
					break
				}
				case 'volenet_pair_initiate': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.initiatePair(
						params.url as string,
						params.publicKey as string,
						params.note as string | undefined,
					)
					break
				}
				case 'volenet_join_hub': {
					const vn = (globalThis as any).__volenet__
					if (!vn?.isActive()) throw new Error('VoleNet is not active in this agent')
					result = await vn.initiateJoin(params.url as string)
					break
				}
				case 'tools_mcp':
					// Full tool list WITH JSON-schema parameters — the MCP bridge needs real schemas
					// or clients send empty arguments (the state projection has no parameters).
					result = current.toolRegistry.allSummaries()
					break
				case 'panel_html': {
					const html = await current.pawRegistry.getPanelHtml(params.paw as string)
					result = { html }
					break
				}
				case 'tool': {
					const t = current.toolRegistry.get(params.name as string)
					if (!t) {
						result = { error: `tool not found: ${params.name}` }
						break
					}
					const toolParams = (params.params as Record<string, unknown>) ?? {}
					// Validate like the brain loop does (loop.ts executeAction). This path serves MCP
					// clients and dashboard panels, which used to reach execute() unvalidated — that is
					// how a string `args` got through a z.array schema and was spread into characters.
					const schema = t.parameters as { parse?: (v: unknown) => unknown } | undefined
					if (schema && typeof schema.parse === 'function') {
						try {
							schema.parse(toolParams)
						} catch (err) {
							result = {
								error: `invalid params for ${params.name}: ${err instanceof Error ? err.message : err}`,
							}
							break
						}
					}
					result = await t.execute(toolParams, mcpToolContext(current))
					break
				}
				case 'restart':
					current.bus.emit('engine:restart' as never, {} as never)
					result = { ok: true }
					break
				default:
					throw new Error(`Unknown control method: ${method}`)
			}
			send({ id, result })
		} catch (err) {
			send({ id, error: err instanceof Error ? err.message : String(err) })
		}
	})

	bindBus(engine)
	send({ ready: true })
	return {
		rebind: (eng: VoleEngine): void => {
			current = eng
			bindBus(eng)
		},
	}
}
