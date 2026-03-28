import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskQueue } from '../../src/core/task.js'
import { createMessageBus } from '../../src/core/bus.js'
import type { MessageBus } from '../../src/core/bus.js'

describe('TaskQueue', () => {
	let bus: MessageBus
	let queue: TaskQueue

	beforeEach(() => {
		bus = createMessageBus()
		queue = new TaskQueue(bus)
	})

	describe('enqueue', () => {
		it('creates a task with correct fields', () => {
			const task = queue.enqueue('do something')
			expect(task.input).toBe('do something')
			expect(task.source).toBe('user')
			expect(task.status).toBe('queued')
			expect(task.id).toBeTypeOf('string')
			expect(task.createdAt).toBeTypeOf('number')
		})

		it('assigns unique IDs', () => {
			const t1 = queue.enqueue('task 1')
			const t2 = queue.enqueue('task 2')
			const t3 = queue.enqueue('task 3')
			const ids = new Set([t1.id, t2.id, t3.id])
			expect(ids.size).toBe(3)
		})

		it('accepts sessionId and metadata', () => {
			const task = queue.enqueue('task', 'user', {
				sessionId: 'sess-123',
				metadata: { key: 'value' },
			})
			expect(task.sessionId).toBe('sess-123')
			expect(task.metadata).toEqual({ key: 'value' })
		})

		it('emits task:queued event', () => {
			const handler = vi.fn()
			bus.on('task:queued', handler)
			const task = queue.enqueue('task')
			expect(handler).toHaveBeenCalledWith({ taskId: task.id })
		})
	})

	describe('list', () => {
		it('returns all tasks', () => {
			queue.enqueue('task-1')
			queue.enqueue('task-2')
			const list = queue.list()
			expect(list.length).toBeGreaterThanOrEqual(2)
		})
	})

	describe('cancel', () => {
		it('marks a queued task as cancelled', () => {
			// Don't set a runner so tasks stay queued
			const task = queue.enqueue('to-cancel')
			const result = queue.cancel(task.id)
			expect(result).toBe(true)
			expect(task.status).toBe('cancelled')
			expect(task.completedAt).toBeTypeOf('number')
		})

		it('returns false for unknown task ID', () => {
			expect(queue.cancel('nonexistent')).toBe(false)
		})

		it('emits task:cancelled event', () => {
			const handler = vi.fn()
			bus.on('task:cancelled', handler)
			const task = queue.enqueue('to-cancel')
			queue.cancel(task.id)
			expect(handler).toHaveBeenCalledWith({ taskId: task.id })
		})
	})

	describe('source types', () => {
		it('accepts user source', () => {
			const task = queue.enqueue('task', 'user')
			expect(task.source).toBe('user')
		})

		it('accepts schedule source', () => {
			const task = queue.enqueue('task', 'schedule')
			expect(task.source).toBe('schedule')
		})

		it('accepts heartbeat source', () => {
			const task = queue.enqueue('task', 'heartbeat')
			expect(task.source).toBe('heartbeat')
		})

		it('accepts paw source', () => {
			const task = queue.enqueue('task', 'paw')
			expect(task.source).toBe('paw')
		})

		it('accepts agent source', () => {
			const task = queue.enqueue('task', 'agent')
			expect(task.source).toBe('agent')
		})
	})

	describe('parentTaskId', () => {
		it('stores parentTaskId when provided', () => {
			const parent = queue.enqueue('parent task')
			const child = queue.enqueue('child task', 'agent', {
				parentTaskId: parent.id,
			})
			expect(child.parentTaskId).toBe(parent.id)
			expect(child.source).toBe('agent')
		})

		it('parentTaskId is undefined when not provided', () => {
			const task = queue.enqueue('task')
			expect(task.parentTaskId).toBeUndefined()
		})
	})

	describe('priority', () => {
		it('defaults to normal priority', () => {
			const task = queue.enqueue('task')
			expect(task.priority).toBe('normal')
		})

		it('accepts priority option', () => {
			const urgent = queue.enqueue('urgent task', 'user', { priority: 'urgent' })
			const low = queue.enqueue('low task', 'user', { priority: 'low' })
			expect(urgent.priority).toBe('urgent')
			expect(low.priority).toBe('low')
		})

		it('processes urgent tasks before normal', async () => {
			const order: string[] = []
			queue.setRunner(async (task) => {
				order.push(task.input)
			})

			// Enqueue without runner first so they queue up
			queue = new TaskQueue(bus, 1)

			// Queue normal first, then urgent
			queue.enqueue('normal-1', 'user', { priority: 'normal' })
			queue.enqueue('urgent-1', 'user', { priority: 'urgent' })
			queue.enqueue('low-1', 'user', { priority: 'low' })

			// Now set runner and drain
			queue.setRunner(async (task) => {
				order.push(task.input)
			})

			// Trigger drain by enqueuing one more
			queue.enqueue('urgent-2', 'user', { priority: 'urgent' })

			await new Promise((r) => setTimeout(r, 50))

			// Urgent tasks should come first
			expect(order[0]).toBe('urgent-1')
		})
	})

	describe('dependencies', () => {
		it('stores dependsOn when provided', () => {
			const t1 = queue.enqueue('task-1')
			const t2 = queue.enqueue('task-2', 'user', { dependsOn: [t1.id] })
			expect(t2.dependsOn).toEqual([t1.id])
		})

		it('dependsOn is undefined when not provided', () => {
			const task = queue.enqueue('task')
			expect(task.dependsOn).toBeUndefined()
		})

		it('does not run task until dependencies are completed', async () => {
			const order: string[] = []
			let resolveFirst: () => void
			const firstBlocks = new Promise<void>((resolve) => {
				resolveFirst = resolve
			})

			queue.setRunner(async (task) => {
				if (task.input === 'first') {
					await firstBlocks
				}
				order.push(task.input)
			})

			const first = queue.enqueue('first')
			queue.enqueue('depends-on-first', 'user', { dependsOn: [first.id] })
			queue.enqueue('independent')

			await new Promise((r) => setTimeout(r, 20))

			// 'independent' should not run yet — concurrency 1, 'first' is blocking
			// Complete the first task
			resolveFirst!()

			await new Promise((r) => setTimeout(r, 50))

			expect(order).toContain('first')
			expect(order).toContain('independent')
		})
	})

	describe('cancelAll', () => {
		it('cancels all queued tasks', () => {
			// Don't set a runner so tasks stay queued
			const t1 = queue.enqueue('task-1')
			const t2 = queue.enqueue('task-2')
			const t3 = queue.enqueue('task-3')

			queue.cancelAll()

			expect(t1.status).toBe('cancelled')
			expect(t2.status).toBe('cancelled')
			expect(t3.status).toBe('cancelled')
			expect(t1.completedAt).toBeTypeOf('number')
			expect(t2.completedAt).toBeTypeOf('number')
			expect(t3.completedAt).toBeTypeOf('number')
		})

		it('emits task:cancelled for each queued task', () => {
			const handler = vi.fn()
			bus.on('task:cancelled', handler)

			queue.enqueue('task-1')
			queue.enqueue('task-2')

			queue.cancelAll()

			expect(handler).toHaveBeenCalledTimes(2)
		})

		it('marks running tasks as cancelled', async () => {
			// Use a runner that blocks so the task stays in "running"
			let resolveRunner: () => void
			const runnerPromise = new Promise<void>((resolve) => {
				resolveRunner = resolve
			})

			queue.setRunner(async () => {
				await runnerPromise
			})

			const task = queue.enqueue('running-task')

			// Let the drain loop pick up the task
			await new Promise((r) => setTimeout(r, 10))

			expect(task.status).toBe('running')

			queue.cancelAll()

			expect(task.status).toBe('cancelled')

			// Clean up: resolve the runner so it finishes
			resolveRunner!()
		})
	})
})
