import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as crypto from 'node:crypto'
import { VoleNetSync, type MemorySyncEntry, type SessionSyncEntry } from '../../src/net/sync.js'
import type { VoleNetTransport } from '../../src/net/transport.js'
import type { VoleNetDiscovery } from '../../src/net/discovery.js'
import type { VoleNetMessage, VoleNetInstance } from '../../src/net/protocol.js'

function generateTestKeyPair() {
	return crypto.generateKeyPairSync('ed25519')
}

type MessageHandler = (message: VoleNetMessage, peerId: string) => void

function createMockTransport(): VoleNetTransport & { _handlers: MessageHandler[]; _simulateMessage: (msg: VoleNetMessage) => void } {
	const handlers: MessageHandler[] = []
	return {
		_handlers: handlers,
		_simulateMessage: (msg: VoleNetMessage) => {
			for (const h of handlers) h(msg, msg.from)
		},
		onMessage: (handler: MessageHandler) => { handlers.push(handler) },
		sendToPeer: vi.fn().mockResolvedValue(true),
		broadcast: vi.fn().mockResolvedValue(1),
		addPeer: vi.fn(),
		removePeer: vi.fn(),
		getPeers: vi.fn().mockReturnValue([]),
		isPeerConnected: vi.fn().mockReturnValue(true),
		pingPeer: vi.fn().mockResolvedValue(true),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
	} as unknown as VoleNetTransport & { _handlers: MessageHandler[]; _simulateMessage: (msg: VoleNetMessage) => void }
}

function createMockDiscovery(instances: Partial<VoleNetInstance>[] = []): VoleNetDiscovery {
	return {
		getInstances: vi.fn().mockReturnValue(instances),
		findToolOwner: vi.fn().mockReturnValue(null),
		getRemoteTools: vi.fn().mockReturnValue([]),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn(),
		connectToPeer: vi.fn().mockResolvedValue(null),
		setOnPeerChanged: vi.fn(),
		reloadAuthorized: vi.fn().mockResolvedValue(undefined),
	} as unknown as VoleNetDiscovery
}

