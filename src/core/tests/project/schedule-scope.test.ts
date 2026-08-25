import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SchedulerStore } from '../../src/core/scheduler.js'

/**
 * A schedule can be scoped to a project, which is what turns the heartbeat from "wake up and do
 * something" into "pick up this project's queued work".
 *
 * The scope has to survive persistence: schedules are rebuilt from disk on every start, so a
 * projectId that failed to round-trip would silently downgrade a scoped schedule back to the
 * aimless kind — working after `vole schedule add`, broken after the next restart, and hard to
 * notice either way. These tests go through restore() and fire the restored job rather than
 * calling the handler directly, so it is the production path under test.
 */

describe('schedule project scope', () => {
	let dir: string
	let file: string
	let scheduler: SchedulerStore

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-sched-scope-'))
		file = path.join(dir, 'schedules.json')
		scheduler = new SchedulerStore()
		scheduler.setPersistence(file)
		scheduler.setTickHandler(() => {})
	})

	afterEach(async () => {
		scheduler.clearAll()
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('a restored scoped schedule ticks with its projectId', async () => {
		scheduler.add(
			'nightly',
			'pick up the next queued task',
			'0 3 * * *',
			() => {},
			undefined,
			false,
			'openvole',
		)
		await new Promise((r) => setTimeout(r, 50))

		const restored = new SchedulerStore()
		restored.setPersistence(file)
		const ticks: Array<{ input: string; projectId?: string }> = []
		restored.setTickHandler((input, opts) => ticks.push({ input, projectId: opts?.projectId }))
		await restored.restore()

		expect(restored.trigger('nightly')).toBe(true)
		expect(ticks).toEqual([{ input: 'pick up the next queued task', projectId: 'openvole' }])
		restored.clearAll()
	})

	it('a restored unscoped schedule ticks with no project — existing schedules are unchanged', async () => {
		scheduler.add('legacy', 'do the usual', '0 5 * * *', () => {})
		await new Promise((r) => setTimeout(r, 50))

		const restored = new SchedulerStore()
		restored.setPersistence(file)
		const ticks: Array<string | undefined> = []
		restored.setTickHandler((_input, opts) => ticks.push(opts?.projectId))
		await restored.restore()

		restored.trigger('legacy')
		expect(ticks).toEqual([undefined])
		expect(restored.list().find((s) => s.id === 'legacy')).not.toHaveProperty('projectId')
		restored.clearAll()
	})

	it('exposes projectId on list() and persists it', async () => {
		scheduler.add('scoped', 'work the repo', '0 3 * * *', () => {}, undefined, false, 'openvole')
		scheduler.add('plain', 'general check-in', '0 4 * * *', () => {})
		await new Promise((r) => setTimeout(r, 50))

		const list = scheduler.list()
		expect(list.find((s) => s.id === 'scoped')?.projectId).toBe('openvole')
		expect(list.find((s) => s.id === 'plain')?.projectId).toBeUndefined()

		const onDisk = JSON.parse(await fs.readFile(file, 'utf-8')) as Array<Record<string, unknown>>
		expect(onDisk.find((s) => s.id === 'scoped')?.projectId).toBe('openvole')
		expect(onDisk.find((s) => s.id === 'plain')).not.toHaveProperty('projectId')
	})

	it('trigger() reports an unknown schedule instead of throwing', () => {
		expect(scheduler.trigger('nope')).toBe(false)
	})
})
