import type { ChildProcess } from 'node:child_process'
import {
	type AgentSummary,
	type DashboardServer,
	createDashboardServer,
} from '@openvole/dashboard-server'
import { execa } from 'execa'
import { createLogger } from '../core/logger.js'
import { AgentManager } from './manager.js'

const logger = createLogger('control-plane')
const RPC_TIMEOUT_MS = 15_000
const STOP_GRACE_MS = 5000
const STATE_DEBOUNCE_MS = 150
/** Max tasks included in an orchestrator's agent_state summary. */
const ORCH_STATE_TASKS = 10
/** Max chars of a task's input echoed in an orchestrator's agent_state summary. */
const ORCH_INPUT_CLIP = 200

interface Pending {
	resolve: (value: unknown) => void
	reject: (err: Error) => void
	timeout: ReturnType<typeof setTimeout>
}

interface AgentChild {
	proc: ChildProcess
	pending: Map<number, Pending>
	nextId: number
	ready: Promise<void>
	markReady: () => void
}

export interface ControlPlaneOptions {
	/** Absolute path to the running dist/cli.js (the `__run-agent` daemon entry). */
	cliPath: string
	port: number
	home?: string
	/** Interface to bind (default 127.0.0.1 — set 0.0.0.0 to expose, paired with a token). */
	host?: string
	/** Session token required on the dashboard page, WebSocket, and panel routes. */
	token?: string
}

/**
 * The single control-plane web server. Spawns one engine subprocess (IPC child) per
 * running agent, aggregates their state/events, and hosts ONE dashboard for all of them.
 */
export class ControlPlane {
	private readonly manager: AgentManager
	private readonly children = new Map<string, AgentChild>()
	private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
	private readonly cliPath: string
	private readonly port: number
	private readonly host?: string
	private readonly token?: string
	private server: DashboardServer | undefined
	private availablePawsCache:
		| Array<{ name: string; version: string; description: string }>
		| undefined

	constructor(opts: ControlPlaneOptions) {
		this.cliPath = opts.cliPath
		this.port = opts.port
		this.host = opts.host
		this.token = opts.token
		this.manager = new AgentManager(opts.home ? { home: opts.home } : undefined)
	}

	start(): void {
		this.server = createDashboardServer(
			this.port,
			{
				listAgents: () => this.listAgents(),
				startAgent: (id) => this.startAgent(id),
				stopAgent: (id) => this.stopAgent(id),
				createAgent: (name) => this.createAgent(name),
				removeAgent: (id) => this.removeAgent(id),
				fetchState: (id) => this.callAgent(id, 'state'),
				readConfig: (id) => this.callAgent(id, 'read_config'),
				writeConfig: (config, id) => this.callAgent(id, 'write_config', { config }),
				readIdentity: (id) => this.callAgent(id, 'read_identity'),
				writeIdentity: (filename, content, id) =>
					this.callAgent(id, 'write_identity', { filename, content }),
				restartEngine: (id) => this.callAgent(id, 'restart'),
				listAvailablePaws: () => this.listAvailablePaws(),
				installPaw: (name, id) => this.installPawInAgent(id, name),
				submitTask: (input, sessionId, id) => this.callAgent(id, 'submit', { input, sessionId }),
				chatHistory: (sessionId, id) => this.callAgent(id, 'chat_history', { sessionId }),
				chatSessions: (id) => this.callAgent(id, 'chat_sessions'),
				chatClear: (sessionId, id) => this.callAgent(id, 'chat_clear', { sessionId }),
				volenetInstances: (id) => this.callAgent(id, 'volenet_instances'),
				volenetChatHistory: (peerId, id) => this.callAgent(id, 'volenet_chat_history', { peerId }),
				volenetChatSend: (peerId, text, id) =>
					this.callAgent(id, 'volenet_chat_send', { peerId, text }),
				volenetChatClear: (peerId, id) => this.callAgent(id, 'volenet_chat_clear', { peerId }),
				getPanelHtml: (agentId, paw) => this.callAgent(agentId, 'panel_html', { paw }),
				callPawTool: (agentId, name, params) => this.callAgent(agentId, 'tool', { name, params }),
			},
			{ host: this.host, token: this.token },
		)
	}

	async listAgents(): Promise<AgentSummary[]> {
		const reg = await this.manager.readRegistry()
		return reg.agents.map((s) => ({
			id: s.id,
			name: s.name,
			state: this.children.has(s.id) ? 'running' : 'stopped',
			pid: this.children.get(s.id)?.proc.pid,
			orchestrator: s.orchestrator === true,
		}))
	}

