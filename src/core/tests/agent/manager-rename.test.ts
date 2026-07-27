import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentManager } from '../../src/agent/manager.js'

/**
 * Renaming an agent moves its display name and nothing else.
 *
 * The id is load-bearing: it names the directory on disk, it is `VOLE_AGENT_ID` inside the
 * running engine, it is the agent's MCP endpoint path, and the dashboard files chat history and
 * unread counts under it. These tests pin that it survives a rename — a rename that renumbered
 * the identity would orphan all of that for a cosmetic change.
 */

describe('AgentManager.rename', () => {
	let home: string
	let mgr: AgentManager

	beforeEach(async () => {
		home = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-rename-'))
		mgr = new AgentManager({ home })
		await mgr.create('alpha')
		await mgr.create('beta')
	})

	afterEach(async () => {
		await fs.rm(home, { recursive: true, force: true })
	})

	it('changes the name and leaves the id and directory alone', async () => {
		const before = (await mgr.readRegistry()).agents.find((a) => a.id === 'alpha')!
		const entry = await mgr.rename('alpha', 'Nart Sagas')

		expect(entry.name).toBe('Nart Sagas')
		expect(entry.id).toBe('alpha')
		expect(entry.path).toBe(before.path)
		// The directory on disk is untouched — the engine, its MCP endpoint and its data live there.
		await expect(fs.stat(before.path)).resolves.toBeDefined()

		const reg = await mgr.readRegistry()
		expect(reg.agents.find((a) => a.id === 'alpha')?.name).toBe('Nart Sagas')
	})

	it('persists across manager instances', async () => {
		await mgr.rename('alpha', 'renamed')
		const fresh = new AgentManager({ home })
		expect((await fresh.readRegistry()).agents.find((a) => a.id === 'alpha')?.name).toBe('renamed')
	})

	it('can be targeted by the current name or the id', async () => {
		await mgr.rename('alpha', 'first')
		await mgr.rename('first', 'second') // by its new name
		await mgr.rename('alpha', 'third') // by its unchanged id
		expect((await mgr.readRegistry()).agents.find((a) => a.id === 'alpha')?.name).toBe('third')
	})

	it("refuses a name another agent already answers to — targeting accepts id OR name", async () => {
		await expect(mgr.rename('alpha', 'beta')).rejects.toThrow(/already answers/)
		// Case-insensitively, and against ids as well as names.
		await expect(mgr.rename('alpha', 'BETA')).rejects.toThrow(/already answers/)
		const beta = (await mgr.readRegistry()).agents.find((a) => a.id === 'beta')!
		await expect(mgr.rename('alpha', beta.id)).rejects.toThrow(/already answers/)
	})

	it('allows renaming an agent to its own current name (no-op)', async () => {
		const entry = await mgr.rename('alpha', 'alpha')
		expect(entry.name).toBe('alpha')
	})

	it('trims, and rejects empty, over-long, or shell-hostile names', async () => {
		expect((await mgr.rename('alpha', '  spaced  ')).name).toBe('spaced')
		await expect(mgr.rename('alpha', '   ')).rejects.toThrow(/empty/)
		await expect(mgr.rename('alpha', 'x'.repeat(65))).rejects.toThrow(/too long/)
		for (const bad of ['rm -rf /', 'a/b', 'quote"name', "tick'name", '-leading', '$(whoami)']) {
			await expect(mgr.rename('alpha', bad)).rejects.toThrow(/Invalid name/)
		}
		// The name survives every rejection.
		expect((await mgr.readRegistry()).agents.find((a) => a.id === 'alpha')?.name).toBe('spaced')
	})

	it('errors clearly on an unknown agent', async () => {
		await expect(mgr.rename('nope', 'whatever')).rejects.toThrow(/not found/)
	})

	it('leaves orchestrator authority and creation time untouched', async () => {
		await mgr.setOrchestrator('beta', true)
		const before = (await mgr.readRegistry()).agents.find((a) => a.id === 'beta')!
		const after = await mgr.rename('beta', 'boss')
		expect(after.orchestrator).toBe(true)
		expect(after.createdAt).toBe(before.createdAt)
	})
})
