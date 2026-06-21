/**
 * VoleNet Discovery — peer registry, capability announcement, health monitoring.
 */

import type { KeyObject } from 'node:crypto'
import { createLogger } from '../core/logger.js'
import { loadAuthorizedVoles, parsePublicKey, trustPeer } from './keys.js'
import {
	type RemoteToolInfo,
	type VoleNetInstance,
	type VoleNetMessage,
	createMessage,
	verifyMessage,
} from './protocol.js'
import type { VoleNetTransport } from './transport.js'

const logger = createLogger('volenet-discovery')

const HEALTH_INTERVAL_MS = 15_000 // ping peers every 15s
const PEER_TIMEOUT_MS = 45_000 // mark peer as disconnected after 45s

export interface DiscoveryConfig {
	netDir: string
	instanceId: string
	instanceName: string
	role: 'coordinator' | 'worker' | 'peer'
	endpoint: string
	capabilities: string[]
	privateKey: KeyObject
	publicKeyString: string
}

export class VoleNetDiscovery {
	private instances = new Map<string, VoleNetInstance>()
	private remoteTools = new Map<string, RemoteToolInfo[]>()
	private transport: VoleNetTransport
	private config: DiscoveryConfig
	private healthTimer: ReturnType<typeof setInterval> | undefined
	private authorizedPeers = new Map<
		string,
		{ publicKey: KeyObject; name: string; pqPublicKey?: KeyObject }
	>()
	private onPeerChanged?: () => void

	constructor(transport: VoleNetTransport, config: DiscoveryConfig) {
		this.transport = transport
		this.config = config
	}

	/**
	 * Start discovery — load authorized peers, announce self, begin health checks.
	 */
	/** Set callback for when peers join/leave (triggers leader re-election) */
	setOnPeerChanged(handler: () => void): void {
		this.onPeerChanged = handler
	}

	async start(): Promise<void> {
		// Load authorized peers
		this.authorizedPeers = await loadAuthorizedVoles(this.config.netDir)
		logger.info(`Loaded ${this.authorizedPeers.size} authorized peer(s)`)

		// Register message handlers
		this.transport.onMessage((message, peerId) => {
			this.handleMessage(message, peerId)
		})

		// Start health monitoring
		this.healthTimer = setInterval(() => this.healthCheck(), HEALTH_INTERVAL_MS)

		logger.info(
			`Discovery started — instance: ${this.config.instanceName} (${this.config.instanceId.substring(0, 8)})`,
		)
	}

	/**
	 * Stop discovery — cleanup timers.
	 */
	stop(): void {
		if (this.healthTimer) {
			clearInterval(this.healthTimer)
			this.healthTimer = undefined
		}
		this.instances.clear()
		this.remoteTools.clear()
	}

