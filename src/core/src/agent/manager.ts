import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { execa } from 'execa'
import { DEFAULT_AGENT_MD, ORCHESTRATOR_AGENT_MD, scaffoldProject } from './scaffold.js'
import type { AgentEntry, AgentRegistry, AgentRuntime, AgentStatus } from './types.js'

/** How long to wait for a graceful SIGTERM exit before SIGKILL (ms). */
const STOP_GRACE_MS = 5000

/**
 * Supervisor for agents. Manages the global registry (~/.openvole/agents.json) and
 * one engine subprocess per active agent. Agents MUST run as separate processes — the
 * paw-sdk IPC transport singleton and VoleNet globals make in-process multi-engine unsafe.
 */
export class AgentManager {
	private readonly home: string
	private readonly registryPath: string

	constructor(opts?: { home?: string }) {
		this.home = opts?.home ?? process.env.VOLE_HOME ?? path.join(os.homedir(), '.openvole')
		this.registryPath = path.join(this.home, 'agents.json')
	}

	// --- registry I/O ---

	async readRegistry(): Promise<AgentRegistry> {
		try {
			const parsed = JSON.parse(await fs.readFile(this.registryPath, 'utf-8')) as AgentRegistry
			return { activeId: parsed.activeId, agents: parsed.agents ?? [] }
		} catch {
			// Legacy pre-rename registry (spaces.json, `spaces` key): read transparently;
			// the next write persists to agents.json.
			try {
				const legacy = JSON.parse(
					await fs.readFile(path.join(this.home, 'spaces.json'), 'utf-8'),
				) as { activeId?: string; spaces?: AgentEntry[] }
				return { activeId: legacy.activeId, agents: legacy.spaces ?? [] }
			} catch {
				return { agents: [] }
			}
		}
	}

	private async writeRegistry(reg: AgentRegistry): Promise<void> {
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

	private getEntry(reg: AgentRegistry, idOrName: string): AgentEntry | undefined {
		return reg.agents.find((s) => s.id === idOrName || s.name === idOrName)
	}

	// --- per-agent runtime hint (pid lives here; liveness is verified, not trusted) ---

	private runtimePath(agentPath: string): string {
		return path.join(agentPath, '.openvole', 'runtime.json')
	}

	private async readRuntime(agentPath: string): Promise<AgentRuntime | undefined> {
		try {
			return JSON.parse(await fs.readFile(this.runtimePath(agentPath), 'utf-8')) as AgentRuntime
		} catch {
			return undefined
		}
	}

	private async writeRuntime(agentPath: string, rt: AgentRuntime): Promise<void> {
		await fs.mkdir(path.join(agentPath, '.openvole'), { recursive: true })
		await fs.writeFile(this.runtimePath(agentPath), `${JSON.stringify(rt, null, 2)}\n`, 'utf-8')
	}

	private async clearRuntime(agentPath: string): Promise<void> {
		await fs.rm(this.runtimePath(agentPath), { force: true })
	}

	private isAlive(pid: number): boolean {
		try {
			process.kill(pid, 0)
			return true
		} catch {
			return false
		}
	}

	/** Live pid for an agent, or undefined if not running. Clears stale runtime hints. */
	private async livePid(agentPath: string): Promise<number | undefined> {
		const rt = await this.readRuntime(agentPath)
		if (rt && this.isAlive(rt.pid)) return rt.pid
		if (rt) await this.clearRuntime(agentPath)
		return undefined
	}

	// --- agent template (cloned by create() when present) ---

	/** Path to the optional agent template at <home>/agent-template. */
	get templatePath(): string {
		return path.join(this.home, 'agent-template')
	}

	private async pathExists(p: string): Promise<boolean> {
		try {
			await fs.access(p)
			return true
		} catch {
			return false
		}
	}

	/** Existing template dir: <home>/agent-template, else the legacy <home>/space-template. */
	private async resolveTemplate(): Promise<string | undefined> {
		for (const dir of [this.templatePath, path.join(this.home, 'space-template')]) {
			if (await this.pathExists(path.join(dir, 'vole.config.json'))) return dir
		}
		return undefined
	}

	/** Scaffold the agent template if absent. Returns its path and whether it was just created. */
	async ensureTemplate(): Promise<{ path: string; created: boolean }> {
		const existing = await this.resolveTemplate()
		if (existing) return { path: existing, created: false }
		const dir = this.templatePath
		await fs.mkdir(dir, { recursive: true })
		await scaffoldProject(dir)
		return { path: dir, created: true }
	}

	/** Recursively copy the template into a new agent dir, skipping volatile/installed files. */
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
	): Promise<AgentEntry> {
		const reg = await this.readRegistry()
		const id = this.slug(name)
		if (!id) throw new Error(`Invalid agent name: "${name}"`)
		if (this.getEntry(reg, id)) throw new Error(`Agent "${id}" already exists`)

		const dir = opts?.path ? path.resolve(opts.path) : path.join(this.home, 'agents', id)
		await fs.mkdir(dir, { recursive: true })
		// Clone the user's agent template if present (legacy space-template honored), else scaffold.
		const template = await this.resolveTemplate()
		if (template) {
			await this.copyTemplate(template, dir)
		} else {
			await scaffoldProject(dir)
		}

		const entry: AgentEntry = {
			id,
			name,
			path: dir,
			createdAt: new Date().toISOString(),
			...(opts?.orchestrator ? { orchestrator: true } : {}),
		}
		reg.agents.push(entry)
		if (!reg.activeId) reg.activeId = id
		await this.writeRegistry(reg)
		if (entry.orchestrator) await this.seedOrchestratorIdentity(dir)
		return entry
	}

