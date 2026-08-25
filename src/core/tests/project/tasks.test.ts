import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../../src/project/store.js'
import { TaskStore } from '../../src/project/tasks.js'
import { ProjectError } from '../../src/project/types.js'

/**
 * Tasks are an append-only JSONL log with last-line-wins per id, so the file is also the audit
 * trail. The load-bearing property is the state machine: a task must not reach `done` without
 * passing through `verifying`, because "the agent said it finished" with no verification step is
 * exactly the failure this feature exists to fix. Budget exhaustion has to *block* (recoverable,
 * visible) rather than silently truncate.
 */

describe('TaskStore', () => {
	let dir: string
	let projects: ProjectStore
	let tasks: TaskStore

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-tasks-'))
		const workspace = path.join(dir, '.openvole', 'workspace')
		projects = new ProjectStore(workspace, { agentRoot: dir })
		await projects.init()
		tasks = new TaskStore(projects)
		await projects.create({ id: 'proj' })
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('creates a queued task and reads it back', async () => {
		const task = await tasks.create({
			projectId: 'proj',
			goal: 'Port paw-database off better-sqlite3',
			doneCriteria: ['tests pass', 'no better-sqlite3 in package.json'],
		})
		expect(task.state).toBe('queued')
		expect(task.doneCriteria).toHaveLength(2)

		const read = await tasks.get('proj', task.id)
		expect(read?.goal).toContain('better-sqlite3')
	})

	it('refuses an empty goal or an unknown project', async () => {
		await expect(tasks.create({ projectId: 'proj', goal: '   ' })).rejects.toThrow(ProjectError)
		await expect(tasks.create({ projectId: 'ghost', goal: 'x' })).rejects.toThrow(/no such project/)
	})

	it('appends every change — the file is the history, last line wins', async () => {
		const task = await tasks.create({ projectId: 'proj', goal: 'g' })
		await tasks.update('proj', task.id, { state: 'running' })
		await tasks.update('proj', task.id, { state: 'verifying' })
		await tasks.update('proj', task.id, { state: 'done' })

		const raw = await fs.readFile(
			path.join(dir, '.openvole', 'workspace', 'proj', 'tasks.jsonl'),
			'utf-8',
		)
		const lines = raw.trim().split('\n')
		expect(lines).toHaveLength(4)
		expect(JSON.parse(lines[0]).state).toBe('queued')

		// Reading collapses to the newest line per id.
		expect((await tasks.get('proj', task.id))?.state).toBe('done')
		expect(await tasks.list({ projectId: 'proj', state: 'all' })).toHaveLength(1)
	})

	it('walks the happy path and refuses illegal transitions', async () => {
		const task = await tasks.create({ projectId: 'proj', goal: 'g' })

		// The point of the machine: queued cannot jump straight to done.
		await expect(tasks.update('proj', task.id, { state: 'done' })).rejects.toThrow(
			/illegal transition queued → done/,
		)

		await tasks.update('proj', task.id, { state: 'running' })
		await expect(tasks.update('proj', task.id, { state: 'done' })).rejects.toThrow(
			/illegal transition running → done/,
		)

		await tasks.update('proj', task.id, { state: 'verifying' })
		const done = await tasks.update('proj', task.id, { state: 'done' })
		expect(done.state).toBe('done')
	})

	it('unmet criteria block instead of completing', async () => {
		const task = await tasks.create({
			projectId: 'proj',
			goal: 'g',
			doneCriteria: ['the suite is green'],
		})
		await tasks.update('proj', task.id, { state: 'running' })
		await tasks.update('proj', task.id, { state: 'verifying' })
		const blocked = await tasks.update('proj', task.id, {
			state: 'blocked',
			note: 'suite red: 2 failures in net/files',
		})

		expect(blocked.state).toBe('blocked')
		expect(blocked.note).toContain('2 failures')
		// And blocked is recoverable, which is what makes it different from failed.
		await expect(tasks.update('proj', task.id, { state: 'queued' })).resolves.toBeTruthy()
	})

	it('treats done and cancelled as terminal, failed as retryable', async () => {
		const a = await tasks.create({ projectId: 'proj', goal: 'a' })
		await tasks.update('proj', a.id, { state: 'running' })
		await tasks.update('proj', a.id, { state: 'verifying' })
		await tasks.update('proj', a.id, { state: 'done' })
		await expect(tasks.update('proj', a.id, { state: 'running' })).rejects.toThrow(/terminal/)

		const b = await tasks.create({ projectId: 'proj', goal: 'b' })
		await tasks.update('proj', b.id, { state: 'running' })
		await tasks.update('proj', b.id, { state: 'failed' })
		await expect(tasks.update('proj', b.id, { state: 'queued' })).resolves.toBeTruthy()
	})

	it('budget exhaustion blocks with a reason rather than truncating', async () => {
		const task = await tasks.create({
			projectId: 'proj',
			goal: 'g',
			budget: { maxIterations: 10 },
		})
		await tasks.update('proj', task.id, { state: 'running' })

		const first = await tasks.chargeIterations('proj', task.id, 6)
		expect(first.exhausted).toBe(false)
		expect(first.task.state).toBe('running')

		const second = await tasks.chargeIterations('proj', task.id, 6)
		expect(second.exhausted).toBe(true)
		expect(second.task.state).toBe('blocked')
		expect(second.task.note).toMatch(/budget exhausted — 12\/10/)
	})

	it('a passed deadline blocks too', async () => {
		const task = await tasks.create({
			projectId: 'proj',
			goal: 'g',
			budget: { deadline: Date.now() - 1000 },
		})
		await tasks.update('proj', task.id, { state: 'running' })

		const charged = await tasks.chargeIterations('proj', task.id, 1)
		expect(charged.exhausted).toBe(true)
		expect(charged.task.note).toContain('deadline')
	})

	it('next() returns highest priority, oldest first, active projects only', async () => {
		await projects.create({ id: 'paused-proj' })
		await projects.update('paused-proj', { status: 'paused' })

		const low = await tasks.create({ projectId: 'proj', goal: 'low', priority: 0 })
		const high = await tasks.create({ projectId: 'proj', goal: 'high', priority: 5 })
		await tasks.create({ projectId: 'paused-proj', goal: 'paused work', priority: 99 })

		expect((await tasks.next())?.id).toBe(high.id)

		await tasks.update('proj', high.id, { state: 'running' })
		expect((await tasks.next())?.id).toBe(low.id)

		await tasks.update('proj', low.id, { state: 'running' })
		// The priority-99 task is in a paused project, so nothing is pickable.
		expect(await tasks.next()).toBeNull()
	})

	it('a torn trailing line costs one update, not the file', async () => {
		const task = await tasks.create({ projectId: 'proj', goal: 'survivor' })
		const file = path.join(dir, '.openvole', 'workspace', 'proj', 'tasks.jsonl')
		await fs.appendFile(file, '{"id":"t_torn","goal":"hal', 'utf-8')

		const list = await tasks.list({ projectId: 'proj', state: 'all' })
		expect(list.map((t) => t.id)).toEqual([task.id])
	})

	it('lists open tasks by default across all projects', async () => {
		await projects.create({ id: 'other' })
		const a = await tasks.create({ projectId: 'proj', goal: 'a' })
		await tasks.create({ projectId: 'other', goal: 'b' })
		await tasks.update('proj', a.id, { state: 'cancelled' })

		const open = await tasks.list()
		expect(open.map((t) => t.goal)).toEqual(['b'])
		expect(await tasks.list({ state: 'all' })).toHaveLength(2)
	})

	describe('history', () => {
		it('reconstructs the lifecycle from the log the store already writes', async () => {
			const task = await tasks.create({ projectId: 'proj', goal: 'Cut the episode' })
			await tasks.update('proj', task.id, { state: 'running' })
			await tasks.update('proj', task.id, { state: 'verifying' })
			await tasks.update('proj', task.id, { state: 'blocked', note: 'audio drifts at 6:00' })
			await tasks.update('proj', task.id, { state: 'queued' })
			await tasks.update('proj', task.id, { state: 'running' })

			const events = (await tasks.history('proj')).get(task.id)!
			// Newest first — what happened most recently is what you opened the card to find out.
			expect(events.map((e) => e.state)).toEqual([
				'running',
				'queued',
				'blocked',
				'verifying',
				'running',
				'queued',
			])
			expect(events[2]?.note).toBe('audio drifts at 6:00')
			// The creating record is the last entry, and its stamp is the task's createdAt.
			expect(events[events.length - 1]?.at).toBe(task.createdAt)
			// Monotonic going back in time.
			for (let i = 1; i < events.length; i++) {
				expect(events[i - 1].at).toBeGreaterThanOrEqual(events[i].at)
			}
		})

		it('ignores writes that moved no state', async () => {
			const task = await tasks.create({ projectId: 'proj', goal: 'Render' })
			await tasks.update('proj', task.id, { state: 'running' })
			// Charging iterations appends a full record per call; emitting one event each would
			// bury the moves that matter under dozens of identical lines.
			await tasks.chargeIterations('proj', task.id, 1)
			await tasks.chargeIterations('proj', task.id, 1)
			await tasks.chargeIterations('proj', task.id, 1)

			const events = (await tasks.history('proj')).get(task.id)!
			expect(events.map((e) => e.state)).toEqual(['running', 'queued'])
		})

		it('covers every task in the project and survives a torn line', async () => {
			const a = await tasks.create({ projectId: 'proj', goal: 'A' })
			const b = await tasks.create({ projectId: 'proj', goal: 'B' })
			await tasks.update('proj', b.id, { state: 'running' })

			const file = path.join(projects.dirFor('proj'), 'tasks.jsonl')
			await fs.appendFile(file, '{"id":"t_torn","state":\n', 'utf-8')

			const history = await tasks.history('proj')
			expect(history.get(a.id)?.map((e) => e.state)).toEqual(['queued'])
			expect(history.get(b.id)?.map((e) => e.state)).toEqual(['running', 'queued'])
			// A torn line must not take the file down with it — the list still reads.
			expect((await tasks.list({ projectId: 'proj', state: 'all' })).length).toBe(2)
		})

		it('is empty for a project that has never had a task', async () => {
			await projects.create({ id: 'fresh' })
			expect((await tasks.history('fresh')).size).toBe(0)
		})
	})
})
