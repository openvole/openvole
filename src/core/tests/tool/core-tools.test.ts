import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createCoreTools } from '../../src/tool/core-tools.js'
import { SchedulerStore } from '../../src/core/scheduler.js'
import { TaskQueue } from '../../src/core/task.js'
import { Vault } from '../../src/core/vault.js'
import { createMessageBus } from '../../src/core/bus.js'
import type { ToolDefinition } from '../../src/tool/types.js'

// Minimal SkillRegistry mock
function createMockSkillRegistry() {
	return {
		get: vi.fn(() => undefined),
		list: vi.fn(() => []),
		active: vi.fn(() => []),
		load: vi.fn(async () => true),
		unload: vi.fn(() => true),
		resolve: vi.fn(),
	} as any
}

describe('createCoreTools', () => {
	let tmpDir: string
	let tools: ToolDefinition[]
	let scheduler: SchedulerStore
	let taskQueue: TaskQueue
	let vault: Vault

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-coretools-test-'))
		const bus = createMessageBus()
		scheduler = new SchedulerStore()
		taskQueue = new TaskQueue(bus)
		vault = new Vault(path.join(tmpDir, 'vault.json'))
		await vault.init()

		tools = createCoreTools(scheduler, taskQueue, tmpDir, createMockSkillRegistry(), vault)
	})

	afterEach(async () => {
		scheduler.clearAll()
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	function findTool(name: string): ToolDefinition {
		const tool = tools.find((t) => t.name === name)
		if (!tool) throw new Error(`Tool "${name}" not found`)
		return tool
	}

	it('returns all expected tools', () => {
		const names = tools.map((t) => t.name)
		expect(names).toContain('schedule_task')
		expect(names).toContain('cancel_schedule')
		expect(names).toContain('list_schedules')
		expect(names).toContain('heartbeat_read')
		expect(names).toContain('heartbeat_write')
		expect(names).toContain('skill_read')
		expect(names).toContain('skill_read_reference')
		expect(names).toContain('skill_list_files')
		expect(names).toContain('workspace_write')
		expect(names).toContain('workspace_read')
		expect(names).toContain('workspace_list')
		expect(names).toContain('workspace_delete')
		expect(names).toContain('vault_store')
		expect(names).toContain('vault_get')
		expect(names).toContain('vault_list')
		expect(names).toContain('vault_delete')
		expect(names).toContain('web_fetch')
	})

	it('each tool has name, description, parameters, execute', () => {
		for (const tool of tools) {
			expect(tool.name).toBeTypeOf('string')
			expect(tool.description).toBeTypeOf('string')
			expect(tool.parameters).toBeDefined()
			expect(tool.execute).toBeTypeOf('function')
		}
	})

	describe('web_fetch', () => {
		it('fetches a URL (mock fetch)', async () => {
			const originalFetch = globalThis.fetch
			globalThis.fetch = vi.fn(async () => ({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'application/json' }),
				text: async () => '{"data": "hello"}',
			})) as any

			const tool = findTool('web_fetch')
			const result = (await tool.execute({ url: 'https://example.com/api' })) as any
			expect(result.ok).toBe(true)
			expect(result.status).toBe(200)
			expect(result.content).toBe('{"data": "hello"}')

			globalThis.fetch = originalFetch
		})
	})

	describe('workspace tools', () => {
		it('workspace_write + workspace_read round-trips', async () => {
			const write = findTool('workspace_write')
			const read = findTool('workspace_read')

			const writeResult = (await write.execute({ path: 'test.txt', content: 'hello world' })) as any
			expect(writeResult.ok).toBe(true)

			const readResult = (await read.execute({ path: 'test.txt' })) as any
			expect(readResult.ok).toBe(true)
			expect(readResult.content).toBe('hello world')
		})

		it('workspace_list lists files', async () => {
			const write = findTool('workspace_write')
			const list = findTool('workspace_list')

			await write.execute({ path: 'file-a.txt', content: 'a' })
			await write.execute({ path: 'sub/file-b.txt', content: 'b' })

			const result = (await list.execute({})) as any
			expect(result.ok).toBe(true)
			const paths = result.files.map((f: any) => f.path)
			expect(paths).toContain('file-a.txt')
			expect(paths).toContain('sub')
			expect(paths).toContain('sub/file-b.txt')
		})

		it('workspace_delete removes files', async () => {
			const write = findTool('workspace_write')
			const del = findTool('workspace_delete')
			const read = findTool('workspace_read')

			await write.execute({ path: 'to-delete.txt', content: 'bye' })
			const delResult = (await del.execute({ path: 'to-delete.txt' })) as any
			expect(delResult.ok).toBe(true)

			const readResult = (await read.execute({ path: 'to-delete.txt' })) as any
			expect(readResult.ok).toBe(false)
		})

		it('rejects path traversal with ../', async () => {
			const write = findTool('workspace_write')
			const result = (await write.execute({ path: '../../../etc/passwd', content: 'bad' })) as any
			expect(result.ok).toBe(false)
			expect(result.error).toMatch(/must stay inside workspace/i)
		})

		it('workspace_read rejects path traversal', async () => {
			const read = findTool('workspace_read')
			const result = (await read.execute({ path: '../../secret.txt' })) as any
			expect(result.ok).toBe(false)
			expect(result.error).toMatch(/must stay inside workspace/i)
		})

		it('workspace_delete rejects path traversal', async () => {
			const del = findTool('workspace_delete')
			const result = (await del.execute({ path: '../../../etc/passwd' })) as any
			expect(result.ok).toBe(false)
			expect(result.error).toMatch(/must stay inside workspace/i)
		})
	})
})