	async startAgent(id: string): Promise<{ ok: true }> {
		if (this.children.has(id)) return { ok: true }
		const reg = await this.manager.readRegistry()
		const entry = reg.agents.find((s) => s.id === id || s.name === id)
		if (!entry) throw new Error(`Agent not found: ${id}`)

		const proc = execa('node', [this.cliPath, '__run-agent', entry.path], {
			cwd: entry.path,
			// Tell the engine (and its paws, e.g. a Claude Code brain) where the control plane's
			// MCP endpoint lives, so it can expose this agent's tools back to an MCP client.
			env: {
				...process.env,
				VOLE_DASHBOARD_URL: `http://127.0.0.1:${this.port}`,
				VOLE_AGENT_ID: entry.id,
				// Legacy name — published paws (paw-brain's claude-code provider) still read it.
				VOLE_SPACE_ID: entry.id,
				// Always set explicitly ('1'/'0') so a stray VOLE_ORCHESTRATOR in the serve
				// process's own env can't leak orchestrator tooling into every agent. The
				// authoritative check stays parent-side (registry flag, per request).
				VOLE_ORCHESTRATOR: entry.orchestrator ? '1' : '0',
				...(this.token ? { VOLE_DASHBOARD_TOKEN: this.token } : {}),
			},
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
			reject: false,
			cleanup: true,
		}) as unknown as ChildProcess

		let markReady: () => void = () => {}
		const ready = new Promise<void>((resolve) => {
			markReady = resolve
		})
		setTimeout(markReady, 8000) // fallback if the engine never signals ready
		const child: AgentChild = { proc, pending: new Map(), nextId: 1, ready, markReady }
		this.children.set(entry.id, child)
		proc.on('message', (msg) => this.onChildMessage(entry.id, msg))
		proc.on('exit', () => this.onChildExit(entry.id))
		logger.info(`Started agent "${entry.id}" (pid ${proc.pid})`)
		this.broadcastAgents()
		return { ok: true }
	}

	async stopAgent(id: string): Promise<{ ok: true }> {
		const child = this.children.get(id)
		if (!child) return { ok: true }
		this.children.delete(id)
		for (const p of child.pending.values()) {
			clearTimeout(p.timeout)
			p.reject(new Error('Agent stopped'))
		}
		child.pending.clear()
		const { proc } = child
		proc.kill('SIGTERM')
		setTimeout(() => {
			if (!proc.killed) proc.kill('SIGKILL')
		}, STOP_GRACE_MS)
		this.broadcastAgents()
		return { ok: true }
	}

	async createAgent(name: string): Promise<{ ok: true; id: string; name: string }> {
		const entry = await this.manager.create(name)
		this.broadcastAgents()
		return { ok: true, id: entry.id, name: entry.name }
	}

	async removeAgent(id: string): Promise<{ ok: true }> {
		const proc = this.children.get(id)?.proc
		await this.stopAgent(id)
		// Wait for the engine child to actually exit before deleting its files, so a late
		// shutdown write can't recreate the directory after we remove it.
		if (proc && proc.exitCode == null) {
			await new Promise<void>((resolve) => {
				const t = setTimeout(resolve, STOP_GRACE_MS + 500)
				proc.once('exit', () => {
					clearTimeout(t)
					resolve()
				})
			})
		}
		await this.manager.remove(id, { purge: true })
		this.broadcastAgents()
		return { ok: true }
	}

