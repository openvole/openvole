import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlPlane } from '../../src/space/control-plane.js'
import { SpaceManager } from '../../src/space/manager.js'

type Cres = { cres: { id: number; result?: unknown; error?: string } }

/** A registry with one orchestrator ("boss") and one plain space ("worker"). */
async function seedRegistry(home: string): Promise<void> {
	const reg = {
		activeId: 'boss',
		spaces: [
			{
				id: 'boss',
				name: 'Boss Space',
				path: path.join(home, 'spaces', 'boss'),
				createdAt: '2026-01-01T00:00:00.000Z',
				orchestrator: true,
			},
			{
				id: 'worker',
				name: 'Worker Space',
				path: path.join(home, 'spaces', 'worker'),
				createdAt: '2026-01-01T00:00:00.000Z',
			},
		],
	}
	await fs.mkdir(home, { recursive: true })
	await fs.writeFile(path.join(home, 'spaces.json'), JSON.stringify(reg, null, 2))
}

/** The oversized state a space's control adapter would report. */
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
	let callSpace: ReturnType<typeof vi.fn>
	let reply: ReturnType<typeof vi.fn>

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-orch-test-'))
		await seedRegistry(tmpDir)
		// Constructor only builds a SpaceManager; start() (server, spawning) is never called.
		cp = new ControlPlane({ cliPath: '/dev/null', port: 0, home: tmpDir })
		callSpace = vi.fn(async (_id: string, method: string) =>
			method === 'state' ? FAT_STATE : { ok: true },
		)
		;(cp as any).callSpace = callSpace
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
		const spaces = res.result as Array<Record<string, unknown>>
		expect(spaces).toHaveLength(2)
		expect(spaces.find((s) => s.id === 'boss')).toMatchObject({
			orchestrator: true,
			state: 'stopped',
		})
		expect(spaces.find((s) => s.id === 'worker')).toMatchObject({
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
		expect(callSpace).not.toHaveBeenCalled()
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
			{ id: 5, method: 'stop', params: { target: 'Boss Space' } },
			reply,
		)
		expect(lastCres().error).toContain('orchestrator itself')
	})

	it('resolves a target by name and calls callSpace with its id', async () => {
		await cp.handleOrchestrateRequest(
			'boss',
			{ id: 6, method: 'state', params: { target: 'Worker Space' } },
			reply,
		)
		expect(callSpace).toHaveBeenCalledWith('worker', 'state')
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

	it('forwards submit params and write guards ride callSpace', async () => {
		await cp.handleOrchestrateRequest(
			'boss',
			{ id: 8, method: 'submit', params: { target: 'worker', input: 'go', sessionId: 'p1' } },
			reply,
		)
		expect(callSpace).toHaveBeenCalledWith('worker', 'submit', { input: 'go', sessionId: 'p1' })
		await cp.handleOrchestrateRequest(
			'boss',
			{
				id: 9,
				method: 'write_identity',
				params: { target: 'worker', filename: 'AGENT.md', content: '# R' },
			},
			reply,
		)
		expect(callSpace).toHaveBeenCalledWith('worker', 'write_identity', {
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
		expect(lastCres().error).toContain('Space not found')
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

describe('SpaceManager.setOrchestrator', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-orch-mgr-'))
		await seedRegistry(tmpDir)
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it('persists grant and revoke (revoke deletes the key)', async () => {
		const mgr = new SpaceManager({ home: tmpDir })
		await mgr.setOrchestrator('worker', true)
		let reg = await mgr.readRegistry()
		expect(reg.spaces.find((s) => s.id === 'worker')?.orchestrator).toBe(true)

		await mgr.setOrchestrator('Boss Space', false) // by name
		reg = await mgr.readRegistry()
		const boss = reg.spaces.find((s) => s.id === 'boss') as Record<string, unknown>
		expect('orchestrator' in boss).toBe(false)
	})

	it('throws for an unknown space', async () => {
		const mgr = new SpaceManager({ home: tmpDir })
		await expect(mgr.setOrchestrator('ghost', true)).rejects.toThrow('Space not found')
	})
})
