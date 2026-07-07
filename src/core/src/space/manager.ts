import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { execa } from 'execa'
import { scaffoldProject } from './scaffold.js'
import type { SpaceEntry, SpaceRegistry, SpaceRuntime, SpaceStatus } from './types.js'

/** How long to wait for a graceful SIGTERM exit before SIGKILL (ms). */
const STOP_GRACE_MS = 5000

/**
 * Supervisor for spaces. Manages the global registry (~/.openvole/spaces.json) and
 * one engine subprocess per active space. Spaces MUST run as separate processes — the
 * paw-sdk IPC transport singleton and VoleNet globals make in-process multi-engine unsafe.
 */
export class SpaceManager {
	private readonly home: string
	private readonly registryPath: string

	constructor(opts?: { home?: string }) {
		this.home = opts?.home ?? process.env.VOLE_HOME ?? path.join(os.homedir(), '.openvole')
		this.registryPath = path.join(this.home, 'spaces.json')
	}

	// --- registry I/O ---

	async readRegistry(): Promise<SpaceRegistry> {
		try {
			const parsed = JSON.parse(await fs.readFile(this.registryPath, 'utf-8')) as SpaceRegistry
			return { activeId: parsed.activeId, spaces: parsed.spaces ?? [] }
		} catch {
			return { spaces: [] }
		}
	}

	private async writeRegistry(reg: SpaceRegistry): Promise<void> {
		await fs.mkdir(this.home, { recursive: true })
		await fs.writeFile(this.registryPath, `${JSON.stringify(reg, null, 2)}\n`, 'utf-8')
	}