	/** Official @openvole/paw-* packages from the npm registry (cached for the process). */
	async listAvailablePaws(): Promise<
		Array<{ name: string; version: string; description: string }>
	> {
		if (this.availablePawsCache) return this.availablePawsCache
		const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent('@openvole/paw')}&size=250`
		const res = await fetch(url)
		if (!res.ok) throw new Error(`npm registry returned ${res.status}`)
		const data = (await res.json()) as {
			objects?: Array<{ package?: { name?: string; version?: string; description?: string } }>
		}
		const paws = (data.objects ?? [])
			.map((o) => o.package)
			.filter(
				(p): p is { name: string; version?: string; description?: string } =>
					typeof p?.name === 'string' &&
					p.name.startsWith('@openvole/paw-') &&
					p.name !== '@openvole/paw-sdk',
			)
			.map((p) => ({ name: p.name, version: p.version ?? '', description: p.description ?? '' }))
			.sort((a, b) => a.name.localeCompare(b.name))
		this.availablePawsCache = paws
		return paws
	}

	/** Install a paw from npm into an agent (npm install + register with default permissions). */
	async installPawInAgent(agentId: string | undefined, name: string): Promise<unknown> {
		if (!agentId) throw new Error('No agent selected')
		const reg = await this.manager.readRegistry()
		const entry = reg.agents.find((s) => s.id === agentId || s.name === agentId)
		if (!entry) throw new Error(`Agent not found: ${agentId}`)
		const { installPaw } = await import('../paw/install.js')
		return installPaw(entry.path, name)
	}

	private callAgent(
		id: string | undefined,
		method: string,
		params: Record<string, unknown> = {},
	): Promise<unknown> {
		const child = id ? this.children.get(id) : undefined
		if (!id || !child) {
			return Promise.reject(new Error(id ? `Agent not running: ${id}` : 'No agent selected'))
		}
		const reqId = child.nextId++
		return child.ready.then(
			() =>
				new Promise<unknown>((resolve, reject) => {
					const timeout = setTimeout(() => {
						child.pending.delete(reqId)
						reject(new Error(`Control request timed out: ${method}`))
					}, RPC_TIMEOUT_MS)
					child.pending.set(reqId, { resolve, reject, timeout })
					child.proc.send?.({ id: reqId, method, params })
				}),
		)
	}

	/**
	 * Answer a reverse-RPC request from an orchestrator agent. The sender's authority is
	 * checked against the registry on EVERY request (fresh read), so revoking the flag via
	 * `vole agent orchestrate <name> off` takes effect immediately. Never throws — errors go
	 * back to the sender as `{cres:{id,error}}`. Public (with an injectable reply) for tests.
	 */
	async handleOrchestrateRequest(
		senderId: string,
		req: { id: number; method: string; params?: Record<string, unknown> },
		reply?: (msg: { cres: { id: number; result?: unknown; error?: string } }) => void,
	): Promise<void> {
		const send =
			reply ??
			((msg: { cres: { id: number; result?: unknown; error?: string } }): void => {
				const child = this.children.get(senderId)
				if (!child?.proc.connected) return // sender exited mid-request — nothing to reply to
				try {
					child.proc.send?.(msg)
				} catch {
					/* channel closed between the check and the send */
				}
			})
		try {
			const reg = await this.manager.readRegistry()
			const sender = reg.agents.find((s) => s.id === senderId)
			if (sender?.orchestrator !== true) {
				throw new Error(`Agent "${senderId}" is not an orchestrator`)
			}
			const result = await this.dispatchOrchestrate(senderId, req.method, req.params ?? {})
			send({ cres: { id: req.id, result } })
		} catch (err) {
			send({ cres: { id: req.id, error: err instanceof Error ? err.message : String(err) } })
		}
	}

	/** Execute one orchestrator method. Targets resolve by id OR name; calls use the id. */
	private async dispatchOrchestrate(
		senderId: string,
		method: string,
		params: Record<string, unknown>,
	): Promise<unknown> {
		if (method === 'list') return this.listAgents()
		if (method === 'create') return this.createAgent(params.name as string)

		const t = params.target as string
		const reg = await this.manager.readRegistry()
		const entry = reg.agents.find((s) => s.id === t || s.name === t)
		if (!entry) throw new Error(`Agent not found: ${t}`)
		if (['start', 'stop', 'restart'].includes(method) && entry.id === senderId) {
			throw new Error(`Refusing to ${method} the orchestrator itself`)
		}
		switch (method) {
			case 'state':
				return this.summarizeState(await this.callAgent(entry.id, 'state'))
			case 'task_status':
				return this.callAgent(entry.id, 'task_status', { taskId: params.taskId })
			case 'submit':
				return this.callAgent(entry.id, 'submit', {
					input: params.input,
					sessionId: params.sessionId,
				})
			case 'read_config':
				return this.callAgent(entry.id, 'read_config')
			case 'write_config':
				// The target's adapter guards apply (demo mode, sandbox-weakening refusal).
				return this.callAgent(entry.id, 'write_config', { config: params.config })
			case 'read_identity':
				return this.callAgent(entry.id, 'read_identity')
			case 'write_identity':
				return this.callAgent(entry.id, 'write_identity', {
					filename: params.filename,
					content: params.content,
				})
			case 'restart':
				return this.callAgent(entry.id, 'restart')
			case 'start':
				return this.startAgent(entry.id)
			case 'stop':
				return this.stopAgent(entry.id)
			default:
				// Deliberately no 'remove' — destroying an agent stays a human decision.
				throw new Error(`Unknown orchestrate method: ${method}`)
		}
	}

	/** Trim an agent's full dashboard state down to an LLM-friendly summary. */
	private summarizeState(raw: unknown): Record<string, unknown> {
		const s = (raw ?? {}) as Record<string, unknown>
		const paws = Array.isArray(s.paws) ? (s.paws as Array<Record<string, unknown>>) : []
		const skills = Array.isArray(s.skills) ? (s.skills as Array<Record<string, unknown>>) : []
		const tasks = Array.isArray(s.tasks) ? (s.tasks as Array<Record<string, unknown>>) : []
		const schedules = Array.isArray(s.schedules)
			? (s.schedules as Array<Record<string, unknown>>)
			: []
		const recent = [...tasks]
			.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
			.slice(0, ORCH_STATE_TASKS)
			.map((t) => ({
				id: t.id,
				source: t.source,
				status: t.status,
				input:
					typeof t.input === 'string' && t.input.length > ORCH_INPUT_CLIP
						? `${t.input.slice(0, ORCH_INPUT_CLIP)}…`
						: t.input,
				createdAt: t.createdAt,
				completedAt: t.completedAt ?? null,
			}))
		return {
			toolCount: Array.isArray(s.tools) ? s.tools.length : 0,
			paws: paws.map((p) => ({ name: p.name, healthy: p.healthy })),
			skills: {
				active: skills.filter((k) => k.active).map((k) => k.name),
				inactive: skills
					.filter((k) => !k.active)
					.map((k) => ({ name: k.name, missingTools: k.missingTools })),
			},
			tasks: recent,
			queuedCount: tasks.filter((t) => t.status === 'queued').length,
			runningCount: tasks.filter((t) => t.status === 'running').length,
			schedules: schedules.map((c) => ({ id: c.id, cron: c.cron, nextRun: c.nextRun })),
		}
	}

	private onChildMessage(agentId: string, msg: unknown): void {
		const m = msg as {
			id?: number
			result?: unknown
			error?: string
			event?: string
			data?: unknown
		}
		if (m == null) return
		if ((m as { ready?: boolean }).ready) {
			this.children.get(agentId)?.markReady()
			return
		}
		// Reverse-RPC: an agent asking the control plane to act on its siblings.
		const creq = (m as { creq?: { id: number; method: string; params?: Record<string, unknown> } })
			.creq
		if (creq && typeof creq.id === 'number' && typeof creq.method === 'string') {
			void this.handleOrchestrateRequest(agentId, creq)
			return
		}
		if (m.id !== undefined && (m.result !== undefined || m.error !== undefined)) {
			const child = this.children.get(agentId)
			const pending = child?.pending.get(m.id)
			if (pending && child) {
				child.pending.delete(m.id)
				clearTimeout(pending.timeout)
				if (m.error) pending.reject(new Error(m.error))
				else pending.resolve(m.result)
			}
			return
		}
		if (m.event) {
			this.server?.broadcast('event', m.data, m.event, agentId)
			this.scheduleStateRefresh(agentId)
		}
	}

	private onChildExit(agentId: string): void {
		const child = this.children.get(agentId)
		if (child) {
			for (const p of child.pending.values()) {
				clearTimeout(p.timeout)
				p.reject(new Error('Agent engine exited'))
			}
			this.children.delete(agentId)
		}
		logger.info(`Agent "${agentId}" engine exited`)
		this.broadcastAgents()
	}

	/** Coalesced per-agent state refresh after a burst of bus events. */
	private scheduleStateRefresh(agentId: string): void {
		if (this.refreshTimers.has(agentId)) return
		const timer = setTimeout(() => {
			this.refreshTimers.delete(agentId)
			this.callAgent(agentId, 'state')
				.then((state) => this.server?.broadcast('state', state, undefined, agentId))
				.catch(() => {})
		}, STATE_DEBOUNCE_MS)
		this.refreshTimers.set(agentId, timer)
	}

	private broadcastAgents(): void {
		this.listAgents()
			.then((agents) => this.server?.broadcast('agents', agents))
			.catch(() => {})
	}

	async shutdown(): Promise<void> {
		for (const child of this.children.values()) {
			child.proc.kill('SIGTERM')
		}
		this.children.clear()
		await this.server?.close()
	}
}
