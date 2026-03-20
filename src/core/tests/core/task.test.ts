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
	})
})