	/**
	 * Connect to a peer and perform authentication.
	 */
	async connectToPeer(endpoint: string): Promise<string | null> {
		// Ping first
		const reachable = await this.transport.pingPeer(endpoint)
		if (!reachable) {
			logger.warn(`Peer unreachable: ${endpoint}`)
			return null
		}

		// Send discovery announcement
		const message = createMessage(
			'discover',
			this.config.instanceId,
			'*',
			{
				name: this.config.instanceName,
				publicKey: this.config.publicKeyString,
				endpoint: this.config.endpoint,
				capabilities: this.config.capabilities,
				role: this.config.role,
				version: '3.0.0',
			} satisfies Partial<VoleNetInstance>,
			this.config.privateKey,
		)

		try {
			const response = await fetch(`${endpoint}/volenet/message`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(message),
				signal: AbortSignal.timeout(10000),
			})

			if (response.ok) {
				logger.info(`Discovery sent to ${endpoint}`)
				// The peer may inline its discover:response in the body (NAT-friendly — it can't
				// dial us back). Process it so we register them even when unreachable from their side.
				try {
					const data = (await response.json()) as { response?: VoleNetMessage }
					if (data?.response?.type === 'discover:response') {
						this.handleMessage(data.response, data.response.from)
					}
				} catch {
					/* no inline response body */
				}
				return message.from
			}
		} catch (err) {
			logger.warn(
				`Discovery failed for ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		return null
	}

	/**
	 * Handle incoming VoleNet messages.
	 */
	private handleMessage(message: VoleNetMessage, _peerId: string): void {
		switch (message.type) {
			case 'discover':
				this.handleDiscover(message)
				break
			case 'discover:response':
				this.handleDiscoverResponse(message)
				break
			case 'ping':
				this.handlePing(message)
				break
			case 'pong':
				this.handlePong(message)
				break
			case 'tool:list:response':
				this.handleToolList(message)
				break
		}
	}

	/**
	 * Verify an inbound message is from an authorized peer (keystore + Ed25519 signature).
	 * Used by non-discovery handlers (e.g. peer chat) that receive raw transport messages.
	 */
	verifyMessageFrom(message: VoleNetMessage): boolean {
		const authPeer = this.authorizedPeers.get(message.from)
		if (!authPeer) return false
		return verifyMessage(message, authPeer.publicKey, authPeer.pqPublicKey).valid
	}

	/**
	 * Handle discovery announcement from a peer.
	 */
	/**
	 * Build a signed discover:response for an inbound discover, with NO side effects.
	 * Wired as the transport's HTTP responder so a peer behind NAT receives our identity
	 * inline in its own request's response — it can't be reached by a dial-back. Returns
	 * null unless the discover is from an authorized peer with a valid signature.
	 */
	buildDiscoverResponse(message: VoleNetMessage): VoleNetMessage | null {
		if (message.type !== 'discover') return null
		const info = message.payload as Partial<VoleNetInstance>
		if (!info.publicKey || !info.name) return null
		const parsed = parsePublicKey(info.publicKey)
		if (!parsed) return null
		const authPeer = this.authorizedPeers.get(parsed.instanceId)
		if (!authPeer) return null
		const result = verifyMessage(message, authPeer.publicKey, authPeer.pqPublicKey)
		if (!result.valid) return null
		return createMessage(
			'discover:response',
			this.config.instanceId,
			parsed.instanceId,
			{
				name: this.config.instanceName,
				publicKey: this.config.publicKeyString,
				endpoint: this.config.endpoint,
				capabilities: this.config.capabilities,
				role: this.config.role,
				version: '3.0.0',
			},
			this.config.privateKey,
		)
	}

	private handleDiscover(message: VoleNetMessage): void {
		const info = message.payload as Partial<VoleNetInstance>
		if (!info.publicKey || !info.name) return

		// Verify the peer is authorized
		const parsed = parsePublicKey(info.publicKey)
		if (!parsed) {
			logger.warn(`Invalid public key from peer: ${message.from.substring(0, 8)}`)
			return
		}

		if (!this.authorizedPeers.has(parsed.instanceId)) {
			logger.warn(
				`Unauthorized peer attempted connection: ${info.name} (${parsed.instanceId.substring(0, 8)})`,
			)
			return
		}

		// Verify message signature
		const authPeer = this.authorizedPeers.get(parsed.instanceId)!
		const result = verifyMessage(message, authPeer.publicKey, authPeer.pqPublicKey)
		if (!result.valid) {
			logger.warn(`Message verification failed from ${info.name}: ${result.error}`)
			return
		}

		// Auto-upgrade trust to hybrid PQ when a known peer announces an ML-DSA key. The discover
		// was Ed25519-verified above, so the announced PQ key is authentic (vouched by the peer's
		// existing key) — existing meshes migrate with no manual re-trust.
		if (parsed.pqPublicKey && !authPeer.pqPublicKey && info.publicKey) {
			authPeer.pqPublicKey = parsed.pqPublicKey
			void trustPeer(this.config.netDir, info.publicKey).catch(() => {})
			logger.info(`Auto-upgraded peer to hybrid PQ: ${info.name} (${parsed.instanceId.substring(0, 8)})`)
		}

		// Register the peer
		const instance: VoleNetInstance = {
			id: parsed.instanceId,
			name: info.name,
			publicKey: info.publicKey,
			endpoint: info.endpoint ?? '',
			capabilities: info.capabilities ?? [],
			role: (info.role as VoleNetInstance['role']) ?? 'peer',
			load: 0,
			maxTasks: 5,
			lastSeen: Date.now(),
			version: info.version ?? 'unknown',
		}

		this.instances.set(parsed.instanceId, instance)
		if (instance.endpoint) {
			this.transport.addPeer(parsed.instanceId, instance.endpoint)
		}

		logger.info(
			`Peer discovered: ${instance.name} (${instance.id.substring(0, 8)}) — ${instance.capabilities.join(', ')}`,
		)

		// Trigger re-election now that a new peer joined
		this.onPeerChanged?.()

		// Send response with our info
		const response = createMessage(
			'discover:response',
			this.config.instanceId,
			parsed.instanceId,
			{
				name: this.config.instanceName,
				publicKey: this.config.publicKeyString,
				endpoint: this.config.endpoint,
				capabilities: this.config.capabilities,
				role: this.config.role,
				version: '3.0.0',
			},
			this.config.privateKey,
		)
		this.transport.sendToPeer(parsed.instanceId, response)

		// Request their tool list
		const toolReq = createMessage(
			'tool:list',
			this.config.instanceId,
			parsed.instanceId,
			{},
			this.config.privateKey,
		)
		this.transport.sendToPeer(parsed.instanceId, toolReq)
	}

	/**
	 * Handle discovery response.
	 */
	private handleDiscoverResponse(message: VoleNetMessage): void {
		// Same as discover but don't send a response back (avoid loop)
		const info = message.payload as Partial<VoleNetInstance>
		if (!info.publicKey || !info.name) return

		const parsed = parsePublicKey(info.publicKey)
		if (!parsed) return
		const authPeer = this.authorizedPeers.get(parsed.instanceId)
		if (!authPeer) return

		// Verify the signature before trusting the payload (and before any auto-upgrade).
		const result = verifyMessage(message, authPeer.publicKey, authPeer.pqPublicKey)
		if (!result.valid) {
			logger.warn(`Discover-response verification failed from ${info.name}: ${result.error}`)
			return
		}

		// Auto-upgrade trust to hybrid PQ when this known peer announces an ML-DSA key
		// (its discover-response was just verified, so the announced PQ key is authentic).
		if (parsed.pqPublicKey && !authPeer.pqPublicKey) {
			authPeer.pqPublicKey = parsed.pqPublicKey
			void trustPeer(this.config.netDir, info.publicKey).catch(() => {})
			logger.info(`Auto-upgraded peer to hybrid PQ: ${info.name} (${parsed.instanceId.substring(0, 8)})`)
		}

		const instance: VoleNetInstance = {
			id: parsed.instanceId,
			name: info.name,
			publicKey: info.publicKey,
			endpoint: info.endpoint ?? '',
			capabilities: info.capabilities ?? [],
			role: (info.role as VoleNetInstance['role']) ?? 'peer',
			load: 0,
			maxTasks: 5,
			lastSeen: Date.now(),
			version: info.version ?? 'unknown',
		}

		this.instances.set(parsed.instanceId, instance)
		if (instance.endpoint) {
			this.transport.addPeer(parsed.instanceId, instance.endpoint)
		}

		logger.info(`Peer confirmed: ${instance.name} (${instance.id.substring(0, 8)})`)
		this.onPeerChanged?.()
	}

	private handlePing(message: VoleNetMessage): void {
		const instance = this.instances.get(message.from)
		if (instance) instance.lastSeen = Date.now()

		const pong = createMessage(
			'pong',
			this.config.instanceId,
			message.from,
			{ timestamp: Date.now() },
			this.config.privateKey,
		)
		this.transport.sendToPeer(message.from, pong)
	}

	private handlePong(message: VoleNetMessage): void {
		const instance = this.instances.get(message.from)
		if (instance) instance.lastSeen = Date.now()
	}

	private handleToolList(message: VoleNetMessage): void {
		const tools = message.payload as RemoteToolInfo[]
		if (Array.isArray(tools)) {
			this.remoteTools.set(message.from, tools)
			logger.info(`Received ${tools.length} tools from ${message.from.substring(0, 8)}`)
		}
	}

	/**
	 * Health check — ping all peers, remove stale ones.
	 */
	private async healthCheck(): Promise<void> {
		const now = Date.now()

		for (const [id, instance] of this.instances) {
			if (now - instance.lastSeen > PEER_TIMEOUT_MS) {
				logger.warn(
					`Peer timeout: ${instance.name} (${id.substring(0, 8)}) — last seen ${Math.round((now - instance.lastSeen) / 1000)}s ago`,
				)
				this.instances.delete(id)
				this.transport.removePeer(id)
				this.remoteTools.delete(id)
				continue
			}

			// Send ping
			const ping = createMessage(
				'ping',
				this.config.instanceId,
				id,
				{ timestamp: now },
				this.config.privateKey,
			)
			this.transport.sendToPeer(id, ping)
		}
	}

	/**
	 * Get all connected instances.
	 */
	getInstances(): VoleNetInstance[] {
		return Array.from(this.instances.values())
	}

	/**
	 * Get all remote tools across all peers.
	 */
	getRemoteTools(): RemoteToolInfo[] {
		const tools: RemoteToolInfo[] = []
		for (const [, peerTools] of this.remoteTools) {
			tools.push(...peerTools)
		}
		return tools
	}

	/**
	 * Find which peer has a specific tool.
	 */
	findToolOwner(toolName: string): { instanceId: string; instance: VoleNetInstance } | null {
		for (const [instanceId, tools] of this.remoteTools) {
			if (tools.some((t) => t.name === toolName)) {
				const instance = this.instances.get(instanceId)
				if (instance) return { instanceId, instance }
			}
		}
		return null
	}

	/**
	 * Reload authorized peers from disk.
	 */
	async reloadAuthorized(): Promise<void> {
		this.authorizedPeers = await loadAuthorizedVoles(this.config.netDir)
		logger.info(`Reloaded ${this.authorizedPeers.size} authorized peer(s)`)
	}
}
