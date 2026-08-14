import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../../src/core/system-prompt.js'
import { resolveProjectContext } from '../../src/project/context.js'
import { ProjectStore } from '../../src/project/store.js'
import { TaskStore } from '../../src/project/tasks.js'

/**
 * The join between storage and the prompt. Everything here is about scope arriving *with the
 * task*: the engine hands this function `task.metadata`, so two concurrently running tasks resolve
 * independently and neither can pick up the other's project.
 *
 * The degradation rules matter as much as the happy path — losing project context must never lose
 * the task, so an unknown project or a deleted work item runs unscoped instead of throwing.
 */

describe('resolveProjectContext', () => {
	let dir: string
	let projects: ProjectStore
	let tasks: TaskStore

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-resolve-'))
		projects = new ProjectStore(path.join(dir, '.openvole', 'workspace'), { agentRoot: dir })
		await projects.init()
		tasks = new TaskStore(projects)
		await projects.create({
			id: 'openvole',
			name: 'OpenVole',
			kind: 'code',
			context: '# OpenVole\n\nBiome uses tabs.',
		})
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('returns null when the task names no project', async () => {
		expect(await resolveProjectContext(projects, tasks, undefined)).toBeNull()
		expect(await resolveProjectContext(projects, tasks, {})).toBeNull()
		expect(await resolveProjectContext(projects, tasks, { projectId: '' })).toBeNull()
		// Metadata is untyped at the boundary — a non-string must not become a lookup.
		expect(await resolveProjectContext(projects, tasks, { projectId: 42 })).toBeNull()
	})

	it('resolves manifest plus CONTEXT.md', async () => {
		const info = await resolveProjectContext(projects, tasks, { projectId: 'openvole' })
		expect(info?.name).toBe('OpenVole')
		expect(info?.kind).toBe('code')
		expect(info?.context).toContain('Biome uses tabs')
		expect(info?.dir).toBe(path.join(dir, '.openvole', 'workspace', 'openvole'))
		expect(info?.task).toBeUndefined()
	})

	it('includes the work item when the task names one', async () => {
		const work = await tasks.create({
			projectId: 'openvole',
			goal: 'Port paw-database off better-sqlite3',
			doneCriteria: ['tests pass'],
		})

		const info = await resolveProjectContext(projects, tasks, {
			projectId: 'openvole',
			projectTaskId: work.id,
		})
		expect(info?.task?.goal).toContain('better-sqlite3')
		expect(info?.task?.doneCriteria).toEqual(['tests pass'])
	})

	it('runs unscoped rather than throwing when the project is gone', async () => {
		expect(await resolveProjectContext(projects, tasks, { projectId: 'deleted' })).toBeNull()
	})

	it('keeps the project when only the work item is missing', async () => {
		const info = await resolveProjectContext(projects, tasks, {
			projectId: 'openvole',
			projectTaskId: 't_gone',
		})
		expect(info?.id).toBe('openvole')
		expect(info?.task).toBeUndefined()
	})

	it('concurrent tasks in different projects never cross', async () => {
		await projects.create({
			id: 'nart',
			name: 'Nart Sagas',
			kind: 'writing',
			context: 'third-person past',
		})

		// Resolved in parallel, exactly as two interleaved tasks would.
		const [a, b] = await Promise.all([
			resolveProjectContext(projects, tasks, { projectId: 'openvole' }),
			resolveProjectContext(projects, tasks, { projectId: 'nart' }),
		])

		expect(a?.context).toContain('Biome')
		expect(b?.context).toContain('third-person')
		expect(a?.id).toBe('openvole')
		expect(b?.id).toBe('nart')
	})

	it('pulls the next queued task for a self-initiated run — this is what closes the scheduler loop', async () => {
		await tasks.create({ projectId: 'openvole', goal: 'low priority', priority: 0 })
		const urgent = await tasks.create({ projectId: 'openvole', goal: 'ship 4.17', priority: 5 })

		const pulled = await resolveProjectContext(
			projects,
			tasks,
			{ projectId: 'openvole' },
			{ autoSelectTask: true },
		)
		expect(pulled?.task?.id).toBe(urgent.id)
		expect(pulled?.task?.goal).toBe('ship 4.17')
	})

	it('selecting work does not claim it — a timer must never strand a task in running', async () => {
		const work = await tasks.create({ projectId: 'openvole', goal: 'ship 4.17' })
		await resolveProjectContext(
			projects,
			tasks,
			{ projectId: 'openvole' },
			{ autoSelectTask: true },
		)

		expect((await tasks.get('openvole', work.id))?.state).toBe('queued')
	})

	it('a chat turn never pulls work — the human message is the instruction', async () => {
		await tasks.create({ projectId: 'openvole', goal: 'unrelated queued work' })

		const chat = await resolveProjectContext(projects, tasks, { projectId: 'openvole' })
		expect(chat?.task).toBeUndefined()
		expect(chat?.context).toContain('Biome')
	})

	it('an explicit work item wins over auto-selection', async () => {
		await tasks.create({ projectId: 'openvole', goal: 'top of queue', priority: 9 })
		const chosen = await tasks.create({ projectId: 'openvole', goal: 'this one', priority: 0 })

		const info = await resolveProjectContext(
			projects,
			tasks,
			{ projectId: 'openvole', projectTaskId: chosen.id },
			{ autoSelectTask: true },
		)
		expect(info?.task?.goal).toBe('this one')
	})

	it('an empty queue still gives the agent its project', async () => {
		const info = await resolveProjectContext(
			projects,
			tasks,
			{ projectId: 'openvole' },
			{ autoSelectTask: true },
		)
		expect(info?.id).toBe('openvole')
		expect(info?.task).toBeUndefined()
	})

	it('reaches the system prompt end to end', async () => {
		const work = await tasks.create({
			projectId: 'openvole',
			goal: 'Ship 4.17',
			doneCriteria: ['changelog updated'],
		})
		const info = await resolveProjectContext(projects, tasks, {
			projectId: 'openvole',
			projectTaskId: work.id,
		})

		const prompt = buildSystemPrompt(
			{ brainPrompt: 'You are an agent.', identityContext: '', workspaceDir: '/ws' },
			[],
			[],
			{ project: info },
		)
		expect(prompt).toContain('## Current Project')
		expect(prompt).toContain('Ship 4.17')
		expect(prompt).toContain('changelog updated')
		expect(prompt).toContain('Biome uses tabs')
	})
})