	/** Seed the orchestrator AGENT.md brief — but never clobber a customized identity. */
	private async seedOrchestratorIdentity(dir: string): Promise<void> {
		const file = path.join(dir, '.openvole', 'AGENT.md')
		try {
			const current = await fs.readFile(file, 'utf-8')
			if (current !== DEFAULT_AGENT_MD) return
		} catch {
			await fs.mkdir(path.join(dir, '.openvole'), { recursive: true })
		}
		await fs.writeFile(file, ORCHESTRATOR_AGENT_MD, 'utf-8')
	}

	async list(): Promise<AgentStatus[]> {
		const reg = await this.readRegistry()
		const out: AgentStatus[] = []
		for (const s of reg.agents) {
			const pid = await this.livePid(s.path)
			out.push({ ...s, state: pid ? 'running' : 'stopped', pid })
		}
		return out
	}

	async status(idOrName?: string): Promise<AgentStatus[]> {
		const all = await this.list()
		if (!idOrName) return all
		return all.filter((s) => s.id === idOrName || s.name === idOrName)
	}

	/**
	 * Lazily start an agent's engine subprocess (no-op if already running).
	 * `cliPath` is the absolute path to the running dist/cli.js (the `__run-agent` daemon entry).
	 */
	async start(
		idOrName: string,
		opts: { cliPath: string },
	): Promise<{ pid: number; reused: boolean }> {
		const reg = await this.readRegistry()
		const entry = this.getEntry(reg, idOrName)
		if (!entry) throw new Error(`Agent not found: "${idOrName}"`)

		const existing = await this.livePid(entry.path)
		if (existing) return { pid: existing, reused: true }

		// Detached so the engine outlives this short-lived CLI invocation; the engine logs
		// to the agent's own VOLE_LOG_FILE (.openvole/logs/vole.log).
		const child = execa('node', [opts.cliPath, '__run-agent', entry.path], {
			cwd: entry.path,
			// Explicitly blank: detached agents have no IPC channel, so they can never
			// reverse-RPC — don't let an inherited VOLE_ORCHESTRATOR suggest otherwise.
			env: { ...process.env, VOLE_ORCHESTRATOR: '' },
			stdio: 'ignore',
			detached: true,
			cleanup: false,
			reject: false,
		})
		;(child as unknown as import('node:child_process').ChildProcess).unref()

		if (!child.pid) throw new Error(`Failed to spawn engine for agent "${entry.id}"`)
		await this.writeRuntime(entry.path, { pid: child.pid, startedAt: new Date().toISOString() })
		return { pid: child.pid, reused: false }
	}

	async stop(idOrName: string): Promise<boolean> {
		const reg = await this.readRegistry()
		const entry = this.getEntry(reg, idOrName)
		if (!entry) throw new Error(`Agent not found: "${idOrName}"`)
		return this.stopEntry(entry)
	}

	async stopAll(): Promise<number> {
		const reg = await this.readRegistry()
		let stopped = 0
		for (const entry of reg.agents) {
			if (await this.stopEntry(entry)) stopped++
		}
		return stopped
	}

	private async stopEntry(entry: AgentEntry): Promise<boolean> {
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

	/** Grant or revoke an agent's orchestrator authority (persisted in the registry). */
	async setOrchestrator(idOrName: string, value: boolean): Promise<AgentEntry> {
		const reg = await this.readRegistry()
		const entry = this.getEntry(reg, idOrName)
		if (!entry) throw new Error(`Agent not found: "${idOrName}"`)
		// undefined (not `delete`) — JSON.stringify drops the key on write anyway
		entry.orchestrator = value ? true : undefined
		await this.writeRegistry(reg)
		if (value) await this.seedOrchestratorIdentity(entry.path)
		return entry
	}

	async switchTo(idOrName: string): Promise<AgentEntry> {
		const reg = await this.readRegistry()
		const entry = this.getEntry(reg, idOrName)
		if (!entry) throw new Error(`Agent not found: "${idOrName}"`)
		reg.activeId = entry.id
		await this.writeRegistry(reg)
		return entry
	}

	async remove(idOrName: string, opts?: { purge?: boolean }): Promise<void> {
		const reg = await this.readRegistry()
		const entry = this.getEntry(reg, idOrName)
		if (!entry) throw new Error(`Agent not found: "${idOrName}"`)
		await this.stopEntry(entry)
		reg.agents = reg.agents.filter((s) => s.id !== entry.id)
		if (reg.activeId === entry.id) reg.activeId = reg.agents[0]?.id
		await this.writeRegistry(reg)
		if (opts?.purge) await fs.rm(entry.path, { recursive: true, force: true })
	}
}
