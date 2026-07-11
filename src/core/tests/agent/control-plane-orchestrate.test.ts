import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlPlane } from '../../src/agent/control-plane.js'
import { AgentManager } from '../../src/agent/manager.js'

type Cres = { cres: { id: number; result?: unknown; error?: string } }

/** A registry with one orchestrator ("boss") and one plain agent ("worker"). */
async function seedRegistry(home: string): Promise<void> {
	const reg = {
		activeId: 'boss',
		agents: [
			{
				id: 'boss',
				name: 'Boss Agent',
				path: path.join(home, 'agents', 'boss'),
				createdAt: '2026-01-01T00:00:00.000Z',
				orchestrator: true,
			},
			{
				id: 'worker',
				name: 'Worker Agent',
				path: path.join(home, 'agents', 'worker'),
				createdAt: '2026-01-01T00:00:00.000Z',
			},
		],
	}
	await fs.mkdir(home, { recursive: true })
	await fs.writeFile(path.join(home, 'agents.json'), JSON.stringify(reg, null, 2))
}

/** The oversized state an agent's control adapter would report. */
const FAT_STATE = {
	tools: Array.from({ length: 40 }, (_, i) => ({ name: `tool_${i}`, description: 'x'.repeat(80) })),
	paws: [
		{ name: 'paw-brain', healthy: true, permissions: { network: ['*'] }, description: 'brain' },
		{ name: 'paw-session', healthy: false, permissions: null, description: 'session' },
	],
	skills: [
		{ name: 'active-skill', active: true, missingTools: [] },
		{ name: 'dormant-skill', active: false, missingTools: ['tool:missing_one'] },
	],
	tasks: Array.from({ length: 25 }, (_, i) => ({
		id: `t-${i}`,
		source: 'user',
		input: 'y'.repeat(500),
		status: i === 0 ? 'running' : i === 1 ? 'queued' : 'completed',
		createdAt: 1000 + i,
	})),
	schedules: [{ id: 's1', cron: '0 * * * *', nextRun: 123, extra: 'noise' }],
	volenet: { enabled: false },
}

