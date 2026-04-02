import { describe, expect, it, vi } from 'vitest'
import { createMessageBus } from '../../src/core/bus.js'

describe('createMessageBus', () => {
	it('returns a bus with emit and on methods', () => {
		const bus = createMessageBus()
		expect(bus.emit).toBeTypeOf('function')
		expect(bus.on).toBeTypeOf('function')
		expect(bus.off).toBeTypeOf('function')
	})

	describe('emit and on', () => {
		it('works for tool:registered events', () => {
			const bus = createMessageBus()
			const handler = vi.fn()
			bus.on('tool:registered', handler)
			bus.emit('tool:registered', { toolName: 'test-tool', pawName: 'test-paw' })
			expect(handler).toHaveBeenCalledWith({ toolName: 'test-tool', pawName: 'test-paw' })
		})

		it('works for task:queued events', () => {
			const bus = createMessageBus()
			const handler = vi.fn()
			bus.on('task:queued', handler)
			bus.emit('task:queued', { taskId: 'task-1' })
			expect(handler).toHaveBeenCalledWith({ taskId: 'task-1' })
		})

		it('works for paw:crashed events', () => {
			const bus = createMessageBus()
			const handler = vi.fn()
			bus.on('paw:crashed', handler)
			bus.emit('paw:crashed', { pawName: 'broken-paw', error: new Error('boom') })
			expect(handler).toHaveBeenCalledOnce()
			expect(handler.mock.calls[0][0].pawName).toBe('broken-paw')
		})

		it('works for rate:limited events', () => {
			const bus = createMessageBus()
			const handler = vi.fn()
			bus.on('rate:limited', handler)
			bus.emit('rate:limited', { bucket: 'api', source: 'user' })
			expect(handler).toHaveBeenCalledWith({ bucket: 'api', source: 'user' })
		})
	})

	describe('multiple listeners', () => {
		it('all listeners receive events', () => {
			const bus = createMessageBus()
			const handler1 = vi.fn()
			const handler2 = vi.fn()
			const handler3 = vi.fn()

			bus.on('task:started', handler1)
			bus.on('task:started', handler2)
			bus.on('task:started', handler3)

			bus.emit('task:started', { taskId: 'task-1' })

			expect(handler1).toHaveBeenCalledOnce()
			expect(handler2).toHaveBeenCalledOnce()
			expect(handler3).toHaveBeenCalledOnce()
		})
	})
})
