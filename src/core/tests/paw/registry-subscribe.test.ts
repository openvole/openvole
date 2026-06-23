import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createMessageBus } from '../../src/core/bus.js'
import { IpcTransport } from '../../src/core/ipc.js'
import { PawRegistry } from '../../src/paw/registry.js'
import { ToolRegistry } from '../../src/tool/registry.js'

/**
 * Regression test for the subscribe-before-registration race.
 *
 * A paw sends `subscribe` from its onLoad at startup, which can arrive before
 * `this.paws.set(...)` registers the instance (that runs after waitForRegistration). The
 * subscribe handler used to gate `setupBusForwarding` on `this.paws.get(pawName)`, so an
 * early subscribe silently no-opped — no forwarding was set up, and paw-session's
 * `task:completed` subscription (which records brain responses) was lost ~half the time.
 *
 * The fix sets up forwarding unconditionally; the forwarding callback resolves the instance
 * lazily at event time. This test drives that exact ordering: subscribe arrives with NO
 * instance present, the instance is registered afterwards, and a later bus event must still
 * be forwarded to the paw's transport.
 */

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

describe('PawRegistry subscribe-before-registration', () => {
	it('forwards bus events even when subscribe arrived before the instance was registered', async () => {
		const bus = createMessageBus()
		const toolRegistry = new ToolRegistry(bus)
		const registry = new PawRegistry(bus, toolRegistry, '/tmp')

		const child = fakeChild()
		const transport = new IpcTransport('ipc', child as never)

		// Core registers its inbound handlers (incl. `subscribe`) right after spawn.
		;(registry as never as { setupTransportHandlers: (n: string, t: IpcTransport) => void }).setupTransportHandlers(
			'test-paw',
			transport,
		)

		// The paw's onLoad fires `subscribe` BEFORE the instance is in this.paws.
		child.emit('message', { jsonrpc: '2.0', method: 'subscribe', params: { events: ['task:completed'] } })
		await Promise.resolve()
		await Promise.resolve()

		// waitForRegistration completes later → the instance is registered (healthy).
		;(registry as never as { paws: Map<string, unknown> }).paws.set('test-paw', {
			name: 'test-paw',
			healthy: true,
		})

		// A task completes — the event must reach the paw's transport as a bus_event notify.
		bus.emit('task:completed', { taskId: 't1', result: 'hello', sessionId: 'dashboard' })
		await Promise.resolve()

		const busEvents = child.sent.filter(
			(m): m is { method: string; params: { event: string; data: { sessionId?: string } } } =>
				typeof m === 'object' && m !== null && (m as { method?: string }).method === 'bus_event',
		)
		expect(busEvents.length).toBe(1)
		expect(busEvents[0].params.event).toBe('task:completed')
		// sessionId now rides on the event so paw-session files the reply under the right session.
		expect(busEvents[0].params.data.sessionId).toBe('dashboard')
	})
})