describe('ControlPlane orchestrate reverse-RPC', () => {
	let tmpDir: string
	let cp: ControlPlane
	let callAgent: ReturnType<typeof vi.fn>
	let reply: ReturnType<typeof vi.fn>

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-orch-test-'))
		await seedRegistry(tmpDir)
		// Constructor only builds a AgentManager; start() (server, spawning) is never called.
		cp = new ControlPlane({ cliPath: '/dev/null', port: 0, home: tmpDir })
		callAgent = vi.fn(async (_id: string, method: string) =>
			method === 'state' ? FAT_STATE : { ok: true },
		)
		;(cp as any).callAgent = callAgent
		reply = vi.fn()
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	function lastCres(): Cres['cres'] {
		return (reply.mock.calls.at(-1)?.[0] as Cres).cres
	}

	it('answers list with states and orchestrator flags', async () => {
		;(cp as any).children.set('worker', { proc: { pid: 42 } })
		await cp.handleOrchestrateRequest('boss', { id: 1, method: 'list', params: {} }, reply)
		const res = lastCres()
		expect(res.id).toBe(1)
		expect(res.error).toBeUndefined()
		const agents = res.result as Array<Record<string, unknown>>
		expect(agents).toHaveLength(2)
		expect(agents.find((s) => s.id === 'boss')).toMatchObject({
			orchestrator: true,
			state: 'stopped',
		})
		expect(agents.find((s) => s.id === 'worker')).toMatchObject({
			orchestrator: false,
			state: 'running',
			pid: 42,
		})
	})

	it('refuses a sender without the orchestrator flag', async () => {
		await cp.handleOrchestrateRequest(
			'worker',
			{ id: 2, method: 'submit', params: { target: 'boss', input: 'hi' } },
			reply,
		)
		expect(lastCres().error).toContain('not an orchestrator')
		expect(callAgent).not.toHaveBeenCalled()
	})

	it('refuses an unknown sender', async () => {
		await cp.handleOrchestrateRequest('ghost', { id: 3, method: 'list', params: {} }, reply)
		expect(lastCres().error).toContain('not an orchestrator')
	})

	it.each(['stop', 'restart', 'start'])('refuses self-%s', async (method) => {
		await cp.handleOrchestrateRequest('boss', { id: 4, method, params: { target: 'boss' } }, reply)
		expect(lastCres().error).toContain('orchestrator itself')
	})

	it('refuses self-lifecycle even when targeted by name (resolves ids first)', async () => {
		await cp.handleOrchestrateRequest(
			'boss',
			{ id: 5, method: 'stop', params: { target: 'Boss Agent' } },
			reply,
		)
		expect(lastCres().error).toContain('orchestrator itself')
	})

	it('resolves a target by name and calls callAgent with its id', async () => {
		await cp.handleOrchestrateRequest(
			'boss',
			{ id: 6, method: 'state', params: { target: 'Worker Agent' } },
			reply,
		)
		expect(callAgent).toHaveBeenCalledWith('worker', 'state')
		expect(lastCres().error).toBeUndefined()
	})

	it('summarizes state: no tool list, clipped inputs, max 10 tasks', async () => {
		await cp.handleOrchestrateRequest(
			'boss',
			{ id: 7, method: 'state', params: { target: 'worker' } },
			reply,
		)
		const s = lastCres().result as Record<string, unknown>
		expect(s.tools).toBeUndefined()
		expect(s.toolCount).toBe(40)
		expect(s.paws).toEqual([
			{ name: 'paw-brain', healthy: true },
			{ name: 'paw-session', healthy: false },
		])
		expect(s.skills).toEqual({
			active: ['active-skill'],
			inactive: [{ name: 'dormant-skill', missingTools: ['tool:missing_one'] }],
		})
		const tasks = s.tasks as Array<Record<string, unknown>>
		expect(tasks).toHaveLength(10)
		for (const t of tasks) expect(String(t.input).length).toBeLessThanOrEqual(201)
		expect(s.runningCount).toBe(1)
		expect(s.queuedCount).toBe(1)
		expect(s.schedules).toEqual([{ id: 's1', cron: '0 * * * *', nextRun: 123 }])
	})

	it('forwards submit params and write guards ride callAgent', async () => {
		await cp.handleOrchestrateRequest(
			'boss',
			{ id: 8, method: 'submit', params: { target: 'worker', input: 'go', sessionId: 'p1' } },
			reply,
		)
		expect(callAgent).toHaveBeenCalledWith('worker', 'submit', { input: 'go', sessionId: 'p1' })
		await cp.handleOrchestrateRequest(
			'boss',
			{
				id: 9,
				method: 'write_identity',
				params: { target: 'worker', filename: 'AGENT.md', content: '# R' },
			},
			reply,
		)
		expect(callAgent).toHaveBeenCalledWith('worker', 'write_identity', {
			filename: 'AGENT.md',
			content: '# R',
		})
	})

	it('rejects an unknown method and an unknown target', async () => {
		await cp.handleOrchestrateRequest(
			'boss',
			{ id: 10, method: 'remove', params: { target: 'worker' } },
			reply,
		)
		expect(lastCres().error).toContain('Unknown orchestrate method')
		await cp.handleOrchestrateRequest(
			'boss',
			{ id: 11, method: 'state', params: { target: 'nope' } },
			reply,
		)
		expect(lastCres().error).toContain('Agent not found')
	})

	it('wires creq messages from onChildMessage to a cres reply on the sender socket', async () => {
		const send = vi.fn()
		;(cp as any).children.set('boss', { proc: { pid: 1, connected: true, send } })
		;(cp as any).onChildMessage('boss', { creq: { id: 12, method: 'list', params: {} } })
		await vi.waitFor(() => expect(send).toHaveBeenCalled())
		const msg = send.mock.calls[0][0] as Cres
		expect(msg.cres.id).toBe(12)
		expect(Array.isArray(msg.cres.result)).toBe(true)
	})

	it('leaves existing child message shapes untouched', () => {
		const send = vi.fn()
		;(cp as any).children.set('boss', {
			proc: { pid: 1, connected: true, send },
			pending: new Map(),
		})
		;(cp as any).onChildMessage('boss', { event: 'task:completed', data: {} })
		;(cp as any).onChildMessage('boss', { id: 1, result: {} })
		expect(send).not.toHaveBeenCalled()
	})
})

