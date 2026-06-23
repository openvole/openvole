import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { IpcTransport } from '../../src/core/ipc.js'

/**
 * Regression tests for IpcTransport's early-message buffering.
 *
 * A subprocess Paw sends `register` (at module load) and `subscribe` (from onLoad) at
 * startup, which races handler registration on the core side. Before buffering, an early
 * message whose handler wasn't registered yet was silently dropped — which is why
 * paw-session's `task:completed` subscription was lost ~half the time and brain responses
 * never got recorded to the session transcript.
 */

/** Minimal ChildProcess stand-in: an EventEmitter with a connected `send`. */
function fakeChild(): EventEmitter & { connected: boolean; send: (m: unknown) => void; sent: unknown[] } {
	const ee = new EventEmitter() as EventEmitter & {
		connected: boolean
		send: (m: unknown) => void
		sent: unknown[]
	}
	ee.connected = true
	ee.sent = []
	ee.send = (m: unknown) => {
		ee.sent.push(m)
	}
	return ee
}

describe('IpcTransport early-message buffering', () => {
	it('delivers a method message that arrived before its handler was registered', async () => {
		const child = fakeChild()
		const transport = new IpcTransport('ipc', child as never)

		// Message arrives BEFORE the handler exists (the startup race).
		child.emit('message', { jsonrpc: '2.0', method: 'subscribe', params: { events: ['task:completed'] } })

		let received: unknown
		transport.onRequest('subscribe', async (params) => {
			received = params
			return { ok: true }
		})

		// Flush happens synchronously on registration; the handler body is async.
		await Promise.resolve()
		expect(received).toEqual({ events: ['task:completed'] })
	})

	it('still delivers a message that arrives after the handler is registered', async () => {
		const child = fakeChild()
		const transport = new IpcTransport('ipc', child as never)

		let received: unknown
		transport.onRequest('subscribe', async (params) => {
			received = params
			return { ok: true }
		})
		child.emit('message', { jsonrpc: '2.0', method: 'subscribe', params: { events: ['x'] } })

		await Promise.resolve()
		expect(received).toEqual({ events: ['x'] })
	})

	it('replies to a buffered request that carried an id', async () => {
		const child = fakeChild()
		const transport = new IpcTransport('ipc', child as never)

		child.emit('message', { jsonrpc: '2.0', id: 'req-1', method: 'query', params: { type: 'tools' } })
		transport.onRequest('query', async () => ['toolA'])

		await Promise.resolve()
		await Promise.resolve()
		expect(child.sent).toContainEqual({ jsonrpc: '2.0', id: 'req-1', result: ['toolA'] })
	})

	it('does not redeliver a buffered message after it is flushed', async () => {
		const child = fakeChild()
		const transport = new IpcTransport('ipc', child as never)

		child.emit('message', { jsonrpc: '2.0', method: 'subscribe', params: { events: ['once'] } })
		let calls = 0
		transport.onRequest('subscribe', async () => {
			calls++
			return { ok: true }
		})
		await Promise.resolve()
		// Re-registering the handler must not replay the already-flushed message.
		transport.onRequest('subscribe', async () => {
			calls++
			return { ok: true }
		})
		await Promise.resolve()
		expect(calls).toBe(1)
	})
})