describe('VoleNetSync', () => {
	let keyPair: crypto.KeyPairKeyObjectResult
	let transport: ReturnType<typeof createMockTransport>
	let discovery: VoleNetDiscovery
	let sync: VoleNetSync

	beforeEach(() => {
		vi.useFakeTimers()
		keyPair = generateTestKeyPair()
		transport = createMockTransport()
		discovery = createMockDiscovery()
		sync = new VoleNetSync(
			transport,
			discovery,
			'instance-1',
			'test-vole',
			keyPair.privateKey,
			{ memory: true, session: true },
		)
	})

	afterEach(() => {
		sync.dispose()
		vi.useRealTimers()
	})

	describe('propagateMemoryWrite()', () => {
		it('broadcasts memory:sync message', async () => {
			const entry: MemorySyncEntry = {
				file: 'notes.md',
				source: 'user',
				content: 'hello world',
				mode: 'overwrite',
				timestamp: Date.now(),
				instanceId: 'instance-1',
				version: 1,
			}

			await sync.propagateMemoryWrite(entry)

			expect(transport.broadcast).toHaveBeenCalledOnce()
			const sentMsg = vi.mocked(transport.broadcast).mock.calls[0][0] as VoleNetMessage
			expect(sentMsg.type).toBe('memory:sync')
			expect(sentMsg.from).toBe('instance-1')
			expect(sentMsg.to).toBe('*')
			expect(sentMsg.payload).toEqual(entry)
		})

		it('deduplicates — same entry not propagated twice', async () => {
			const entry: MemorySyncEntry = {
				file: 'notes.md',
				source: 'user',
				content: 'hello',
				mode: 'overwrite',
				timestamp: 1000,
				instanceId: 'instance-1',
				version: 1,
			}

			await sync.propagateMemoryWrite(entry)
			await sync.propagateMemoryWrite(entry)

			expect(transport.broadcast).toHaveBeenCalledOnce()
		})

		it('allows propagation after dedup window expires', async () => {
			const entry: MemorySyncEntry = {
				file: 'notes.md',
				source: 'user',
				content: 'hello',
				mode: 'overwrite',
				timestamp: 1000,
				instanceId: 'instance-1',
				version: 1,
			}

			await sync.propagateMemoryWrite(entry)
			expect(transport.broadcast).toHaveBeenCalledOnce()

			// Advance past 5-minute dedup window
			vi.advanceTimersByTime(300_001)

			await sync.propagateMemoryWrite(entry)
			expect(transport.broadcast).toHaveBeenCalledTimes(2)
		})

		it('does not propagate when memory sync is disabled', async () => {
			sync = new VoleNetSync(
				transport,
				discovery,
				'instance-1',
				'test-vole',
				keyPair.privateKey,
				{ memory: false, session: true },
			)

			await sync.propagateMemoryWrite({
				file: 'notes.md',
				source: 'user',
				content: 'hello',
				mode: 'overwrite',
				timestamp: Date.now(),
				instanceId: 'instance-1',
				version: 1,
			})

			expect(transport.broadcast).not.toHaveBeenCalled()
		})

		it('propagates different entries independently', async () => {
			const entry1: MemorySyncEntry = {
				file: 'notes.md',
				source: 'user',
				content: 'hello',
				mode: 'overwrite',
				timestamp: 1000,
				instanceId: 'instance-1',
				version: 1,
			}
			const entry2: MemorySyncEntry = {
				file: 'other.md',
				source: 'user',
				content: 'world',
				mode: 'append',
				timestamp: 1000,
				instanceId: 'instance-1',
				version: 1,
			}

			await sync.propagateMemoryWrite(entry1)
			await sync.propagateMemoryWrite(entry2)

			expect(transport.broadcast).toHaveBeenCalledTimes(2)
		})
	})

	describe('propagateSessionWrite()', () => {
		it('broadcasts session:sync message', async () => {
			const entry: SessionSyncEntry = {
				sessionId: 'session-1',
				role: 'user',
				content: 'hello',
				timestamp: Date.now(),
				instanceId: 'instance-1',
			}

			await sync.propagateSessionWrite(entry)

			expect(transport.broadcast).toHaveBeenCalledOnce()
			const sentMsg = vi.mocked(transport.broadcast).mock.calls[0][0] as VoleNetMessage
			expect(sentMsg.type).toBe('session:sync')
			expect(sentMsg.payload).toEqual(entry)
		})

		it('deduplicates session writes', async () => {
			const entry: SessionSyncEntry = {
				sessionId: 'session-1',
				role: 'user',
				content: 'hello',
				timestamp: 1000,
				instanceId: 'instance-1',
			}

			await sync.propagateSessionWrite(entry)
			await sync.propagateSessionWrite(entry)

			expect(transport.broadcast).toHaveBeenCalledOnce()
		})

		it('does not propagate when session sync is disabled', async () => {
			sync = new VoleNetSync(
				transport,
				discovery,
				'instance-1',
				'test-vole',
				keyPair.privateKey,
				{ memory: true, session: false },
			)

			await sync.propagateSessionWrite({
				sessionId: 'session-1',
				role: 'user',
				content: 'hello',
				timestamp: Date.now(),
				instanceId: 'instance-1',
			})

			expect(transport.broadcast).not.toHaveBeenCalled()
		})
	})

	describe('incoming memory:sync handling', () => {
		it('calls onMemoryWrite handler when memory:sync arrives', async () => {
			const handler = vi.fn().mockResolvedValue(undefined)
			sync.setMemoryWriteHandler(handler)

			const entry: MemorySyncEntry = {
				file: 'remote-notes.md',
				source: 'peer',
				content: 'from remote',
				mode: 'overwrite',
				timestamp: Date.now(),
				instanceId: 'remote-instance',
				version: 1,
			}

			transport._simulateMessage({
				version: 1,
				id: 'msg-1',
				type: 'memory:sync',
				from: 'remote-instance',
				to: '*',
				timestamp: Date.now(),
				signature: '',
				payload: entry,
			})

			// Handler is called asynchronously
			await vi.advanceTimersByTimeAsync(0)
			expect(handler).toHaveBeenCalledWith(entry)
		})

		it('deduplicates incoming memory syncs', async () => {
			const handler = vi.fn().mockResolvedValue(undefined)
			sync.setMemoryWriteHandler(handler)

			const entry: MemorySyncEntry = {
				file: 'notes.md',
				source: 'peer',
				content: 'dup test',
				mode: 'overwrite',
				timestamp: 5000,
				instanceId: 'remote-instance',
				version: 1,
			}

			const msg: VoleNetMessage = {
				version: 1,
				id: 'msg-1',
				type: 'memory:sync',
				from: 'remote-instance',
				to: '*',
				timestamp: Date.now(),
				signature: '',
				payload: entry,
			}

			transport._simulateMessage(msg)
			transport._simulateMessage(msg)

			await vi.advanceTimersByTimeAsync(0)
			expect(handler).toHaveBeenCalledOnce()
		})
	})

	describe('incoming session:sync handling', () => {
		it('calls onSessionWrite handler when session:sync arrives', async () => {
			const handler = vi.fn().mockResolvedValue(undefined)
			sync.setSessionWriteHandler(handler)

			const entry: SessionSyncEntry = {
				sessionId: 'session-remote',
				role: 'assistant',
				content: 'response from remote',
				timestamp: Date.now(),
				instanceId: 'remote-instance',
			}

			transport._simulateMessage({
				version: 1,
				id: 'msg-1',
				type: 'session:sync',
				from: 'remote-instance',
				to: '*',
				timestamp: Date.now(),
				signature: '',
				payload: entry,
			})

			await vi.advanceTimersByTimeAsync(0)
			expect(handler).toHaveBeenCalledWith(entry)
		})
	})

	describe('dispose()', () => {
		it('clears recentSyncs and pending searches', () => {
			// Just make sure dispose doesn't throw
			sync.dispose()
		})
	})
})