	private slug(name: string): string {
		return name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '')
	}

	private getEntry(reg: SpaceRegistry, idOrName: string): SpaceEntry | undefined {
		return reg.spaces.find((s) => s.id === idOrName || s.name === idOrName)
	}

	// --- per-space runtime hint (pid lives here; liveness is verified, not trusted) ---

	private runtimePath(spacePath: string): string {
		return path.join(spacePath, '.openvole', 'runtime.json')
	}

	private async readRuntime(spacePath: string): Promise<SpaceRuntime | undefined> {
		try {
			return JSON.parse(await fs.readFile(this.runtimePath(spacePath), 'utf-8')) as SpaceRuntime
		} catch {
			return undefined
		}
	}

	private async writeRuntime(spacePath: string, rt: SpaceRuntime): Promise<void> {
		await fs.mkdir(path.join(spacePath, '.openvole'), { recursive: true })
		await fs.writeFile(this.runtimePath(spacePath), `${JSON.stringify(rt, null, 2)}\n`, 'utf-8')
	}

	private async clearRuntime(spacePath: string): Promise<void> {
		await fs.rm(this.runtimePath(spacePath), { force: true })
	}

	private isAlive(pid: number): boolean {
		try {
			process.kill(pid, 0)
			return true
		} catch {
			return false
		}
	}

	/** Live pid for a space, or undefined if not running. Clears stale runtime hints. */
	private async livePid(spacePath: string): Promise<number | undefined> {
		const rt = await this.readRuntime(spacePath)
		if (rt && this.isAlive(rt.pid)) return rt.pid
		if (rt) await this.clearRuntime(spacePath)
		return undefined
	}

	// --- space template (cloned by create() when present) ---

	/** Path to the optional space template at <home>/space-template. */
	get templatePath(): string {
		return path.join(this.home, 'space-template')
	}

	private async pathExists(p: string): Promise<boolean> {
		try {
			await fs.access(p)
			return true
		} catch {
			return false
		}
	}

	/** Scaffold the space template if absent. Returns its path and whether it was just created. */
	async ensureTemplate(): Promise<{ path: string; created: boolean }> {
		const dir = this.templatePath
		if (await this.pathExists(path.join(dir, 'vole.config.json'))) {
			return { path: dir, created: false }
		}
		await fs.mkdir(dir, { recursive: true })
		await scaffoldProject(dir)
		return { path: dir, created: true }
	}

	/** Recursively copy the template into a new space dir, skipping volatile/installed files. */
	private async copyTemplate(src: string, dest: string): Promise<void> {
		await fs.cp(src, dest, {
			recursive: true,
			filter: (from) => {
				const rel = path.relative(src, from)
				if (!rel) return true
				const top = rel.split(path.sep)[0]
				if (top === 'node_modules' || top === '.git') return false
				if (rel === path.join('.openvole', 'runtime.json')) return false
				if (rel.startsWith(path.join('.openvole', 'logs'))) return false
				return true
			},
		})
	}

	// --- commands ---

	async create(
		name: string,
		opts?: { path?: string; orchestrator?: boolean },
	): Promise<SpaceEntry> {
		const reg = await this.readRegistry()
		const id = this.slug(name)
		if (!id) throw new Error(`Invalid space name: "${name}"`)
		if (this.getEntry(reg, id)) throw new Error(`Space "${id}" already exists`)

		const dir = opts?.path ? path.resolve(opts.path) : path.join(this.home, 'spaces', id)
		await fs.mkdir(dir, { recursive: true })
		// Clone the user's space template if present, else scaffold an empty project.
		if (await this.pathExists(path.join(this.templatePath, 'vole.config.json'))) {
			await this.copyTemplate(this.templatePath, dir)
		} else {
			await scaffoldProject(dir)
		}

		const entry: SpaceEntry = {
			id,
			name,
			path: dir,
			createdAt: new Date().toISOString(),
			...(opts?.orchestrator ? { orchestrator: true } : {}),
		}
		reg.spaces.push(entry)
		if (!reg.activeId) reg.activeId = id
		await this.writeRegistry(reg)
		return entry
	}

	async list(): Promise<SpaceStatus[]> {
		const reg = await this.readRegistry()
		const out: SpaceStatus[] = []
		for (const s of reg.spaces) {
			const pid = await this.livePid(s.path)
			out.push({ ...s, state: pid ? 'running' : 'stopped', pid })
		}
		return out
	}

	async status(idOrName?: string): Promise<SpaceStatus[]> {
		const all = await this.list()
		if (!idOrName) return all
		return all.filter((s) => s.id === idOrName || s.name === idOrName)
	}

	/**
	 * Lazily start a space's engine subprocess (no-op if already running).
	 * `cliPath` is the absolute path to the running dist/cli.js (the `__run-space` daemon entry).
	 */
	async start(
		idOrName: string,
		opts: { cliPath: string },
	): Promise<{ pid: number; reused: boolean }> {
		const reg = await this.readRegistry()
		const entry = this.getEntry(reg, idOrName)
		if (!entry) throw new Error(`Space not found: "${idOrName}"`)

		const existing = await this.livePid(entry.path)
		if (existing) return { pid: existing, reused: true }

		// Detached so the engine outlives this short-lived CLI invocation; the engine logs
		// to the space's own VOLE_LOG_FILE (.openvole/logs/vole.log).
		const child = execa('node', [opts.cliPath, '__run-space', entry.path], {
			cwd: entry.path,
			// Explicitly blank: detached spaces have no IPC channel, so they can never
			// reverse-RPC — don't let an inherited VOLE_ORCHESTRATOR suggest otherwise.
			env: { ...process.env, VOLE_ORCHESTRATOR: '' },
			stdio: 'ignore',
			detached: true,
			cleanup: false,
			reject: false,
		})
		;(child as unknown as import('node:child_process').ChildProcess).unref()

		if (!child.pid) throw new Error(`Failed to spawn engine for space "${entry.id}"`)
		await this.writeRuntime(entry.path, { pid: child.pid, startedAt: new Date().toISOString() })
		return { pid: child.pid, reused: false }
	}

	async stop(idOrName: string): Promise<boolean> {
		const reg = await this.readRegistry()
		const entry = this.getEntry(reg, idOrName)
		if (!entry) throw new Error(`Space not found: "${idOrName}"`)
		return this.stopEntry(entry)
	}

	async stopAll(): Promise<number> {
		const reg = await this.readRegistry()
		let stopped = 0
		for (const entry of reg.spaces) {
			if (await this.stopEntry(entry)) stopped++
		}
		return stopped
	}

	private async stopEntry(entry: SpaceEntry): Promise<boolean> {
		const pid = await this.livePid(entry.path)
		if (!pid) return false
		try {
			process.kill(pid, 'SIGTERM')
		} catch {
			await this.clearRuntime(entry.path)
			return false
		}
		const deadline = Date.now() + STOP_GRACE_MS
		while (Date.now() < deadline && this.isAlive(pid)) {
			await new Promise((resolve) => setTimeout(resolve, 200))
		}
		if (this.isAlive(pid)) {
			try {
				process.kill(pid, 'SIGKILL')
			} catch {
				/* already gone */
			}
		}
		await this.clearRuntime(entry.path)
		return true
	}

	/** Grant or revoke a space's orchestrator authority (persisted in the registry). */
	async setOrchestrator(idOrName: string, value: boolean): Promise<SpaceEntry> {
		const reg = await this.readRegistry()
		const entry = this.getEntry(reg, idOrName)
		if (!entry) throw new Error(`Space not found: "${idOrName}"`)
		// undefined (not `delete`) — JSON.stringify drops the key on write anyway
		entry.orchestrator = value ? true : undefined
		await this.writeRegistry(reg)
		return entry
	}

	async switchTo(idOrName: string): Promise<SpaceEntry> {
		const reg = await this.readRegistry()
		const entry = this.getEntry(reg, idOrName)
		if (!entry) throw new Error(`Space not found: "${idOrName}"`)
		reg.activeId = entry.id
		await this.writeRegistry(reg)
		return entry
	}

	async remove(idOrName: string, opts?: { purge?: boolean }): Promise<void> {
		const reg = await this.readRegistry()
		const entry = this.getEntry(reg, idOrName)
		if (!entry) throw new Error(`Space not found: "${idOrName}"`)
		await this.stopEntry(entry)
		reg.spaces = reg.spaces.filter((s) => s.id !== entry.id)
		if (reg.activeId === entry.id) reg.activeId = reg.spaces[0]?.id
		await this.writeRegistry(reg)
		if (opts?.purge) await fs.rm(entry.path, { recursive: true, force: true })
	}
}
