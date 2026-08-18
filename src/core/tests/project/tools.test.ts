import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../../src/project/store.js'
import { TaskStore } from '../../src/project/tasks.js'
import { createProjectTools } from '../../src/project/tools.js'
import type { ToolDefinition } from '../../src/tool/types.js'

/**
 * The tools are the whole point of phase 2: an agent that can set up its own work is an agent
 * whose human never edits AGENT.md to change the assignment.
 *
 * Two things are tested harder than the happy paths. Tool failures must come back as `{ok:false}`
 * results the brain can read and recover from, never thrown exceptions that kill the run — a
 * refused root or an illegal transition is information, not a crash. And the sandbox boundary has
 * to hold through the tool surface exactly as it does through the store, since the tools are what
 * the agent actually reaches.
 */

describe('project and task tools', () => {
	let dir: string
	let agentRoot: string
	let granted: string
	let outside: string
	let tools: ToolDefinition[]
	let projects: ProjectStore

	const tool = (name: string) => {
		const found = tools.find((t) => t.name === name)
		if (!found) throw new Error(`no tool named ${name}`)
		return found
	}
	const call = (name: string, params: Record<string, unknown>) =>
		tool(name).execute(params) as Promise<Record<string, unknown>>

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-ptools-'))
		agentRoot = path.join(dir, 'agent')
		granted = path.join(dir, 'granted')
		// Outside the agent root AND outside every granted path — the agent root is always
		// allowed (the workspace lives in it), so a sibling of it is the real "denied" case.
		outside = path.join(dir, 'outside')
		await fs.mkdir(agentRoot, { recursive: true })
		await fs.mkdir(granted, { recursive: true })
		await fs.mkdir(outside, { recursive: true })

		projects = new ProjectStore(path.join(agentRoot, '.openvole', 'workspace'), {
			agentRoot,
			allowedPaths: [granted],
		})
		await projects.init()
		tools = createProjectTools({ projects, tasks: new TaskStore(projects) })
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('registers exactly the fifteen tools', () => {
		expect(tools.map((t) => t.name).sort()).toEqual(
			[
				'project_archive',
				'project_create',
				'project_file_delete',
				'project_file_list',
				'project_file_move',
				'project_file_read',
				'project_file_write',
				'project_list',
				'project_open',
				'project_scan',
				'project_update',
				'task_create',
				'task_list',
				'task_next',
				'task_update',
			].sort(),
		)
	})

	it('runs the setup flow end to end: scan → create → task', async () => {
		await fs.writeFile(
			path.join(granted, 'package.json'),
			JSON.stringify({ name: 'thing', devDependencies: { vitest: '^4' } }),
			'utf-8',
		)

		const scan = await call('project_scan', { root: granted })
		expect(scan.ok).toBe(true)
		expect(scan.kind).toBe('code')

		const created = await call('project_create', {
			id: 'thing',
			name: 'Thing',
			kind: 'code',
			root: granted,
			context: '# Thing\n\nBuilt with vitest.',
			stack: scan.stack as string[],
		})
		expect(created.ok).toBe(true)

		const task = await call('task_create', {
			projectId: 'thing',
			goal: 'Get the suite green',
			doneCriteria: ['vitest run exits 0'],
		})
		expect(task.ok).toBe(true)

		const opened = await call('project_open', { id: 'thing' })
		expect(opened.context).toContain('Built with vitest')
		expect((opened.tasks as unknown[]).length).toBe(1)
	})

	it('returns a readable error instead of throwing when a root is refused', async () => {
		const created = await call('project_create', { id: 'sneaky', root: outside })
		expect(created.ok).toBe(false)
		expect(created.error).toContain('security.allowedPaths')

		const scanned = await call('project_scan', { root: '/etc' })
		expect(scanned.ok).toBe(false)

		// And nothing was created on the way to failing.
		expect(await projects.list()).toEqual([])
	})

	it('returns a readable error for a bad id or a duplicate', async () => {
		expect((await call('project_create', { id: '../evil' })).ok).toBe(false)
		expect((await call('project_create', { id: 'ok' })).ok).toBe(true)
		const dup = await call('project_create', { id: 'ok' })
		expect(dup.ok).toBe(false)
		expect(dup.error).toContain('already exists')
	})

	it('lists, updates and archives', async () => {
		await call('project_create', { id: 'alpha', kind: 'writing' })
		await call('project_create', { id: 'beta' })

		expect((await call('project_list', {})).count).toBe(2)

		const updated = await call('project_update', {
			id: 'alpha',
			name: 'Alpha Renamed',
			context: '# Alpha\n\nrewritten',
		})
		expect(updated.ok).toBe(true)
		expect((await call('project_open', { id: 'alpha' })).context).toContain('rewritten')
		expect(((await call('project_open', { id: 'alpha' })).project as { name: string }).name).toBe(
			'Alpha Renamed',
		)

		await call('project_archive', { id: 'beta' })
		expect((await call('project_list', {})).count).toBe(1)
		expect((await call('project_list', { status: 'all' })).count).toBe(2)
	})

	it('project_update can rewrite only CONTEXT.md', async () => {
		await call('project_create', { id: 'ctx', name: 'Keep' })
		const res = await call('project_update', { id: 'ctx', context: 'just the context' })
		expect(res.ok).toBe(true)
		expect((res.project as { name: string }).name).toBe('Keep')
		expect((await call('project_open', { id: 'ctx' })).context).toBe('just the context')
	})

	it('walks a task through its lifecycle and refuses illegal jumps as a result', async () => {
		await call('project_create', { id: 'p' })
		const created = await call('task_create', {
			projectId: 'p',
			goal: 'ship it',
			doneCriteria: ['tests pass'],
		})
		const taskId = (created.task as { id: string }).id

		const jump = await call('task_update', { projectId: 'p', taskId, state: 'done' })
		expect(jump.ok).toBe(false)
		expect(jump.error).toContain('illegal transition')

		expect((await call('task_update', { projectId: 'p', taskId, state: 'running' })).ok).toBe(true)
		expect((await call('task_update', { projectId: 'p', taskId, state: 'verifying' })).ok).toBe(
			true,
		)
		const done = await call('task_update', { projectId: 'p', taskId, state: 'done' })
		expect(done.ok).toBe(true)
	})

	it('blocking records the reason for the human', async () => {
		await call('project_create', { id: 'p' })
		const created = await call('task_create', {
			projectId: 'p',
			goal: 'g',
			doneCriteria: ['green'],
		})
		const taskId = (created.task as { id: string }).id

		await call('task_update', { projectId: 'p', taskId, state: 'running' })
		await call('task_update', { projectId: 'p', taskId, state: 'verifying' })
		const blocked = await call('task_update', {
			projectId: 'p',
			taskId,
			state: 'blocked',
			note: 'suite red: 2 failures',
		})
		expect((blocked.task as { note: string }).note).toContain('2 failures')
	})

	it('task_next returns the top of the queue with its project, and claims nothing', async () => {
		await call('project_create', { id: 'p', root: granted })
		await call('task_create', { projectId: 'p', goal: 'low', priority: 0 })
		await call('task_create', { projectId: 'p', goal: 'high', priority: 9 })

		const next = await call('task_next', {})
		expect((next.task as { goal: string }).goal).toBe('high')
		expect((next.project as { root: string }).root).toBe(await fs.realpath(granted))
		// Still queued — reading the queue is not taking from it.
		expect((next.task as { state: string }).state).toBe('queued')
	})

	it('task_next reports an empty queue plainly', async () => {
		await call('project_create', { id: 'p' })
		const next = await call('task_next', {})
		expect(next.ok).toBe(true)
		expect(next.task).toBeNull()
	})

	it('task_list defaults to open work and can widen', async () => {
		await call('project_create', { id: 'p' })
		const a = await call('task_create', { projectId: 'p', goal: 'a' })
		await call('task_create', { projectId: 'p', goal: 'b' })
		const aId = (a.task as { id: string }).id
		await call('task_update', { projectId: 'p', taskId: aId, state: 'cancelled' })

		expect((await call('task_list', {})).count).toBe(1)
		expect((await call('task_list', { state: 'all' })).count).toBe(2)
		expect((await call('task_list', { state: 'cancelled' })).count).toBe(1)
	})

	it('names the missing thing rather than failing vaguely', async () => {
		expect((await call('project_open', { id: 'ghost' })).error).toContain('ghost')
		expect((await call('task_create', { projectId: 'ghost', goal: 'x' })).error).toContain('ghost')
		await call('project_create', { id: 'p' })
		expect(
			(await call('task_update', { projectId: 'p', taskId: 't_nope', state: 'running' })).error,
		).toContain('t_nope')
	})

	it('task_update tells the agent which moves are legal', () => {
		expect(tool('task_update').description).toContain('running → verifying')
		expect(tool('task_update').description).toMatch(/verifying/)
	})
})
