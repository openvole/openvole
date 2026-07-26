import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createMessageBus } from '../../src/core/bus.js'
import { IpcTransport } from '../../src/core/ipc.js'
import { PawRegistry } from '../../src/paw/registry.js'
import { ToolRegistry } from '../../src/tool/registry.js'

/**
 * Paw → core event emission.
 *
 * The `emit` handler used to log and drop everything, which is why a channel Paw had no way to
 * reach the dashboard or the session transcript. It now publishes — but only `channel:*`.
 * A Paw is sandboxed and untrusted: if it could emit `task:completed` it would drive core's own
 * subscribers (paw-session would file fabricated brain replies, the dashboard would show
 * fabricated tasks), so the namespace boundary is the security property under test here.
 */

function fakeChild(): EventEmitter & {
	connected: boolean
	send: (m: unknown) => void
	sent: unknown[]
} {
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

function harness() {
	const bus = createMessageBus()
	const toolRegistry = new ToolRegistry(bus)
	const registry = new PawRegistry(bus, toolRegistry, '/tmp')
	const child = fakeChild()
	const transport = new IpcTransport('ipc', child as never)
	;(
		registry as never as { setupTransportHandlers: (n: string, t: IpcTransport) => void }
	).setupTransportHandlers('@openvole/paw-chat', transport)
	return { bus, child }
}

const flush = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('paw emit', () => {
	it('publishes a channel:message onto the bus', async () => {
		const { bus, child } = harness()
		const seen: unknown[] = []
		bus.on('channel:message', (d) => seen.push(d))

		child.emit('message', {
			jsonrpc: '2.0',
			method: 'emit',
			params: {
				event: 'channel:message',
				data: {
					channel: 'chat',
					dir: 'out',
					sessionId: 'dashboard',
					text: 'Should I ship?',
					ts: 42,
				},
			},
		})
		await flush()

		expect(seen).toHaveLength(1)
		expect(seen[0]).toMatchObject({
			channel: 'chat',
			dir: 'out',
			sessionId: 'dashboard',
			text: 'Should I ship?',
			ts: 42,
		})
	})

	it('stamps the emitting paw name, ignoring any the payload claims', async () => {
		const { bus, child } = harness()
		const seen: Array<{ pawName?: string }> = []
		bus.on('channel:message', (d) => seen.push(d as { pawName?: string }))

		child.emit('message', {
			jsonrpc: '2.0',
			method: 'emit',
			params: {
				event: 'channel:message',
				data: { channel: 'chat', text: 'hi', pawName: '@openvole/paw-brain' },
			},
		})
		await flush()

		expect(seen[0].pawName).toBe('@openvole/paw-chat')
	})

	it('does NOT publish core-owned events — a paw cannot forge a task completion', async () => {
		const { bus, child } = harness()
		const forged: unknown[] = []
		bus.on('task:completed', (d) => forged.push(d))
		bus.on('paw:crashed', (d) => forged.push(d))

		for (const event of ['task:completed', 'paw:crashed', 'volenet:chat', 'engine:restart']) {
			child.emit('message', {
				jsonrpc: '2.0',
				method: 'emit',
				params: { event, data: { taskId: 'fake', result: 'fabricated', pawName: 'x' } },
			})
		}
		await flush()

		expect(forged).toEqual([])
	})

	it('rejects a channel event with no object payload instead of publishing junk', async () => {
		const { bus, child } = harness()
		const seen: unknown[] = []
		bus.on('channel:message', (d) => seen.push(d))

		child.emit('message', {
			jsonrpc: '2.0',
			method: 'emit',
			params: { event: 'channel:message', data: 'just a string' },
		})
		child.emit('message', {
			jsonrpc: '2.0',
			method: 'emit',
			params: { event: 'channel:message' },
		})
		await flush()

		expect(seen).toEqual([])
	})
})
