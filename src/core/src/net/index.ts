/**
 * VoleNet Manager — lifecycle management for the distributed networking layer.
 * Initializes transport, discovery, and key management.
 * Starts/stops with the engine.
 */

import * as path from 'node:path'
import * as os from 'node:os'
import { createLogger } from '../core/logger.js'
import { generateKeyPair, loadKeyPair, type VoleKeyPair } from './keys.js'
import { VoleNetTransport, type TransportConfig } from './transport.js'
import { VoleNetDiscovery, type DiscoveryConfig } from './discovery.js'
import { RemoteTaskManager } from './remote-task.js'
import { VoleNetSync, type SyncConfig } from './sync.js'
import { VoleNetLeader } from './leader.js'
import type { ToolRegistry } from '../tool/registry.js'
import { createMessage, type RemoteToolInfo, type VoleNetInstance } from './protocol.js'

const logger = createLogger('volenet')

export interface VoleNetConfig {
	enabled?: boolean
	instanceName?: string
	role?: 'coordinator' | 'worker' | 'peer'
	port?: number
	keyPath?: string
	peers?: Array<{
		url: string
		trust?: 'full' | 'tool' | 'read'
		allowTools?: string[]
		denyTools?: string[]
	}>
	share?: {
		tools?: boolean
		memory?: boolean
		session?: boolean
	}
	tls?: {
		cert: string
		key: string
	}
	discovery?: 'manual' | 'mdns'
	routing?: Record<string, string>

	/**
	 * Leader selection mode:
	 * - "auto" (default): lowest instance ID wins, automatic failover
	 * - "<instanceName>": force a specific instance as leader
	 */
	leader?: 'auto' | string

	/**
	 * Heartbeat mode:
	 * - "leader" (default): only the leader runs heartbeat/schedules
	 * - "independent": each instance runs its own heartbeat independently
	 */
	heartbeatMode?: 'leader' | 'independent'

	/**
	 * Brain load balancing:
	 * - "local" (default): each instance handles its own tasks
	 * - "loadbalance": route incoming tasks to the least-loaded brain across peers
	 */
	brainMode?: 'local' | 'loadbalance'

	/**
	 * Task overflow behavior when local queue is full:
	 * - "reject" (default): reject the task
	 * - "forward": forward to the least-loaded peer automatically
	 */
	taskOverflow?: 'reject' | 'forward'

	/** Max queued tasks before overflow triggers (default: 10) */
	maxQueuedTasks?: number
}

export class VoleNetManager {
	private keyPair: VoleKeyPair | null = null
	private transport: VoleNetTransport | null = null
	private discovery: VoleNetDiscovery | null = null
	private remoteTaskMgr: RemoteTaskManager | null = null
	private sync: VoleNetSync | null = null
	private leader: VoleNetLeader | null = null
	private config: VoleNetConfig
	private projectRoot: string
	private toolRegistry: ToolRegistry | null = null
	private started = false

	constructor(config: VoleNetConfig, projectRoot: string) {
		this.config = config
		this.projectRoot = projectRoot
	}

