import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SchedulerStore } from '../../src/core/scheduler.js'

describe('SchedulerStore', () => {
	let scheduler: SchedulerStore
	let tmpDir: string

	beforeEach(async () => {
		scheduler = new SchedulerStore()
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-scheduler-test-'))
	})

	afterEach(async () => {
		scheduler.clearAll()
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	describe('add', () => {
		it('creates a schedule', () => {
			const onTick = vi.fn()
			scheduler.add('test-1', 'do something', '*/5 * * * *', onTick)

			const list = scheduler.list()
			expect(list).toHaveLength(1)
			expect(list[0].id).toBe('test-1')
			expect(list[0].input).toBe('do something')
			expect(list[0].cron).toBe('*/5 * * * *')
			expect(list[0].nextRun).toBeDefined()
			expect(list[0].createdAt).toBeTypeOf('number')
		})

		it('replaces existing schedule with same ID', () => {
			const onTick1 = vi.fn()
			const onTick2 = vi.fn()
			scheduler.add('same-id', 'first', '*/5 * * * *', onTick1)
			scheduler.add('same-id', 'second', '0 13 * * *', onTick2)

			const list = scheduler.list()
			expect(list).toHaveLength(1)
			expect(list[0].input).toBe('second')
			expect(list[0].cron).toBe('0 13 * * *')
		})
	})

	describe('cancel', () => {
		it('removes a schedule', () => {
			scheduler.add('to-cancel', 'task', '*/5 * * * *', vi.fn())
			expect(scheduler.cancel('to-cancel')).toBe(true)
			expect(scheduler.list()).toHaveLength(0)
		})

		it('returns false for unknown ID', () => {
			expect(scheduler.cancel('nonexistent')).toBe(false)
		})
	})

	describe('list', () => {
		it('returns all schedules', () => {
			scheduler.add('s1', 'task 1', '*/5 * * * *', vi.fn())
			scheduler.add('s2', 'task 2', '0 9 * * 1', vi.fn())
			expect(scheduler.list()).toHaveLength(2)
		})
	})

	describe('clearAll', () => {
		it('removes everything', () => {
			scheduler.add('s1', 'task 1', '*/5 * * * *', vi.fn())
			scheduler.add('s2', 'task 2', '0 9 * * *', vi.fn())
			scheduler.clearAll()
			expect(scheduler.list()).toHaveLength(0)
		})
	})

	describe('persistence', () => {
		it('persist writes schedules to disk', async () => {
			const savePath = path.join(tmpDir, 'schedules.json')
			scheduler.setPersistence(savePath)

			scheduler.add('persist-1', 'persistent task', '*/10 * * * *', vi.fn())

			await new Promise((r) => setTimeout(r, 100))

			const raw = await fs.readFile(savePath, 'utf-8')
			const data = JSON.parse(raw)
			expect(data).toHaveLength(1)
			expect(data[0].id).toBe('persist-1')
			expect(data[0].cron).toBe('*/10 * * * *')
		})

		it('restore reads from disk and recreates schedules', async () => {
			const savePath = path.join(tmpDir, 'schedules.json')
			await fs.writeFile(
				savePath,
				JSON.stringify([{ id: 'restored-1', input: 'restored task', cron: '*/10 * * * *', createdAt: Date.now() }]),
			)

			const newScheduler = new SchedulerStore()
			newScheduler.setPersistence(savePath)
			newScheduler.setTickHandler(vi.fn())
			await newScheduler.restore()

			const list = newScheduler.list()
			expect(list).toHaveLength(1)
			expect(list[0].id).toBe('restored-1')
			expect(list[0].cron).toBe('*/10 * * * *')
			newScheduler.clearAll()
		})

		it('restore handles missing file gracefully', async () => {
			const savePath = path.join(tmpDir, 'nonexistent.json')
			scheduler.setPersistence(savePath)
			scheduler.setTickHandler(vi.fn())
			await scheduler.restore()
			expect(scheduler.list()).toHaveLength(0)
		})

		it('does not persist __heartbeat__ schedules', async () => {
			const savePath = path.join(tmpDir, 'schedules.json')
			scheduler.setPersistence(savePath)

			scheduler.add('__heartbeat__', 'heartbeat', '*/30 * * * *', vi.fn())
			await new Promise((r) => setTimeout(r, 50))
			scheduler.add('user-schedule', 'user task', '*/5 * * * *', vi.fn())

			await new Promise((r) => setTimeout(r, 100))

			const raw = await fs.readFile(savePath, 'utf-8')
			const data = JSON.parse(raw)
			expect(data).toHaveLength(1)
			expect(data[0].id).toBe('user-schedule')
		})
	})
})
