/**
 * VoleNet Manager — lifecycle management for the distributed networking layer.
 * Initializes transport, discovery, and key management.
 * Starts/stops with the engine.
 */

import * as path from 'node:path'
import { createLogger } from '../core/logger.js'
import { generateKeyPair, loadKeyPair, type VoleKeyPair } from './keys.js'
import { VoleNetTransport, type TransportConfig } from './transport.js'
import { VoleNetDiscovery, type DiscoveryConfig } from './discovery.js'
import { RemoteTaskManager } from './remote-task.js'
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
}

export class VoleNetManager {
	private keyPair: VoleKeyPair | null = null
	private transport: VoleNetTransport | null = null
	private discovery: VoleNetDiscovery | null = null
	private remoteTaskMgr: RemoteTaskManager | null = null
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

		// Register tool:list handler
		this.transport.onMessage((message) => {
			if (message.type === 'tool:list' && this.toolRegistry && this.keyPair) {
				const tools: RemoteToolInfo[] = this.toolRegistry.list().map((t) => ({
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

		// Initialize remote task manager
		this.remoteTaskMgr = new RemoteTaskManager(
			this.transport,
			this.discovery,
			this.keyPair.instanceId,
			this.keyPair.privateKey,
			this.config.routing,
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

		this.remoteTaskMgr?.dispose()
		this.discovery?.stop()
		await this.transport?.stop()

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
		const keyPath = this.config.keyPath ?? '.openvole/net'
		return path.resolve(this.projectRoot, path.dirname(keyPath))
	}

	private getHostname(): string {
		const { networkInterfaces } = require('node:os')
		const nets = networkInterfaces()
		// Find first non-internal IPv4 address
		for (const name of Object.keys(nets)) {
			for (const net of nets[name]) {
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
