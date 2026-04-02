import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as crypto from 'node:crypto'
import { RemoteTaskManager } from '../../src/net/remote-task.js'
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

function createMockDiscovery(instances: Partial<VoleNetInstance>[] = [], toolOwner?: { instanceId: string; instance: VoleNetInstance }): VoleNetDiscovery {
	return {
		getInstances: vi.fn().mockReturnValue(instances),
		findToolOwner: vi.fn().mockReturnValue(toolOwner ?? null),
		getRemoteTools: vi.fn().mockReturnValue([]),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn(),
		connectToPeer: vi.fn().mockResolvedValue(null),
		setOnPeerChanged: vi.fn(),
		reloadAuthorized: vi.fn().mockResolvedValue(undefined),
	} as unknown as VoleNetDiscovery
}

describe('RemoteTaskManager', () => {
	let keyPair: crypto.KeyPairKeyObjectResult
	let transport: ReturnType<typeof createMockTransport>
	let discovery: VoleNetDiscovery
	let manager: RemoteTaskManager

	beforeEach(() => {
		keyPair = generateTestKeyPair()
		transport = createMockTransport()
		discovery = createMockDiscovery()
		manager = new RemoteTaskManager(transport, discovery, 'local-instance', keyPair.privateKey)
	})

	afterEach(() => {
		manager.dispose()
	})

	describe('resolveToolTarget()', () => {
		it('returns null when no routing matches and no peer has the tool', () => {
			const result = manager.resolveToolTarget('some_tool')
			expect(result).toBeNull()
		})

		it('matches exact tool name in routing config', () => {
			const instances: Partial<VoleNetInstance>[] = [
				{ id: 'peer-abc', name: 'gpu-worker' },
			]
			discovery = createMockDiscovery(instances)
			manager = new RemoteTaskManager(transport, discovery, 'local', keyPair.privateKey, {
				'image_resize': 'gpu-worker',
			})

			const result = manager.resolveToolTarget('image_resize')
			expect(result).toBe('peer-abc')
		})

		it('matches glob pattern (prefix*) in routing config', () => {
			const instances: Partial<VoleNetInstance>[] = [
				{ id: 'worker-1', name: 'shell-worker' },
			]
			discovery = createMockDiscovery(instances)
			manager = new RemoteTaskManager(transport, discovery, 'local', keyPair.privateKey, {
				'shell_*': 'shell-worker',
			})

			expect(manager.resolveToolTarget('shell_exec')).toBe('worker-1')
			expect(manager.resolveToolTarget('shell_run')).toBe('worker-1')
			expect(manager.resolveToolTarget('image_resize')).toBeNull()
		})

		it('falls back to discovery findToolOwner when no routing matches', () => {
			const instance: VoleNetInstance = {
				id: 'peer-xyz',
				name: 'tool-peer',
				publicKey: '',
				endpoint: '',
				capabilities: [],
				role: 'worker',
				load: 0,
				maxTasks: 5,
				lastSeen: Date.now(),
				version: '1.0',
			}
			discovery = createMockDiscovery([], { instanceId: 'peer-xyz', instance })
			manager = new RemoteTaskManager(transport, discovery, 'local', keyPair.privateKey)

			const result = manager.resolveToolTarget('some_tool')
			expect(result).toBe('peer-xyz')
		})

		it('returns null when routing target instance not found in discovery', () => {
			discovery = createMockDiscovery([])
			manager = new RemoteTaskManager(transport, discovery, 'local', keyPair.privateKey, {
				'tool_*': 'missing-worker',
			})

			const result = manager.resolveToolTarget('tool_test')
			expect(result).toBeNull()
		})

		it('does not match non-prefix patterns as glob', () => {
			const instances: Partial<VoleNetInstance>[] = [
				{ id: 'worker-1', name: 'worker' },
			]
			discovery = createMockDiscovery(instances)
			manager = new RemoteTaskManager(transport, discovery, 'local', keyPair.privateKey, {
				'shell_exec': 'worker',
			})

			expect(manager.resolveToolTarget('shell_exec')).toBe('worker-1')
			expect(manager.resolveToolTarget('shell_exec_2')).toBeNull()
		})
	})

	describe('delegateTask()', () => {
		it('returns failed when peer is unreachable', async () => {
			vi.mocked(transport.sendToPeer).mockResolvedValue(false)

			const result = await manager.delegateTask('target-peer', {
				taskId: 'task-1',
				input: 'do something',
			})

			expect(result.status).toBe('failed')
			expect(result.error).toBe('Failed to reach peer')
			expect(result.taskId).toBe('task-1')
		})

		it('sends task:delegate message to transport', async () => {
			// Don't await the promise — just check the send happened
			const resultPromise = manager.delegateTask('target-peer', {
				taskId: 'task-1',
				input: 'do something',
			})

			// Wait for the sendToPeer call
			await vi.waitFor(() => {
				expect(transport.sendToPeer).toHaveBeenCalled()
			})

			const sentCall = vi.mocked(transport.sendToPeer).mock.calls[0]
			expect(sentCall[0]).toBe('target-peer')
			const sentMessage = sentCall[1] as VoleNetMessage
			expect(sentMessage.type).toBe('task:delegate')
			expect(sentMessage.from).toBe('local-instance')
			expect(sentMessage.to).toBe('target-peer')

			// Simulate result to resolve the promise
			transport._simulateMessage({
				version: 1,
				id: 'msg-1',
				type: 'task:result',
				from: 'target-peer',
				to: 'local-instance',
				timestamp: Date.now(),
				signature: '',
				payload: { taskId: 'task-1', status: 'completed', result: 'done' },
			})

			const result = await resultPromise
			expect(result.status).toBe('completed')
			expect(result.result).toBe('done')
		})

		it('resolves when result message arrives', async () => {
			const resultPromise = manager.delegateTask('target-peer', {
				taskId: 'task-2',
				input: 'work',
			})

			await vi.waitFor(() => {
				expect(transport.sendToPeer).toHaveBeenCalled()
			})

			transport._simulateMessage({
				version: 1,
				id: 'msg-2',
				type: 'task:result',
				from: 'target-peer',
				to: 'local-instance',
				timestamp: Date.now(),
				signature: '',
				payload: { taskId: 'task-2', status: 'completed', result: 'all done' },
			})

			const result = await resultPromise
			expect(result.status).toBe('completed')
		})
	})

	describe('executeRemoteTool()', () => {
		it('returns failed when peer is unreachable', async () => {
			vi.mocked(transport.sendToPeer).mockResolvedValue(false)

			const result = await manager.executeRemoteTool('target-peer', 'my_tool', { arg: 1 })
			expect(result.success).toBe(false)
			expect(result.error).toBe('Failed to reach peer')
		})

		it('sends tool:call message and resolves on result', async () => {
			const resultPromise = manager.executeRemoteTool('target-peer', 'my_tool', { arg: 1 })

			await vi.waitFor(() => {
				expect(transport.sendToPeer).toHaveBeenCalled()
			})

			// Find the callId from the sent message
			const sentCall = vi.mocked(transport.sendToPeer).mock.calls[0]
			const sentMessage = sentCall[1] as VoleNetMessage
			const callId = (sentMessage.payload as { callId: string }).callId

			transport._simulateMessage({
				version: 1,
				id: 'msg-2',
				type: 'tool:result',
				from: 'target-peer',
				to: 'local-instance',
				timestamp: Date.now(),
				signature: '',
				payload: { callId, success: true, output: 'result data' },
			})

			const result = await resultPromise
			expect(result.success).toBe(true)
			expect(result.output).toBe('result data')
		})
	})

	describe('dispose()', () => {
		it('resolves all pending tasks as failed', async () => {
			const resultPromise = manager.delegateTask('target-peer', {
				taskId: 'task-dispose',
				input: 'will be disposed',
			})

			await vi.waitFor(() => {
				expect(transport.sendToPeer).toHaveBeenCalled()
			})

			manager.dispose()

			const result = await resultPromise
			expect(result.status).toBe('failed')
			expect(result.error).toContain('shutting down')
		})

		it('resolves all pending tool calls as failed', async () => {
			const resultPromise = manager.executeRemoteTool('target-peer', 'tool', {})

			await vi.waitFor(() => {
				expect(transport.sendToPeer).toHaveBeenCalled()
			})

			manager.dispose()

			const result = await resultPromise
			expect(result.success).toBe(false)
			expect(result.error).toContain('shutting down')
		})
	})
})