describe('AgentManager.setOrchestrator', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-orch-mgr-'))
		await seedRegistry(tmpDir)
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it('persists grant and revoke (revoke deletes the key)', async () => {
		const mgr = new AgentManager({ home: tmpDir })
		await mgr.setOrchestrator('worker', true)
		let reg = await mgr.readRegistry()
		expect(reg.agents.find((s) => s.id === 'worker')?.orchestrator).toBe(true)

		await mgr.setOrchestrator('Boss Agent', false) // by name
		reg = await mgr.readRegistry()
		const boss = reg.agents.find((s) => s.id === 'boss') as Record<string, unknown>
		expect('orchestrator' in boss).toBe(false)
	})

	it('seeds the orchestrator AGENT.md on create and grant, but never clobbers custom content', async () => {
		const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-seed-'))
		const mgr = new AgentManager({ home })

		const boss = await mgr.create('seed-boss', { orchestrator: true })
		const seeded = await fs.readFile(path.join(boss.path, '.openvole', 'AGENT.md'), 'utf-8')
		expect(seeded).toContain('# Orchestrator')

		const worker = await mgr.create('seed-worker')
		const plain = await fs.readFile(path.join(worker.path, '.openvole', 'AGENT.md'), 'utf-8')
		expect(plain).not.toContain('# Orchestrator')

		// Grant on an agent whose identity was customized — must stay untouched.
		const customFile = path.join(worker.path, '.openvole', 'AGENT.md')
		await fs.writeFile(customFile, '# My custom brief\n')
		await mgr.setOrchestrator('seed-worker', true)
		expect(await fs.readFile(customFile, 'utf-8')).toBe('# My custom brief\n')

		// Grant on a pristine identity — seeded.
		const fresh = await mgr.create('seed-fresh')
		await mgr.setOrchestrator('seed-fresh', true)
		const freshMd = await fs.readFile(path.join(fresh.path, '.openvole', 'AGENT.md'), 'utf-8')
		expect(freshMd).toContain('# Orchestrator')
		await fs.rm(home, { recursive: true, force: true })
	})

	it('throws for an unknown agent', async () => {
		const mgr = new AgentManager({ home: tmpDir })
		await expect(mgr.setOrchestrator('ghost', true)).rejects.toThrow('Agent not found')
	})

	it('reads a legacy spaces.json registry and migrates it on the next write', async () => {
		const legacyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-legacy-'))
		await fs.writeFile(
			path.join(legacyHome, 'spaces.json'),
			JSON.stringify({
				activeId: 'boss',
				spaces: [{ id: 'boss', name: 'Boss', path: '/x', createdAt: 'now', orchestrator: true }],
			}),
		)
		const mgr = new AgentManager({ home: legacyHome })
		const reg = await mgr.readRegistry()
		expect(reg.agents).toHaveLength(1)
		expect(reg.agents[0]?.orchestrator).toBe(true)

		await mgr.setOrchestrator('boss', false) // any write persists to agents.json
		const migrated = JSON.parse(await fs.readFile(path.join(legacyHome, 'agents.json'), 'utf-8'))
		expect(migrated.agents).toHaveLength(1)
		expect('orchestrator' in migrated.agents[0]).toBe(false)
		await fs.rm(legacyHome, { recursive: true, force: true })
	})
})