	/**
	 * Start VoleNet — load keys, start transport, connect to peers.
	 */
	async start(toolRegistry?: ToolRegistry): Promise<void> {
		if (this.started) return
		if (!this.config.enabled) return

		this.toolRegistry = toolRegistry ?? null
		const netDir = this.getNetDir()

		// Load or generate keypair
		this.keyPair = await loadKeyPair(netDir)
		if (!this.keyPair) {
			logger.info('No keypair found — generating new Ed25519 keypair')
			this.keyPair = await generateKeyPair(netDir, this.config.instanceName ?? 'vole')
		}

		logger.info(`Instance ID: ${this.keyPair.instanceId}`)
		logger.info(`Public key: ${this.keyPair.publicKeyString}`)

		// Start transport
		const port = this.config.port ?? 9700
		const transportConfig: TransportConfig = {
			port,
			tls: this.config.tls,
		}
		this.transport = new VoleNetTransport(transportConfig)
		await this.transport.start()

		// Start discovery
		const hostname = this.getHostname()
		const scheme = this.config.tls ? 'https' : 'http'
		const endpoint = `${scheme}://${hostname}:${port}`

		const discoveryConfig: DiscoveryConfig = {
			netDir,
			instanceId: this.keyPair.instanceId,
			instanceName: this.config.instanceName ?? 'vole',
			role: this.config.role ?? 'peer',
			endpoint,
			capabilities: this.getCapabilities(),
			privateKey: this.keyPair.privateKey,
			publicKeyString: this.keyPair.publicKeyString,
		}
		this.discovery = new VoleNetDiscovery(this.transport, discoveryConfig)
		await this.discovery.start()

		// Handle tool:list requests — respond with our local tools
		this.transport.onMessage((message) => {
			if (message.type === 'tool:list' && this.toolRegistry && this.keyPair) {
				const tools: RemoteToolInfo[] = this.toolRegistry.list()
					.filter((t) => t.pawName !== '__volenet__') // don't echo remote tools back
					.map((t) => ({
						name: t.name,
						description: t.description,
						pawName: t.pawName,
						instanceId: this.keyPair!.instanceId,
						instanceName: this.config.instanceName ?? 'vole',
					}))
				const response = createMessage(
					'tool:list:response',
					this.keyPair.instanceId,
					message.from,
					tools,
					this.keyPair.privateKey,
				)
				this.transport!.sendToPeer(message.from, response)
			}
		})

		// Handle incoming tool:call — execute locally and return result
		this.transport.onMessage(async (message) => {
			if (message.type === 'tool:call' && this.toolRegistry && this.keyPair) {
				const { callId, toolName, params } = message.payload as {
					callId: string; toolName: string; params: unknown
				}
				logger.info(`Remote tool call from ${message.from.substring(0, 8)}: ${toolName}`)

				const tool = this.toolRegistry.get(toolName)
				let response
				if (!tool) {
					response = createMessage('tool:result', this.keyPair.instanceId, message.from, {
						callId, success: false, error: `Tool "${toolName}" not found`,
					}, this.keyPair.privateKey)
				} else {
					try {
						const output = await tool.execute(params)
						response = createMessage('tool:result', this.keyPair.instanceId, message.from, {
							callId, success: true, output,
						}, this.keyPair.privateKey)
					} catch (err) {
						response = createMessage('tool:result', this.keyPair.instanceId, message.from, {
							callId, success: false, error: err instanceof Error ? err.message : String(err),
						}, this.keyPair.privateKey)
					}
				}
				await this.transport!.sendToPeer(message.from, response)
			}
		})

		// When peer tool lists arrive, register them as remote tools in local registry
		this.transport.onMessage((message) => {
			if (message.type === 'tool:list:response' && this.toolRegistry && this.keyPair && this.remoteTaskMgr) {
				const tools = message.payload as RemoteToolInfo[]
				if (!Array.isArray(tools) || tools.length === 0) return

				const remoteTaskMgr = this.remoteTaskMgr
				const sourceInstanceId = message.from

				// Create wrapper tool definitions that forward to the remote peer
				const remoteToolDefs = tools
					.filter((t) => !this.toolRegistry!.get(t.name)) // don't override local tools
					.map((t) => ({
						name: t.name,
						description: `[remote: ${t.instanceName}] ${t.description}`,
						parameters: { parse: () => {} } as any, // no schema validation for remote tools
						async execute(params: unknown) {
							const result = await remoteTaskMgr.executeRemoteTool(
								sourceInstanceId, t.name, params,
							)
							if (result.success) return result.output
							throw new Error(result.error ?? 'Remote tool execution failed')
						},
					}))

				if (remoteToolDefs.length > 0) {
					this.toolRegistry!.register(`__volenet__`, remoteToolDefs, false)
					logger.info(`Registered ${remoteToolDefs.length} remote tools from ${message.from.substring(0, 8)}`)
				}
			}
		})

		// Initialize remote task manager
		this.remoteTaskMgr = new RemoteTaskManager(
			this.transport,
			this.discovery,
			this.keyPair.instanceId,
			this.keyPair.privateKey,
			this.config.routing,
		)

		// Initialize sync manager
		const syncConfig: SyncConfig = {
			memory: this.config.share?.memory ?? false,
			session: this.config.share?.session ?? false,
		}
		this.sync = new VoleNetSync(
			this.transport,
			this.discovery,
			this.keyPair.instanceId,
			this.config.instanceName ?? 'vole',
			this.keyPair.privateKey,
			syncConfig,
		)

		// Initialize leader election
		this.leader = new VoleNetLeader(
			this.transport,
			this.discovery,
			this.keyPair.instanceId,
			this.config.instanceName ?? 'vole',
			this.keyPair.privateKey,
			this.config.leader,
		)
		this.leader.start(
			() => logger.info('This instance is now the VoleNet leader (owns heartbeat/schedules)'),
			() => logger.info('This instance lost VoleNet leadership'),
		)

		// Make VoleNet accessible to core tools via globalThis
		;(globalThis as any).__volenet__ = this

		// Connect to configured peers
		if (this.config.peers) {
			for (const peer of this.config.peers) {
				logger.info(`Connecting to peer: ${peer.url}`)
				await this.discovery.connectToPeer(peer.url)
			}
		}

		this.started = true
		logger.info(`VoleNet started — ${this.config.role ?? 'peer'} mode, port ${port}`)
	}

	/**
	 * Stop VoleNet — disconnect peers, stop transport.
	 */
	async stop(): Promise<void> {
		if (!this.started) return

		this.leader?.stop()
		this.sync?.dispose()
		this.remoteTaskMgr?.dispose()
		this.discovery?.stop()
		await this.transport?.stop()

		this.leader = null
		this.sync = null
		this.remoteTaskMgr = null
		this.discovery = null
		this.transport = null
		this.started = false
		;(globalThis as any).__volenet__ = undefined

		logger.info('VoleNet stopped')
	}

