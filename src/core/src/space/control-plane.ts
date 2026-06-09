import type { ChildProcess } from 'node:child_process'
import {
	type DashboardServer,
	type SpaceSummary,
	createDashboardServer,
} from '@openvole/dashboard-server'
import { execa } from 'execa'
import { createLogger } from '../core/logger.js'
import { SpaceManager } from './manager.js'

const logger = createLogger('control-plane')
const RPC_TIMEOUT_MS = 15_000
const STOP_GRACE_MS = 5000
const STATE_DEBOUNCE_MS = 150

interface Pending {
	resolve: (value: unknown) => void
	reject: (err: Error) => void
	timeout: ReturnType<typeof setTimeout>
}

interface SpaceChild {
	proc: ChildProcess
	pending: Map<number, Pending>
	nextId: number
	ready: Promise<void>
	markReady: () => void
}

export interface ControlPlaneOptions {
	/** Absolute path to the running dist/cli.js (the `__run-space` daemon entry). */
	cliPath: string
	port: number
	home?: string
}

/**
 * The single control-plane web server. Spawns one engine subprocess (IPC child) per
 * running space, aggregates their state/events, and hosts ONE dashboard for all of them.
 */
export class ControlPlane {
	private readonly manager: SpaceManager
	private readonly children = new Map<string, SpaceChild>()
	private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
	private readonly cliPath: string
	private readonly port: number
	private server: DashboardServer | undefined
	private availablePawsCache:
		| Array<{ name: string; version: string; description: string }>
		| undefined

	constructor(opts: ControlPlaneOptions) {
		this.cliPath = opts.cliPath
		this.port = opts.port
		this.manager = new SpaceManager(opts.home ? { home: opts.home } : undefined)
	}

	start(): void {
		this.server = createDashboardServer(this.port, {
			listSpaces: () => this.listSpaces(),
			startSpace: (id) => this.startSpace(id),
			stopSpace: (id) => this.stopSpace(id),
			createSpace: (name) => this.createSpace(name),
			removeSpace: (id) => this.removeSpace(id),
			fetchState: (id) => this.callSpace(id, 'state'),
			readConfig: (id) => this.callSpace(id, 'read_config'),
			writeConfig: (config, id) => this.callSpace(id, 'write_config', { config }),
			readIdentity: (id) => this.callSpace(id, 'read_identity'),
			writeIdentity: (filename, content, id) =>
				this.callSpace(id, 'write_identity', { filename, content }),
			restartEngine: (id) => this.callSpace(id, 'restart'),
			listAvailablePaws: () => this.listAvailablePaws(),
		})
		logger.info(`Control plane listening on http://localhost:${this.port}`)
	}

	async listSpaces(): Promise<SpaceSummary[]> {
		const reg = await this.manager.readRegistry()
		return reg.spaces.map((s) => ({
			id: s.id,
			name: s.name,
			state: this.children.has(s.id) ? 'running' : 'stopped',
			pid: this.children.get(s.id)?.proc.pid,
		}))
	}

	async startSpace(id: string): Promise<{ ok: true }> {
		if (this.children.has(id)) return { ok: true }
		const reg = await this.manager.readRegistry()
		const entry = reg.spaces.find((s) => s.id === id || s.name === id)
		if (!entry) throw new Error(`Space not found: ${id}`)

		const proc = execa('node', [this.cliPath, '__run-space', entry.path], {
			cwd: entry.path,
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
			reject: false,
			cleanup: true,
		}) as unknown as ChildProcess

		let markReady: () => void = () => {}
		const ready = new Promise<void>((resolve) => {
			markReady = resolve
		})
		setTimeout(markReady, 8000) // fallback if the engine never signals ready
		const child: SpaceChild = { proc, pending: new Map(), nextId: 1, ready, markReady }
		this.children.set(entry.id, child)
		proc.on('message', (msg) => this.onChildMessage(entry.id, msg))
		proc.on('exit', () => this.onChildExit(entry.id))
		logger.info(`Started space "${entry.id}" (pid ${proc.pid})`)
		this.broadcastSpaces()
		return { ok: true }
	}

	async stopSpace(id: string): Promise<{ ok: true }> {
		const child = this.children.get(id)
		if (!child) return { ok: true }
		this.children.delete(id)
		for (const p of child.pending.values()) {
			clearTimeout(p.timeout)
			p.reject(new Error('Space stopped'))
		}
		child.pending.clear()
		const { proc } = child
		proc.kill('SIGTERM')
		setTimeout(() => {
			if (!proc.killed) proc.kill('SIGKILL')
		}, STOP_GRACE_MS)
		this.broadcastSpaces()
		return { ok: true }
	}

	async createSpace(name: string): Promise<{ ok: true }> {
		await this.manager.create(name)
		this.broadcastSpaces()
		return { ok: true }
	}

	async removeSpace(id: string): Promise<{ ok: true }> {
		await this.stopSpace(id)
		await this.manager.remove(id, { purge: false })
		this.broadcastSpaces()
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

	private callSpace(
		id: string | undefined,
		method: string,
		params: Record<string, unknown> = {},
	): Promise<unknown> {
		const child = id ? this.children.get(id) : undefined
		if (!id || !child) {
			return Promise.reject(new Error(id ? `Space not running: ${id}` : 'No space selected'))
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

	private onChildMessage(spaceId: string, msg: unknown): void {
		const m = msg as {
			id?: number
			result?: unknown
			error?: string
			event?: string
			data?: unknown
		}
		if (m == null) return
		if ((m as { ready?: boolean }).ready) {
			this.children.get(spaceId)?.markReady()
			return
		}
		if (m.id !== undefined && (m.result !== undefined || m.error !== undefined)) {
			const child = this.children.get(spaceId)
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
			this.server?.broadcast('event', m.data, m.event, spaceId)
			this.scheduleStateRefresh(spaceId)
		}
	}

	private onChildExit(spaceId: string): void {
		const child = this.children.get(spaceId)
		if (child) {
			for (const p of child.pending.values()) {
				clearTimeout(p.timeout)
				p.reject(new Error('Space engine exited'))
			}
			this.children.delete(spaceId)
		}
		logger.info(`Space "${spaceId}" engine exited`)
		this.broadcastSpaces()
	}

	/** Coalesced per-space state refresh after a burst of bus events. */
	private scheduleStateRefresh(spaceId: string): void {
		if (this.refreshTimers.has(spaceId)) return
		const timer = setTimeout(() => {
			this.refreshTimers.delete(spaceId)
			this.callSpace(spaceId, 'state')
				.then((state) => this.server?.broadcast('state', state, undefined, spaceId))
				.catch(() => {})
		}, STATE_DEBOUNCE_MS)
		this.refreshTimers.set(spaceId, timer)
	}

	private broadcastSpaces(): void {
		this.listSpaces()
			.then((spaces) => this.server?.broadcast('spaces', spaces))
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
