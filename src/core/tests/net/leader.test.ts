import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as crypto from 'node:crypto'
import { VoleNetLeader } from '../../src/net/leader.js'
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

describe('VoleNetLeader', () => {
	let keyPair: crypto.KeyPairKeyObjectResult
	let transport: ReturnType<typeof createMockTransport>
	let discovery: VoleNetDiscovery
	let leader: VoleNetLeader

	beforeEach(() => {
		vi.useFakeTimers()
		keyPair = generateTestKeyPair()
		transport = createMockTransport()
	})

	afterEach(() => {
		leader?.stop()
		vi.useRealTimers()
	})

	describe('electLeader() — lowest instance ID wins', () => {
		it('elects self as leader when no peers exist', () => {
			discovery = createMockDiscovery([])
			leader = new VoleNetLeader(transport, discovery, 'aaaa', 'vole-a', keyPair.privateKey)
			leader.start()

			expect(leader.isLeader()).toBe(true)
			expect(leader.getState().leaderId).toBe('aaaa')
			expect(leader.getState().leaderName).toBe('vole-a')
		})

		it('elects self when own ID is lowest', () => {
			discovery = createMockDiscovery([
				{ id: 'bbbb', name: 'vole-b' },
				{ id: 'cccc', name: 'vole-c' },
			])
			leader = new VoleNetLeader(transport, discovery, 'aaaa', 'vole-a', keyPair.privateKey)
			leader.start()

			expect(leader.isLeader()).toBe(true)
			expect(leader.getState().leaderId).toBe('aaaa')
		})

		it('elects peer when peer has lowest ID', () => {
			discovery = createMockDiscovery([
				{ id: 'aaaa', name: 'vole-a' },
				{ id: 'cccc', name: 'vole-c' },
			])
			leader = new VoleNetLeader(transport, discovery, 'bbbb', 'vole-b', keyPair.privateKey)
			leader.start()

			expect(leader.isLeader()).toBe(false)
			expect(leader.getState().leaderId).toBe('aaaa')
			expect(leader.getState().leaderName).toBe('vole-a')
		})
	})

	describe('forcedLeader', () => {
		it('forces self as leader when forcedLeader matches own name', () => {
			discovery = createMockDiscovery([
				{ id: 'aaaa', name: 'vole-a' },
			])
			// Self has higher ID but is forced leader
			leader = new VoleNetLeader(transport, discovery, 'zzzz', 'my-vole', keyPair.privateKey, 'my-vole')
			leader.start()

			expect(leader.isLeader()).toBe(true)
			expect(leader.getState().leaderId).toBe('zzzz')
		})

		it('forces a specific peer as leader by name', () => {
			discovery = createMockDiscovery([
				{ id: 'bbbb', name: 'designated-leader' },
			])
			leader = new VoleNetLeader(transport, discovery, 'aaaa', 'vole-a', keyPair.privateKey, 'designated-leader')
			leader.start()

			expect(leader.isLeader()).toBe(false)
			expect(leader.getState().leaderId).toBe('bbbb')
		})

		it('falls back to self when forced leader name not found in peers', () => {
			discovery = createMockDiscovery([
				{ id: 'aaaa', name: 'vole-a' },
			])
			leader = new VoleNetLeader(transport, discovery, 'bbbb', 'vole-b', keyPair.privateKey, 'missing-leader')
			leader.start()

			expect(leader.isLeader()).toBe(true)
		})

		it('treats "auto" as no forced leader', () => {
			discovery = createMockDiscovery([
				{ id: 'aaaa', name: 'vole-a' },
			])
			// Self has higher ID, forcedLeader is 'auto' which means lowest-ID election
			leader = new VoleNetLeader(transport, discovery, 'zzzz', 'vole-z', keyPair.privateKey, 'auto')
			leader.start()

			expect(leader.isLeader()).toBe(false)
			expect(leader.getState().leaderId).toBe('aaaa')
		})
	})

	describe('reelect()', () => {
		it('re-elects when peers change', () => {
			const instances: Partial<VoleNetInstance>[] = [
				{ id: 'cccc', name: 'vole-c' },
			]
			discovery = createMockDiscovery(instances)
			leader = new VoleNetLeader(transport, discovery, 'bbbb', 'vole-b', keyPair.privateKey)
			leader.start()

			// Self (bbbb) is leader since bbbb < cccc
			expect(leader.isLeader()).toBe(true)

			// A new peer with lower ID joins
			vi.mocked(discovery.getInstances).mockReturnValue([
				{ id: 'aaaa', name: 'vole-a' } as VoleNetInstance,
				{ id: 'cccc', name: 'vole-c' } as VoleNetInstance,
			])
			leader.reelect()

			expect(leader.isLeader()).toBe(false)
			expect(leader.getState().leaderId).toBe('aaaa')
		})

		it('re-elects self when old leader leaves', () => {
			discovery = createMockDiscovery([
				{ id: 'aaaa', name: 'vole-a' },
			])
			leader = new VoleNetLeader(transport, discovery, 'bbbb', 'vole-b', keyPair.privateKey)
			leader.start()

			expect(leader.isLeader()).toBe(false)

			// Old leader leaves
			vi.mocked(discovery.getInstances).mockReturnValue([])
			leader.reelect()

			expect(leader.isLeader()).toBe(true)
		})
	})

	describe('callbacks: onBecomeLeader, onLoseLeader', () => {
		it('calls onBecomeLeader when elected', () => {
			const onBecomeLeader = vi.fn()
			discovery = createMockDiscovery([])
			leader = new VoleNetLeader(transport, discovery, 'aaaa', 'vole-a', keyPair.privateKey)
			leader.start(onBecomeLeader)

			// Self is leader with no peers — onBecomeLeader should be called
			expect(onBecomeLeader).toHaveBeenCalledOnce()
		})

		it('calls onLoseLeader when a lower-ID peer joins', () => {
			const onBecomeLeader = vi.fn()
			const onLoseLeader = vi.fn()
			discovery = createMockDiscovery([])
			leader = new VoleNetLeader(transport, discovery, 'bbbb', 'vole-b', keyPair.privateKey)
			leader.start(onBecomeLeader, onLoseLeader)

			expect(onBecomeLeader).toHaveBeenCalledOnce()
			expect(onLoseLeader).not.toHaveBeenCalled()

			// Lower-ID peer joins
			vi.mocked(discovery.getInstances).mockReturnValue([
				{ id: 'aaaa', name: 'vole-a' } as VoleNetInstance,
			])
			leader.reelect()

			expect(onLoseLeader).toHaveBeenCalledOnce()
		})

		it('does not call onBecomeLeader when not elected', () => {
			const onBecomeLeader = vi.fn()
			discovery = createMockDiscovery([
				{ id: 'aaaa', name: 'vole-a' },
			])
			leader = new VoleNetLeader(transport, discovery, 'zzzz', 'vole-z', keyPair.privateKey)
			leader.start(onBecomeLeader)

			expect(onBecomeLeader).not.toHaveBeenCalled()
		})

		it('calls onBecomeLeader when peer leaves and self becomes leader', () => {
			const onBecomeLeader = vi.fn()
			discovery = createMockDiscovery([
				{ id: 'aaaa', name: 'vole-a' },
			])
			leader = new VoleNetLeader(transport, discovery, 'bbbb', 'vole-b', keyPair.privateKey)
			leader.start(onBecomeLeader)

			expect(onBecomeLeader).not.toHaveBeenCalled()

			// Peer leaves
			vi.mocked(discovery.getInstances).mockReturnValue([])
			leader.reelect()

			expect(onBecomeLeader).toHaveBeenCalledOnce()
		})
	})

	describe('leader:heartbeat handling', () => {
		it('updates lastHeartbeat when receiving heartbeat from leader', () => {
			discovery = createMockDiscovery([
				{ id: 'aaaa', name: 'vole-a' },
			])
			leader = new VoleNetLeader(transport, discovery, 'bbbb', 'vole-b', keyPair.privateKey)
			leader.start()

			expect(leader.getState().leaderId).toBe('aaaa')

			transport._simulateMessage({
				version: 1,
				id: 'hb-1',
				type: 'leader:heartbeat',
				from: 'aaaa',
				to: '*',
				timestamp: Date.now(),
				signature: '',
				payload: { timestamp: Date.now() },
			})

			const state = leader.getState()
			expect(state.lastHeartbeat).toBeGreaterThan(0)
			expect(state.missedHeartbeats).toBe(0)
		})
	})

	describe('leader:claim handling', () => {
		it('accepts claim from lower-ID peer', () => {
			discovery = createMockDiscovery([])
			leader = new VoleNetLeader(transport, discovery, 'bbbb', 'vole-b', keyPair.privateKey)
			leader.start()

			expect(leader.isLeader()).toBe(true)

			transport._simulateMessage({
				version: 1,
				id: 'claim-1',
				type: 'leader:claim',
				from: 'aaaa',
				to: '*',
				timestamp: Date.now(),
				signature: '',
				payload: {},
			})

			expect(leader.isLeader()).toBe(false)
			expect(leader.getState().leaderId).toBe('aaaa')
			// Should have sent an ack
			expect(transport.sendToPeer).toHaveBeenCalled()
		})

		it('ignores claim from higher-ID peer', () => {
			discovery = createMockDiscovery([])
			leader = new VoleNetLeader(transport, discovery, 'aaaa', 'vole-a', keyPair.privateKey)
			leader.start()

			expect(leader.isLeader()).toBe(true)

			transport._simulateMessage({
				version: 1,
				id: 'claim-2',
				type: 'leader:claim',
				from: 'zzzz',
				to: '*',
				timestamp: Date.now(),
				signature: '',
				payload: {},
			})

			expect(leader.isLeader()).toBe(true)
		})
	})

	describe('stop()', () => {
		it('clears leader state', () => {
			discovery = createMockDiscovery([])
			leader = new VoleNetLeader(transport, discovery, 'aaaa', 'vole-a', keyPair.privateKey)
			leader.start()

			expect(leader.getState().leaderId).toBe('aaaa')

			leader.stop()

			expect(leader.getState().leaderId).toBeNull()
			expect(leader.getState().leaderName).toBeNull()
		})
	})
})