	/**
	 * Get connected instances.
	 */
	getInstances(): VoleNetInstance[] {
		return this.discovery?.getInstances() ?? []
	}

	/**
	 * Get all remote tools.
	 */
	getRemoteTools(): RemoteToolInfo[] {
		return this.discovery?.getRemoteTools() ?? []
	}

	/**
	 * Find which peer owns a tool.
	 */
	findToolOwner(toolName: string): { instanceId: string; instance: VoleNetInstance } | null {
		return this.discovery?.findToolOwner(toolName) ?? null
	}

	/**
	 * Get the remote task manager.
	 */
	getRemoteTaskManager(): RemoteTaskManager | null {
		return this.remoteTaskMgr
	}

	/**
	 * Get the sync manager (for memory/session propagation).
	 */
	getSync(): VoleNetSync | null {
		return this.sync
	}

	/**
	 * Get the leader election manager.
	 */
	getLeader(): VoleNetLeader | null {
		return this.leader
	}

	/**
	 * Check if this instance is the VoleNet leader.
	 */
	isLeader(): boolean {
		return this.leader?.isLeader() ?? true // standalone = always leader
	}

	/**
	 * Check if this instance should run heartbeat.
	 * In "independent" mode, every instance runs heartbeat.
	 * In "leader" mode (default), only the leader runs it.
	 */
	shouldRunHeartbeat(): boolean {
		if (!this.started) return true // standalone = always run
		if (this.config.heartbeatMode === 'independent') return true
		return this.isLeader()
	}

	/**
	 * Find the best peer for load-balanced task routing.
	 * Returns null if local should handle it (or no peers available).
	 */
	findLeastLoadedPeer(): VoleNetInstance | null {
		if (this.config.brainMode !== 'loadbalance') return null
		const instances = this.discovery?.getInstances() ?? []
		if (instances.length === 0) return null
		// Sort by load ascending, pick lowest
		const sorted = [...instances].sort((a, b) => a.load - b.load)
		// Only forward if the peer has lower load than us
		// (our load is estimated from task queue size)
		return sorted[0].load < 0.8 ? sorted[0] : null
	}

	/**
	 * Check if a task should be forwarded to a peer (overflow mode).
	 * Returns the target peer or null if local should handle it.
	 */
	shouldForwardTask(currentQueueSize: number): VoleNetInstance | null {
		if (this.config.taskOverflow !== 'forward') return null
		const maxQueued = this.config.maxQueuedTasks ?? 10
		if (currentQueueSize < maxQueued) return null
		// Forward to least-loaded peer
		const instances = this.discovery?.getInstances() ?? []
		if (instances.length === 0) return null
		const sorted = [...instances].sort((a, b) => a.load - b.load)
		return sorted[0]
	}

	/**
	 * Get the keypair (for CLI display).
	 */
	getKeyPair(): VoleKeyPair | null {
		return this.keyPair
	}

	/**
	 * Get the transport (for sending messages).
	 */
	getTransport(): VoleNetTransport | null {
		return this.transport
	}

	/**
	 * Get the discovery manager.
	 */
	getDiscovery(): VoleNetDiscovery | null {
		return this.discovery
	}

	/**
	 * Check if VoleNet is active.
	 */
	isActive(): boolean {
		return this.started
	}

	private getNetDir(): string {
		const keyPath = this.config.keyPath ?? '.openvole/net/vole_key'
		return path.resolve(this.projectRoot, path.dirname(keyPath))
	}

	private getHostname(): string {
		const nets = os.networkInterfaces()
		if (!nets) return 'localhost'
		// Find first non-internal IPv4 address
		for (const name of Object.keys(nets)) {
			for (const net of nets[name] ?? []) {
				if (net.family === 'IPv4' && !net.internal) {
					return net.address
				}
			}
		}
		return 'localhost'
	}

	private getCapabilities(): string[] {
		const caps: string[] = []
		if (this.toolRegistry) {
			// List paw categories as capabilities
			const pawNames = new Set(this.toolRegistry.list().map((t) => t.pawName))
			for (const name of pawNames) {
				if (name !== '__core__') caps.push(name)
			}
		}
		return caps
	}
}

// Re-export key types and functions for CLI use
export { generateKeyPair, loadKeyPair, trustPeer, revokePeer, loadAuthorizedVoles } from './keys.js'
export type { VoleKeyPair } from './keys.js'
export type { VoleNetInstance, RemoteToolInfo } from './protocol.js'
export { RemoteTaskManager } from './remote-task.js'
export type { RemoteTaskRequest, RemoteTaskResult, RemoteToolCallRequest, RemoteToolCallResult } from './remote-task.js'
export { VoleNetSync } from './sync.js'
export type { MemorySyncEntry, MemorySearchRequest, MemorySearchResult, SessionSyncEntry } from './sync.js'
export { VoleNetLeader } from './leader.js'
export type { LeaderState } from './leader.js'
