import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessageBus } from '../../src/core/bus.js'
import { SchedulerStore } from '../../src/core/scheduler.js'
import { TaskQueue } from '../../src/core/task.js'
import { Vault } from '../../src/core/vault.js'
import { createCoreTools } from '../../src/tool/core-tools.js'
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
		expect(names).toContain('spawn_agent')
		expect(names).toContain('get_agent_result')
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

	describe('spawn_agent', () => {
		it('creates a task with source agent and returns task_id', async () => {
			const tool = findTool('spawn_agent')

			// Simulate a running non-agent task (the "parent")
			// We need to put a user-source task into "running" state
			let resolveRunner: () => void
			const runnerPromise = new Promise<void>((resolve) => {
				resolveRunner = resolve
			})
			taskQueue.setRunner(async () => {
				await runnerPromise
			})
			const parentTask = taskQueue.enqueue('parent task', 'user')

			// Let the drain loop pick up the task
			await new Promise((r) => setTimeout(r, 10))

			const result = (await tool.execute({
				task: 'do sub-work',
				max_iterations: 5,
			})) as any
			expect(result.ok).toBe(true)
			expect(result.task_id).toBeTypeOf('string')
			expect(result.status).toBe('queued')

			// Verify the enqueued task has source 'agent' and parentTaskId
			const agentTask = taskQueue.get(result.task_id)
			expect(agentTask).toBeDefined()
			expect(agentTask!.source).toBe('agent')
			expect(agentTask!.parentTaskId).toBe(parentTask.id)

			resolveRunner!()
		})

		it('rejects recursion when caller is already a sub-agent', async () => {
			const tool = findTool('spawn_agent')

			// Simulate a running agent-source task
			let resolveRunner: () => void
			const runnerPromise = new Promise<void>((resolve) => {
				resolveRunner = resolve
			})
			taskQueue.setRunner(async () => {
				await runnerPromise
			})
			taskQueue.enqueue('agent task', 'agent', {
				metadata: { agentDepth: 2 },
			})

			// Let the drain loop pick up the task
			await new Promise((r) => setTimeout(r, 10))

			const result = (await tool.execute({
				task: 'nested sub-work',
				max_iterations: 5,
			})) as any
			expect(result.ok).toBe(false)
			expect(result.error).toMatch(/max agent spawn depth/i)

			resolveRunner!()
		})
	})

	describe('get_agent_result', () => {
		it('returns queued for a queued task', async () => {
			const tool = findTool('get_agent_result')

			// Enqueue an agent task (no runner set, so it stays queued)
			const agentTask = taskQueue.enqueue('sub-task', 'agent')

			const result = (await tool.execute({ task_id: agentTask.id })) as any
			expect(result.ok).toBe(true)
			expect(result.status).toBe('queued')
		})

		it('returns completed with result for a completed task', async () => {
			const tool = findTool('get_agent_result')

			// Set up a runner that completes immediately and sets a result
			taskQueue.setRunner(async (task) => {
				task.result = 'done with sub-work'
			})
			const agentTask = taskQueue.enqueue('sub-task', 'agent')

			// Wait for the task to complete
			await new Promise((r) => setTimeout(r, 50))

			const result = (await tool.execute({ task_id: agentTask.id })) as any
			expect(result.ok).toBe(true)
			expect(result.status).toBe('completed')
			expect(result.result).toBe('done with sub-work')
		})

		it('returns not found for unknown task_id', async () => {
			const tool = findTool('get_agent_result')

			const result = (await tool.execute({
				task_id: 'nonexistent-id',
			})) as any
			expect(result.ok).toBe(false)
			expect(result.error).toMatch(/not found/i)
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

describe('skill basePath + skill_run_script', () => {
	let tmpDir: string
	let skillDir: string
	let tools: ToolDefinition[]
	let scheduler: SchedulerStore
	let taskQueue: TaskQueue
	let vault: Vault
	// biome-ignore lint/suspicious/noExplicitAny: test mock registry
	let skillRegistry: any

	const makeSkill = (over: Record<string, unknown> = {}) => ({
		name: 'demo',
		path: skillDir,
		active: true,
		missingTools: [],
		definition: {
			name: 'demo',
			description: 'd',
			requiredTools: [],
			optionalTools: [],
			instructions: 'body',
			tags: [],
			requires: { env: [], bins: [], anyBins: [] },
		},
		...over,
	})

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-skillscript-test-'))
		skillDir = path.join(tmpDir, 'skills', 'demo')
		await fs.mkdir(path.join(skillDir, 'scripts'), { recursive: true })
		await fs.writeFile(
			path.join(skillDir, 'SKILL.md'),
			'---\nname: demo\ndescription: d\n---\nbody',
		)
		await fs.writeFile(
			path.join(skillDir, 'scripts', 'echo.js'),
			"process.stdout.write('hi:' + process.argv.slice(2).join(','))",
		)

		const bus = createMessageBus()
		scheduler = new SchedulerStore()
		taskQueue = new TaskQueue(bus)
		vault = new Vault(path.join(tmpDir, 'vault.json'))
		await vault.init()

		skillRegistry = {
			get: vi.fn(() => makeSkill()),
			list: vi.fn(() => []),
			active: vi.fn(() => []),
			load: vi.fn(async () => true),
			unload: vi.fn(() => true),
			resolve: vi.fn(),
		}
		tools = createCoreTools(scheduler, taskQueue, tmpDir, skillRegistry, vault)
	})

	afterEach(async () => {
		scheduler.clearAll()
		await fs.rm(tmpDir, { recursive: true, force: true })
		Reflect.deleteProperty(process.env, 'VOLE_TEST_SECRET')
		Reflect.deleteProperty(process.env, 'VOLE_TEST_DECLARED')
	})

	const run = (name: string, args: unknown) =>
		// biome-ignore lint/suspicious/noExplicitAny: test helper
		tools.find((t) => t.name === name)!.execute(args) as Promise<any>

	it('skill_read returns the skill basePath', async () => {
		const res = await run('skill_read', { name: 'demo' })
		expect(res.ok).toBe(true)
		expect(res.basePath).toBe(skillDir)
	})

	it('skill_read_reference returns basePath and confines to references/', async () => {
		await fs.mkdir(path.join(skillDir, 'references'), { recursive: true })
		await fs.writeFile(path.join(skillDir, 'references', 'api.md'), 'docs')
		const ok = await run('skill_read_reference', { name: 'demo', file: 'api.md' })
		expect(ok.ok).toBe(true)
		expect(ok.basePath).toBe(skillDir)
		expect(ok.content).toBe('docs')
		// A sibling dir whose name starts with "references" must not be reachable.
		await fs.mkdir(path.join(skillDir, 'references-private'), { recursive: true })
		await fs.writeFile(path.join(skillDir, 'references-private', 'secret.md'), 's')
		const esc = await run('skill_read_reference', {
			name: 'demo',
			file: '../references-private/secret.md',
		})
		expect(esc.ok).toBe(false)
	})

	it('skill_list_files returns basePath + relative paths', async () => {
		const res = await run('skill_list_files', { name: 'demo' })
		expect(res.ok).toBe(true)
		expect(res.basePath).toBe(skillDir)
		expect(res.files).toContain('scripts/echo.js')
		expect(res.files).toContain('SKILL.md')
	})

	it('skill_run_script executes a bundled node script with args', async () => {
		const res = await run('skill_run_script', {
			name: 'demo',
			script: 'scripts/echo.js',
			args: ['a', 'b'],
		})
		expect(res.ok).toBe(true)
		expect(res.exitCode).toBe(0)
		expect(res.interpreter).toBe('node')
		expect(res.stdout).toBe('hi:a,b')
	})

	it('skill_run_script scopes env to requires.env + baseline (no secret leak)', async () => {
		process.env.VOLE_TEST_SECRET = 'leak'
		process.env.VOLE_TEST_DECLARED = 'ok'
		skillRegistry.get.mockReturnValue(
			makeSkill({
				definition: {
					...makeSkill().definition,
					requires: { env: ['VOLE_TEST_DECLARED'], bins: [], anyBins: [] },
				},
			}),
		)
		await fs.writeFile(
			path.join(skillDir, 'scripts', 'env.js'),
			"process.stdout.write((process.env.VOLE_TEST_SECRET ?? 'undefined') + '|' + (process.env.VOLE_TEST_DECLARED ?? 'undefined'))",
		)
		const res = await run('skill_run_script', { name: 'demo', script: 'scripts/env.js' })
		expect(res.ok).toBe(true)
		// Undeclared secret must not leak into the child; the declared var is passed through.
		expect(res.stdout).toBe('undefined|ok')
	})

	it('skill_run_script refuses to run scripts of an inactive skill', async () => {
		skillRegistry.get.mockReturnValue(makeSkill({ active: false, missingTools: ['env:API_KEY'] }))
		const res = await run('skill_run_script', { name: 'demo', script: 'scripts/echo.js' })
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/inactive/)
	})

	it('skill_run_script blocks path traversal out of the skill dir', async () => {
		const res = await run('skill_run_script', { name: 'demo', script: '../../evil.js' })
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/inside the skill directory/)
	})

	it('skill_run_script rejects an unsupported extension', async () => {
		await fs.writeFile(path.join(skillDir, 'data.txt'), 'x')
		const res = await run('skill_run_script', { name: 'demo', script: 'data.txt' })
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/Unsupported script type/)
	})

	it('skill_run_script errors on a missing script', async () => {
		const res = await run('skill_run_script', { name: 'demo', script: 'scripts/nope.js' })
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/not found/i)
	})
})
