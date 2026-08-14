import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessageBus } from '../../src/core/bus.js'
import { SchedulerStore } from '../../src/core/scheduler.js'
import { TaskQueue } from '../../src/core/task.js'
import { Vault } from '../../src/core/vault.js'
import { ProjectStore } from '../../src/project/store.js'
import { TaskStore } from '../../src/project/tasks.js'
import { createCoreTools } from '../../src/tool/core-tools.js'
import type { ToolDefinition } from '../../src/tool/types.js'

/**
 * Projects live in the same tree the workspace_* scratch tools write freely into, so without a
 * guard an agent could clobber a project manifest — or, because workspace_delete is recursive,
 * remove a whole project and its task history — with an ordinary file operation it had no reason
 * to think was destructive. Those files belong to the project tools.
 *
 * Reads stay open: inspecting a manifest is harmless and occasionally useful.
 */

function createMockSkillRegistry() {
	return {
		get: vi.fn(() => undefined),
		list: vi.fn(() => []),
		active: vi.fn(() => []),
		load: vi.fn(async () => true),
		unload: vi.fn(() => true),
		resolve: vi.fn(),
	} as never
}

describe('workspace scratch tools vs project records', () => {
	let tmpDir: string
	let tools: ToolDefinition[]
	let scheduler: SchedulerStore
	let projects: ProjectStore

	const tool = (name: string) => tools.find((t) => t.name === name) as ToolDefinition

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-scratch-guard-'))
		const bus = createMessageBus()
		scheduler = new SchedulerStore()
		const vault = new Vault(path.join(tmpDir, 'vault.json'))
		await vault.init()
		tools = createCoreTools(scheduler, new TaskQueue(bus), tmpDir, createMockSkillRegistry(), vault)

		projects = new ProjectStore(path.join(tmpDir, '.openvole', 'workspace'), { agentRoot: tmpDir })
		await projects.init()
		await projects.create({ id: 'proj', context: 'the real context' })
		await new TaskStore(projects).create({ projectId: 'proj', goal: 'keep me' })
	})

	afterEach(async () => {
		scheduler.clearAll()
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it('refuses to overwrite a project manifest', async () => {
		const res = (await tool('workspace_write').execute({
			path: 'proj/.project.json',
			content: '{"id":"hijacked"}',
		})) as { ok: boolean; error?: string }

		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/project/i)
		expect((await projects.get('proj'))?.id).toBe('proj')
	})

	it('refuses to overwrite a task log', async () => {
		const res = (await tool('workspace_write').execute({
			path: 'proj/tasks.jsonl',
			content: '',
		})) as { ok: boolean }
		expect(res.ok).toBe(false)

		const raw = await fs.readFile(
			path.join(tmpDir, '.openvole', 'workspace', 'proj', 'tasks.jsonl'),
			'utf-8',
		)
		expect(raw).toContain('keep me')
	})

	it('refuses reserved names at any depth', async () => {
		const res = (await tool('workspace_write').execute({
			path: 'proj/notes/deep/.project.json',
			content: 'x',
		})) as { ok: boolean }
		expect(res.ok).toBe(false)
	})

	it('refuses to delete a project folder — that is what archive is for', async () => {
		const res = (await tool('workspace_delete').execute({ path: 'proj' })) as {
			ok: boolean
			error?: string
		}
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/project_archive/)
		expect(await projects.get('proj')).not.toBeNull()
	})

	it('refuses to delete the workspace root', async () => {
		const res = (await tool('workspace_delete').execute({ path: '.' })) as { ok: boolean }
		expect(res.ok).toBe(false)
		expect(await projects.get('proj')).not.toBeNull()
	})

	it('leaves ordinary scratch work alone', async () => {
		const write = (await tool('workspace_write').execute({
			path: 'proj/notes/draft.md',
			content: '# draft',
		})) as { ok: boolean }
		expect(write.ok).toBe(true)

		const read = (await tool('workspace_read').execute({ path: 'proj/notes/draft.md' })) as {
			ok: boolean
			content?: string
		}
		expect(read.content).toBe('# draft')

		const del = (await tool('workspace_delete').execute({ path: 'proj/notes' })) as { ok: boolean }
		expect(del.ok).toBe(true)
		// The project itself is untouched by scratch churn inside it.
		expect(await projects.get('proj')).not.toBeNull()
	})

	it('still allows reading a manifest', async () => {
		const read = (await tool('workspace_read').execute({ path: 'proj/.project.json' })) as {
			ok: boolean
			content?: string
		}
		expect(read.ok).toBe(true)
		expect(read.content).toContain('"id": "proj"')
	})
})
