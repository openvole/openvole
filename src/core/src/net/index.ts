/**
 * VoleNet Manager — lifecycle management for the distributed networking layer.
 * Initializes transport, discovery, and key management.
 * Starts/stops with the engine.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createLogger } from '../core/logger.js'
import type { ToolRegistry } from '../tool/registry.js'
import { type DiscoveryConfig, VoleNetDiscovery } from './discovery.js'
import {
	type VoleKeyPair,
	generateKeyPair,
	loadAuthorizedVoles,
	loadKeyPair,
	parsePublicKey,
	trustPeer,
} from './keys.js'
import { VoleNetLeader } from './leader.js'
import {
	type RemoteToolInfo,
	type VoleNetInstance,
	createMessage,
	setPqSigningKey,
} from './protocol.js'
import { RemoteTaskManager } from './remote-task.js'
import { type SyncConfig, VoleNetSync } from './sync.js'
import { type TransportConfig, VoleNetTransport } from './transport.js'

const logger = createLogger('volenet')

const DEFAULT_CHAT_MAX_MESSAGES = 1000
const DEFAULT_CHAT_MAX_AGE_DAYS = 90
const CHAT_PRUNE_INTERVAL_MS = 6 * 60 * 60_000 // prune stale chat sessions every 6h

/** Glob-ish tool-name match: exact, '*' wildcard, or 'prefix*'. */
/**
 * Display prefix for a peer's namespaced tools. Peer names are self-announced labels —
 * identity is the key-derived instanceId — so when two peers share a name, the prefix
 * is disambiguated with a short id suffix: alice~3f9c/tool.
 */
export function peerPrefix(peerName: string, peerId: string, duplicateName: boolean): string {
	return duplicateName ? `${peerName}~${peerId.substring(0, 4)}` : peerName
}

/** Whether a tool passes the share-level allowlist (empty/absent allows all). */
export function isSharedTool(name: string, toolAllow?: string[]): boolean {
	if (!toolAllow || toolAllow.length === 0) return true
	return toolAllow.some((p) => matchToolPattern(p, name))
}

function matchToolPattern(pattern: string, name: string): boolean {
	if (pattern === '*' || pattern === name) return true
	if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1))
	return false
}

export interface VoleNetConfig {
	enabled?: boolean
	instanceName?: string
	role?: 'coordinator' | 'worker' | 'peer'
	port?: number
	/**
	 * Hostname this instance advertises to peers (the host in its discovery endpoint).
	 * Defaults to the first non-internal IPv4 address. Set this to your public domain
	 * (e.g. "hub.example.com") when running with TLS so the advertised endpoint matches
	 * the certificate — otherwise peers connecting over wss/https hit a name mismatch.
	 * Overridable at runtime via the VOLE_NET_HOSTNAME env var.
	 */
	hostname?: string
	/**
	 * Full endpoint advertised to peers INSTEAD of `<scheme>://<hostname>:<port>` — for running
	 * VoleNet behind a reverse proxy so the raw listen port never has to be exposed. Example:
	 * "https://club.example.com/mesh", with nginx proxying that path (WebSocket upgrade included)
	 * to the local VoleNet port. Peers join with this URL and are told to reconnect to it; the
	 * joining side needs nothing — all peer traffic is endpoint-relative and the WS upgrade is
	 * accepted on any path. Env override: VOLE_NET_PUBLIC_URL.
	 */
	publicUrl?: string
	keyPath?: string
	peers?: Array<{
		url: string
		/** What this peer can do on OUR instance */
		trust?: 'full' | 'tool' | 'read'
		allowTools?: string[]
		denyTools?: string[]
		/** Allow this peer to use our Brain for their tasks (LLM cost on us) */
		allowBrain?: boolean
	}>
	share?: {
		tools?: boolean
		memory?: boolean
		session?: boolean
		/**
		 * Patterns limiting WHICH tools are shared (advertised + callable) to peers without
		 * an explicit per-peer allowTools entry — e.g. ["club_*"]. Empty/absent = all tools.
		 * Essential for public hubs: share one curated tool set with strangers.
		 */
		toolAllow?: string[]
	}
	/** Retention for node-to-node chat sessions (volenet:<peer>). */
	chatRetention?: {
		/** Max messages kept per peer transcript (oldest trimmed). Default 1000. */
		maxMessages?: number
		/** Clear chat sessions idle longer than this many days. Default 90; 0 disables. */
		maxAgeDays?: number
	}

	/**
	 * Brain source for brainless workers:
	 * - "local" (default): use local brain paw
	 * - "remote": delegate thinking to a peer that allows brain sharing
	 * - "<instanceName>": delegate to a specific peer's brain
	 */
	brainSource?: 'local' | 'remote' | string
	tls?: {
		cert: string
		key: string
	}
	/** Max concurrent inbound VoleNet WebSocket connections (DoS). Default 1000. */
	maxConnections?: number
	/** Close inbound WS that don't send a verified message within this many ms (DoS). Default 10000. */
	authTimeoutMs?: number
	/** Global inbound message ceiling per second across all sources (load shed). Default 5000. */
	maxMessagesPerSecond?: number
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

	/**
	 * Public self-join — let unknown peers register over HTTP and join at a restricted
	 * "guest" trust level (for a public mesh hub). Off by default. Guests are NEVER 'full'.
	 */
	publicJoin?: {
		enabled?: boolean
		/** Trust granted to self-joined guests. Never 'full'. Default 'tool'. */
		trustLevel?: 'read' | 'tool'
		/** Let guests use OUR Brain (LLM cost on us). Default false. */
		allowBrain?: boolean
		/** Max trusted peers before new joins are refused. Default 200. */
		maxPeers?: number
		/** Join requests allowed per minute per IP. Default 5. */
		ratePerMinute?: number
		/** Queue joins to pending_joins.jsonl for manual `vole net trust` instead of auto-trusting. */
		requireApproval?: boolean
	}
}

/** A single human-capable peer-chat message, stored per peer for the dashboard. */
export interface ChatEntry {
	dir: 'in' | 'out'
	text: string
	fromName: string
	timestamp: number
	messageId: string
}

export class VoleNetManager {
	private keyPair: VoleKeyPair | null = null
	private transport: VoleNetTransport | null = null
	private discovery: VoleNetDiscovery | null = null
	private remoteTaskMgr: RemoteTaskManager | null = null
	private sync: VoleNetSync | null = null
	private leader: VoleNetLeader | null = null
	private toolProviders = new Map<string, string[]>()
	/** registered remote tool name → owning instanceId (identity-keyed routing; never by peer name) */
	private remoteToolOwners = new Map<string, string>()
	private config: VoleNetConfig
	private projectRoot: string
	private toolRegistry: ToolRegistry | null = null
	private started = false
	/** Per-IP join timestamps for public-join rate limiting. */
	private joinTimestamps = new Map<string, number[]>()
	/** Per-peer human chat logs (in-memory; keyed by peer instanceId). */
	private chatLog = new Map<string, ChatEntry[]>()
	/** Periodically re-attempts configured peers — self-heals start-order races + drops. */
	private peerConnectTimer?: ReturnType<typeof setInterval>
	/** Periodic chat-session retention prune. */
	private chatPruneTimer?: ReturnType<typeof setInterval>

	constructor(config: VoleNetConfig, projectRoot: string) {
		this.config = config
		this.projectRoot = projectRoot
	}

	/**
	 * Start VoleNet — load keys, start transport, connect to peers.
	 */
	async start(
		toolRegistry?: ToolRegistry,
		bus?: import('../core/bus.js').MessageBus,
	): Promise<void> {
		if (this.started) return
		if (!this.config.enabled) return

		this.toolRegistry = toolRegistry ?? null
		const messageBus = bus
		const netDir = this.getNetDir()

		// Load or generate keypair
		this.keyPair = await loadKeyPair(netDir)
		if (!this.keyPair) {
			logger.info('No keypair found — generating new Ed25519 keypair')
			this.keyPair = await generateKeyPair(netDir, this.config.instanceName ?? 'vole')
		}

		logger.info(`Instance ID: ${this.keyPair.instanceId}`)
		logger.info(`Public key: ${this.keyPair.publicKeyString}`)
		// Activate the post-quantum signing key (when this keypair has one) for hybrid signatures.
		setPqSigningKey(this.keyPair.pqPrivateKey)

		// Start transport
		const port = this.config.port ?? 9700
		const transportConfig: TransportConfig = {
			port,
			tls: this.config.tls,
			maxConnections: this.config.maxConnections,
			authTimeoutMs: this.config.authTimeoutMs,
			maxMessagesPerSecond: this.config.maxMessagesPerSecond,
		}
		this.transport = new VoleNetTransport(transportConfig)
		await this.transport.start()

		// Start discovery
		const endpoint = buildAdvertisedEndpoint({
			publicUrl: this.config.publicUrl ?? process.env.VOLE_NET_PUBLIC_URL,
			tls: !!this.config.tls,
			hostname: this.getHostname(),
			port,
		})

		const discoveryConfig: DiscoveryConfig = {
			netDir,
			instanceId: this.keyPair.instanceId,
			instanceName: this.config.instanceName ?? 'vole',
			role: this.config.role ?? 'peer',
			endpoint,
			capabilities: this.getCapabilities(),
			privateKey: this.keyPair.privateKey,
			publicKeyString: this.keyPair.publicKeyString,
			configuredPeerUrls: (this.config.peers ?? []).map((p) => p.url),
		}
		this.discovery = new VoleNetDiscovery(this.transport, discoveryConfig)
		await this.discovery.start()

		// Bind the transport's WS authentication + inline HTTP discovery reply to discovery's
		// keystore: sockets are only bound to a peer id after a verified message, and NAT'd peers
		// learn our identity from their own discover request's response body.
		const discovery = this.discovery
		this.transport.setVerifier((m) => discovery.verifyMessageFrom(m))
		this.transport.setResponder((m) => discovery.buildDiscoverResponse(m))

		// Public self-join: accept HTTP join requests from unknown peers (restricted guest trust).
		if (this.config.publicJoin?.enabled) {
			this.transport.setJoinHandler((body, ip) => this.handlePublicJoin(body, ip))
			logger.info(
				`Public join enabled — guests get '${this.config.publicJoin.trustLevel ?? 'tool'}' trust, allowBrain=${this.config.publicJoin.allowBrain ?? false}`,
			)
		}

		// Handle tool:list requests — respond with our local tools
		this.transport.onMessage((message) => {
			if (message.type === 'tool:list' && this.toolRegistry && this.keyPair) {
				if (!this.discovery?.verifyMessageFrom(message)) return
				if (!this.peerToolsEnabled(message.from)) return
				const tools: RemoteToolInfo[] = this.toolRegistry
					.list()
					.filter((t) => !t.pawName.startsWith('__volenet')) // don't echo remote tools back
					.filter((t) => isSharedTool(t.name, this.config.share?.toolAllow))
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
				if (!this.discovery?.verifyMessageFrom(message)) {
					logger.warn(`Rejected unverified tool:call from ${message.from.substring(0, 8)}`)
					return
				}
				const { callId, toolName, params } = message.payload as {
					callId: string
					toolName: string
					params: unknown
				}
				logger.info(
					`Remote tool call from ${message.from.substring(0, 8)}: ${toolName}(${JSON.stringify(params)})`,
				)

				if (!this.isPeerAllowedTool(message.from, toolName)) {
					logger.warn(`Tool access denied for ${message.from.substring(0, 8)}: ${toolName}`)
					this.transport!.sendToPeer(
						message.from,
						createMessage(
							'tool:result',
							this.keyPair.instanceId,
							message.from,
							{ callId, success: false, error: `Tool access not allowed: ${toolName}` },
							this.keyPair.privateKey,
						),
					)
					return
				}

				const tool = this.toolRegistry.get(toolName)
				let response
				if (!tool) {
					logger.warn(`Remote tool call failed: "${toolName}" not found`)
					response = createMessage(
						'tool:result',
						this.keyPair.instanceId,
						message.from,
						{
							callId,
							success: false,
							error: `Tool "${toolName}" not found`,
						},
						this.keyPair.privateKey,
					)
				} else {
					try {
						const startTime = Date.now()
						// Attach the transport-verified caller so tools can attribute actions
						// (e.g. paw-club posts). Always overwritten — a peer-supplied __caller can
						// never impersonate another instance.
						const callerName = this.discovery
							?.getInstances()
							.find((i) => i.id === message.from)?.name
						const output = await tool.execute(withVerifiedCaller(params, message.from, callerName))
						const durationMs = Date.now() - startTime
						const outputPreview =
							typeof output === 'string'
								? output.substring(0, 200)
								: JSON.stringify(output).substring(0, 200)
						logger.info(
							`Remote tool call completed: ${toolName} → success (${durationMs}ms) — ${outputPreview}`,
						)
						messageBus?.emit('volenet:tool:executed', {
							toolName,
							fromInstance: message.from.substring(0, 8),
							success: true,
							durationMs,
						})
						response = createMessage(
							'tool:result',
							this.keyPair.instanceId,
							message.from,
							{
								callId,
								success: true,
								output,
							},
							this.keyPair.privateKey,
						)
					} catch (err) {
						const errorMsg = err instanceof Error ? err.message : String(err)
						logger.error(`Remote tool call failed: ${toolName} → ${errorMsg}`)
						messageBus?.emit('volenet:tool:executed', {
							toolName,
							fromInstance: message.from.substring(0, 8),
							success: false,
							durationMs: 0,
							error: errorMsg,
						})
						response = createMessage(
							'tool:result',
							this.keyPair.instanceId,
							message.from,
							{
								callId,
								success: false,
								error: errorMsg,
							},
							this.keyPair.privateKey,
						)
					}
				}
				await this.transport!.sendToPeer(message.from, response)
				logger.info(`Remote tool result sent to ${message.from.substring(0, 8)}`)
			}
		})

		// When peer tool lists arrive, register them as remote tools in local registry
		this.transport.onMessage((message) => {
			if (
				message.type === 'tool:list:response' &&
				this.toolRegistry &&
				this.keyPair &&
				this.remoteTaskMgr
			) {
				const tools = message.payload as RemoteToolInfo[]
				if (!Array.isArray(tools) || tools.length === 0) return

				const remoteTaskMgr = this.remoteTaskMgr
				const sourceInstanceId = message.from

				const peerInstance = this.discovery?.getInstances().find((i) => i.id === message.from)
				const peerName = peerInstance?.name ?? message.from.substring(0, 8)
				// Names are labels, not identity: disambiguate everything by id when peers collide.
				const sourceDup =
					(this.discovery?.getInstances() ?? []).filter((i) => i.name === peerName).length > 1
				if (sourceDup) {
					logger.warn(
						`Two peers share the name "${peerName}" — tools disambiguated as ${peerPrefix(peerName, message.from, true)}/<tool>`,
					)
				}
				const pawLabel = `__volenet:${peerPrefix(peerName, message.from, sourceDup)}__`

				// Track which peers provide which tools (for load-balanced routing)
				for (const t of tools) {
					if (!this.toolProviders) this.toolProviders = new Map()
					const providers = this.toolProviders.get(t.name) ?? []
					if (!providers.includes(sourceInstanceId)) {
						providers.push(sourceInstanceId)
						this.toolProviders.set(t.name, providers)
					}
				}

				const discovery = this.discovery!
				const toolProviders = this.toolProviders!

				// Create wrapper tool definitions — handle duplicates with peer-specific names
				const remoteToolDefs: Array<{
					name: string
					description: string
					parameters: any
					execute: (params: unknown) => Promise<unknown>
				}> = []

				for (const t of tools) {
					const existingTool = this.toolRegistry!.get(t.name)
					const isLocalTool = existingTool && !existingTool.pawName.startsWith('__volenet')

					if (isLocalTool) {
						// Don't override local tools — skip
						continue
					}

					// Re-announcement from the same peer (no other provider) — nothing to conflict with.
					const otherProviders = (toolProviders.get(t.name) ?? []).filter(
						(id) => id !== sourceInstanceId,
					)
					if (existingTool && otherProviders.length === 0) continue

					if (existingTool) {
						// Another peer already registered this tool name — we have a conflict.
						// Route by IDENTITY: the recorded owner of the plain-name registration,
						// never a name lookup, and never a fall-back to the announcing peer.
						const existingOwnerId = this.remoteToolOwners.get(t.name) ?? otherProviders[0]

						// Only rename existing if it hasn't been renamed yet (still plain name)
						if (!existingTool.name.includes('/') && existingOwnerId) {
							const existingInst = discovery.getInstances().find((i) => i.id === existingOwnerId)
							const existingName = existingInst?.name ?? existingOwnerId.substring(0, 8)
							const existingDup =
								existingName === peerName ||
								discovery.getInstances().filter((i) => i.name === existingName).length > 1
							const renamedTo = `${peerPrefix(existingName, existingOwnerId, existingDup)}/${t.name}`
							const ownerId = existingOwnerId
							const renamedExisting = {
								name: renamedTo,
								description: existingTool.description,
								parameters: { parse: () => {} } as any,
								async execute(params: unknown) {
									const result = await remoteTaskMgr.executeRemoteTool(ownerId, t.name, params)
									if (result.success) return result.output
									throw new Error(result.error ?? 'Remote tool execution failed')
								},
							}
							this.toolRegistry!.register(existingTool.pawName, [renamedExisting], false)
							this.remoteToolOwners.set(renamedTo, ownerId)
							// The plain name lives on as a load-balanced alias across all providers.
							this.remoteToolOwners.delete(t.name)
							logger.info(`Renamed remote tool ${t.name} → ${renamedTo} (conflict resolution)`)
						}

						// Register the new peer's tool under its (possibly id-suffixed) prefix
						const newDup =
							sourceDup ||
							(existingOwnerId !== undefined &&
								(discovery.getInstances().find((i) => i.id === existingOwnerId)?.name ?? '') ===
									peerName)
						const prefixedName = `${peerPrefix(peerName, sourceInstanceId, newDup)}/${t.name}`
						this.remoteToolOwners.set(prefixedName, sourceInstanceId)
						remoteToolDefs.push({
							name: prefixedName,
							description: `[remote: ${peerName}] ${t.description}`,
							parameters: { parse: () => {} } as any,
							async execute(params: unknown) {
								const result = await remoteTaskMgr.executeRemoteTool(
									sourceInstanceId,
									t.name,
									params,
								)
								if (result.success) return result.output
								throw new Error(result.error ?? 'Remote tool execution failed')
							},
						})
					} else {
						// First registration — plain name, load-balanced across providers by id.
						// Record the owner so a future conflict can rename it correctly.
						this.remoteToolOwners.set(t.name, sourceInstanceId)
						remoteToolDefs.push({
							name: t.name,
							description: `[remote: ${peerName}] ${t.description}`,
							parameters: { parse: () => {} } as any,
							async execute(params: unknown) {
								// Pick best peer: least loaded among all providers of this tool
								const providers = toolProviders.get(t.name) ?? [sourceInstanceId]
								let targetId = providers[0]

								if (providers.length > 1) {
									const instances = discovery.getInstances()
									let bestLoad = Number.POSITIVE_INFINITY
									for (const pid of providers) {
										const inst = instances.find((i) => i.id === pid)
										if (inst && inst.load < bestLoad) {
											bestLoad = inst.load
											targetId = pid
										}
									}
								}

								const result = await remoteTaskMgr.executeRemoteTool(targetId, t.name, params)
								if (result.success) return result.output
								throw new Error(result.error ?? 'Remote tool execution failed')
							},
						})
					}
				}

				if (remoteToolDefs.length > 0) {
					this.toolRegistry!.register(pawLabel, remoteToolDefs, false)
					logger.info(
						`Registered ${remoteToolDefs.length} remote tools from ${peerName} as ${pawLabel}`,
					)
				}
			}
		})

		// Handle incoming task:delegate — run task with our brain if allowed
		this.transport.onMessage(async (message) => {
			if (message.type === 'task:delegate' && this.keyPair) {
				if (!this.discovery?.verifyMessageFrom(message)) {
					logger.warn(`Rejected unverified task:delegate from ${message.from.substring(0, 8)}`)
					return
				}
				const request = message.payload as {
					taskId: string
					input: string
					maxIterations?: number
					fromName?: string
				}
				if (!request?.input) return

				// Check if this peer is allowed to use our brain
				if (!this.isPeerAllowedBrain(message.from)) {
					logger.warn(`Brain access denied for peer ${message.from.substring(0, 8)}`)
					const deny = createMessage(
						'task:result',
						this.keyPair.instanceId,
						message.from,
						{
							taskId: request.taskId,
							status: 'failed',
							error:
								'Brain access not allowed. Coordinator must set allowBrain: true for this peer.',
						},
						this.keyPair.privateKey,
					)
					await this.transport!.sendToPeer(message.from, deny)
					return
				}

				logger.info(
					`Brain delegation from ${message.from.substring(0, 8)}: "${request.input.substring(0, 80)}"`,
				)
				messageBus?.emit('task:queued', { taskId: request.taskId })

				// Enqueue the task locally — it will run through our brain
				const taskQueue = (globalThis as any).__volenet_taskqueue__
				if (taskQueue) {
					// Chat messages (net_message) carry fromName — frame as a peer message and
					// run in a per-peer session for conversational continuity. Tasks stay one-shot.
					const isChat = typeof request.fromName === 'string' && request.fromName.length > 0
					const runInput = isChat
						? `[Message from peer agent "${request.fromName}"] ${request.input}`
						: request.input
					const runSource = isChat ? `net:${message.from.substring(0, 8)}` : 'agent'
					const task = taskQueue.enqueue(runInput, runSource, {
						metadata: {
							maxIterations: request.maxIterations ?? 10,
							remotePeerId: message.from,
							remoteTaskId: request.taskId,
						},
					})

					// Wait for completion and send result back
					const checkInterval = setInterval(async () => {
						const t = taskQueue.get(task.id)
						if (
							t &&
							(t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
						) {
							clearInterval(checkInterval)
							const result = createMessage(
								'task:result',
								this.keyPair!.instanceId,
								message.from,
								{
									taskId: request.taskId,
									status: t.status,
									result: t.result,
									error: t.error,
								},
								this.keyPair!.privateKey,
							)
							await this.transport!.sendToPeer(message.from, result)
							logger.info(
								`Brain delegation result sent to ${message.from.substring(0, 8)}: ${t.status}`,
							)
						}
					}, 1000)
				} else {
					const noQueue = createMessage(
						'task:result',
						this.keyPair.instanceId,
						message.from,
						{
							taskId: request.taskId,
							status: 'failed',
							error: 'Task queue not available',
						},
						this.keyPair.privateKey,
					)
					await this.transport!.sendToPeer(message.from, noQueue)
				}
			}
		})

		// Handle incoming chat:message — human-capable peer chat. Unlike task:delegate,
		// this does NOT run the brain: it verifies the sender, stores the message, and
		// emits a bus event so the dashboard can surface it for a human (or brain) reply.
		this.transport.onMessage((message) => {
			if (message.type !== 'chat:message') return
			if (!this.discovery?.verifyMessageFrom(message)) {
				logger.warn(`Rejected unverified chat message from ${message.from.substring(0, 8)}`)
				return
			}
			const payload = message.payload as { text?: string; fromName?: string }
			if (!payload?.text) return
			const fromName = payload.fromName || message.from.substring(0, 8)
			void this.appendChat(message.from, {
				dir: 'in',
				text: payload.text,
				fromName,
				timestamp: message.timestamp,
				messageId: message.id,
			})
			messageBus?.emit('volenet:chat', {
				from: message.from,
				fromName,
				text: payload.text,
				messageId: message.id,
				timestamp: message.timestamp,
			})
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

		// Set up session sync handler — write remote session entries to local transcript
		this.sync.setSessionWriteHandler(async (entry) => {
			const fs = await import('node:fs/promises')
			const pathMod = await import('node:path')
			const sessionDir = pathMod.resolve(
				this.projectRoot,
				'.openvole',
				'paws',
				'paw-session',
				entry.sessionId.replace(/[/\\]/g, '_'),
			)
			await fs.mkdir(sessionDir, { recursive: true })
			const transcriptPath = pathMod.join(sessionDir, 'transcript.md')
			const timestamp = new Date(entry.timestamp).toTimeString().slice(0, 8)
			const line = `[${timestamp}] ${entry.role}: ${entry.content.replace(/\n/g, ' ').substring(0, 2000)}\n`
			await fs.appendFile(transcriptPath, line, 'utf-8')
			logger.info(
				`Session sync received: ${entry.sessionId} — ${entry.role} from ${entry.instanceId.substring(0, 8)}`,
			)
		})

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

		// Re-elect leader immediately when peers join/leave
		this.discovery.setOnPeerChanged(() => {
			this.leader?.reelect()
		})

		// Make VoleNet accessible to core tools via globalThis
		;(globalThis as any).__volenet__ = this

		// Connect to configured peers
		if (this.config.peers) {
			for (const peer of this.config.peers) {
				logger.info(`Connecting to peer: ${peer.url}`)
				await this.discovery.connectToPeer(peer.url)
			}
			// Re-attempt configured peers periodically so the mesh self-heals from
			// start-order races (a peer not up yet) and transient drops. connectToPeer
			// pings first and is idempotent, so re-announcing to connected peers is cheap.
			this.peerConnectTimer = setInterval(() => {
				for (const peer of this.config.peers ?? []) {
					this.discovery?.connectToPeer(peer.url).catch(() => {})
				}
			}, 15_000)
		}

		// Periodically prune stale node-chat sessions (retention).
		void this.pruneChatSessions()
		this.chatPruneTimer = setInterval(() => void this.pruneChatSessions(), CHAT_PRUNE_INTERVAL_MS)

		this.started = true
		logger.info(`VoleNet started — ${this.config.role ?? 'peer'} mode, port ${port}`)
	}

	/**
	 * Stop VoleNet — disconnect peers, stop transport.
	 */
	async stop(): Promise<void> {
		if (!this.started) return

		if (this.peerConnectTimer) clearInterval(this.peerConnectTimer)
		this.peerConnectTimer = undefined
		if (this.chatPruneTimer) clearInterval(this.chatPruneTimer)
		this.chatPruneTimer = undefined
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
		setPqSigningKey(undefined)
		;(globalThis as any).__volenet__ = undefined

		logger.info('VoleNet stopped')
	}

	/**
	 * Get connected instances.
	 */
	getInstances(): VoleNetInstance[] {
		return this.discovery?.getInstances() ?? []
	}

	/** Session ID for a peer's human-chat transcript (persisted via paw-session). */
	private chatSessionId(peerId: string): string {
		return `volenet:${peerId}`
	}

	/**
	 * Append a chat entry for a peer. Persists via paw-session's session_append tool
	 * when available; otherwise falls back to an in-memory log (capped at 200).
	 */
	private async appendChat(peerId: string, entry: ChatEntry): Promise<void> {
		const tool = this.toolRegistry?.get('session_append')
		if (tool) {
			try {
				await tool.execute({
					sessionId: this.chatSessionId(peerId),
					role: entry.dir,
					content: entry.text,
					maxMessages: this.config.chatRetention?.maxMessages ?? DEFAULT_CHAT_MAX_MESSAGES,
				})
				return
			} catch (err) {
				logger.warn(
					`session_append failed, using memory: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}
		const log = this.chatLog.get(peerId) ?? []
		log.push(entry)
		if (log.length > 200) log.splice(0, log.length - 200)
		this.chatLog.set(peerId, log)
	}

	/**
	 * Get the human-chat history with a peer. Reads from paw-session when available,
	 * otherwise the in-memory fallback.
	 */
	async getChatHistory(peerId: string): Promise<ChatEntry[]> {
		// Only read from the session store when writes also go there (session_append present),
		// so a half-upgraded paw-session can't shadow the in-memory log with an empty session.
		const tool = this.toolRegistry?.get('session_append')
			? this.toolRegistry?.get('session_history')
			: undefined
		if (tool) {
			try {
				const res = (await tool.execute({
					sessionId: this.chatSessionId(peerId),
					maxMessages: 500,
				})) as { ok?: boolean; history?: Array<{ ts?: string; role: string; content: string }> }
				if (res?.history) {
					const myName = this.getInstanceName()
					const peerName =
						this.getInstances().find((i) => i.id === peerId)?.name ?? peerId.substring(0, 8)
					return res.history.map((m) => ({
						dir: m.role === 'out' ? ('out' as const) : ('in' as const),
						text: m.content,
						fromName: m.role === 'out' ? myName : peerName,
						timestamp: m.ts ? Date.parse(m.ts) || 0 : 0,
						messageId: '',
					}))
				}
			} catch (err) {
				logger.warn(
					`session_history failed, using memory: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}
		return this.chatLog.get(peerId) ?? []
	}

	/** Clear the human-chat history with a peer (paw-session or in-memory). */
	async clearChat(peerId: string): Promise<void> {
		const tool = this.toolRegistry?.get('session_append')
			? this.toolRegistry?.get('session_clear')
			: undefined
		if (tool) {
			try {
				await tool.execute({ sessionId: this.chatSessionId(peerId) })
				return
			} catch {
				// fall through to in-memory
			}
		}
		this.chatLog.delete(peerId)
	}

	/** Clear chat sessions (volenet:*) idle longer than the retention age cap. */
	private async pruneChatSessions(): Promise<void> {
		const maxAgeDays = this.config.chatRetention?.maxAgeDays ?? DEFAULT_CHAT_MAX_AGE_DAYS
		if (!maxAgeDays || maxAgeDays <= 0) return
		const listTool = this.toolRegistry?.get('session_list')
		const clearTool = this.toolRegistry?.get('session_clear')
		if (!listTool || !clearTool) return
		try {
			const res = (await listTool.execute({})) as {
				sessions?: Array<{ sessionId: string; lastActive?: string | null }>
			}
			const cutoff = Date.now() - maxAgeDays * 86_400_000
			for (const s of res.sessions ?? []) {
				if (!s.sessionId.startsWith('volenet:')) continue
				const last = s.lastActive ? Date.parse(s.lastActive) : 0
				if (last && last < cutoff) {
					await clearTool.execute({ sessionId: s.sessionId })
					logger.info(`Pruned stale chat session (idle > ${maxAgeDays}d): ${s.sessionId}`)
				}
			}
		} catch (err) {
			logger.warn(
				`Chat retention prune failed: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}

	/**
	 * Send a human chat message to a peer. Does NOT invoke any brain.
	 * Resolves the peer by id or name, signs + sends a chat:message, and logs it locally.
	 */
	async sendChat(
		peerId: string,
		text: string,
	): Promise<{ ok: boolean; delivered?: boolean; error?: string }> {
		if (!this.keyPair || !this.transport) return { ok: false, error: 'VoleNet not started' }
		const target = this.getInstances().find(
			(i) => i.id === peerId || i.name === peerId || i.id.startsWith(peerId),
		)
		if (!target) return { ok: false, error: `No connected peer: "${peerId}"` }
		const fromName = this.getInstanceName()
		const msg = createMessage(
			'chat:message',
			this.keyPair.instanceId,
			target.id,
			{ text, fromName },
			this.keyPair.privateKey,
		)
		const delivered = await this.transport.sendToPeer(target.id, msg)
		await this.appendChat(target.id, {
			dir: 'out',
			text,
			fromName,
			timestamp: msg.timestamp,
			messageId: msg.id,
		})
		return { ok: true, delivered }
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
	 * Check if this instance should delegate thinking to a remote brain.
	 * Returns the target peer instance ID, or null if local brain should be used.
	 */
	shouldDelegateBrain(): string | null {
		const brainSource = this.config.brainSource
		if (!brainSource || brainSource === 'local') return null

		const instances = this.discovery?.getInstances() ?? []
		if (instances.length === 0) return null

		if (brainSource === 'remote') {
			// Find any peer — preferring coordinators
			const sorted = [...instances].sort((a, b) => {
				if (a.role === 'coordinator' && b.role !== 'coordinator') return -1
				if (b.role === 'coordinator' && a.role !== 'coordinator') return 1
				return 0
			})
			return sorted[0]?.id ?? null
		}

		// Specific instance name
		const target = instances.find((i) => i.name === brainSource)
		return target?.id ?? null
	}

	/** Handle a public self-join request (HTTP POST /volenet/join). Returns status + JSON body. */
	async handlePublicJoin(body: unknown, ip: string): Promise<{ status: number; json: unknown }> {
		const pj = this.config.publicJoin
		if (!pj?.enabled) return { status: 404, json: { error: 'public join disabled' } }

		const { publicKey, name } = (body ?? {}) as { publicKey?: string; name?: string }
		if (!publicKey || !parsePublicKey(publicKey)) {
			return { status: 400, json: { error: 'invalid public key' } }
		}

		// Rate limit per IP.
		const now = Date.now()
		const rpm = pj.ratePerMinute ?? 5
		// Prune stale per-IP windows so the join map can't grow unbounded under IP-spray.
		if (this.joinTimestamps.size > 4096) {
			for (const [k, ts] of this.joinTimestamps) {
				if (ts.length === 0 || now - ts[ts.length - 1] > 60_000) this.joinTimestamps.delete(k)
			}
		}
		const recent = (this.joinTimestamps.get(ip) ?? []).filter((t) => now - t < 60_000)
		if (recent.length >= rpm) return { status: 429, json: { error: 'rate limited' } }
		recent.push(now)
		this.joinTimestamps.set(ip, recent)

		const netDir = this.getNetDir()
		await fs.mkdir(netDir, { recursive: true })
		const safeName = (name ?? 'guest').slice(0, 64)

		// Manual-approval mode: queue the request, do not auto-trust.
		if (pj.requireApproval) {
			await fs.appendFile(
				path.join(netDir, 'pending_joins.jsonl'),
				`${JSON.stringify({ publicKey, name: safeName, ip, at: new Date().toISOString() })}\n`,
				'utf-8',
			)
			return {
				status: 202,
				json: { ok: true, pending: true, message: 'Join request received — pending approval.' },
			}
		}

		// Peer cap.
		const existing = await loadAuthorizedVoles(netDir)
		if (existing.size >= (pj.maxPeers ?? 200)) {
			return { status: 503, json: { error: 'mesh is full' } }
		}

		await trustPeer(netDir, publicKey, { allowUpgrade: false })
		await this.discovery?.reloadAuthorized()
		logger.info(`Public join: trusted guest "${safeName}" from ${ip}`)
		return {
			status: 200,
			json: {
				ok: true,
				hubPublicKey: this.keyPair?.publicKeyString,
				instanceName: this.config.instanceName ?? 'vole',
				port: this.config.port ?? 9700,
			},
		}
	}

	/**
	 * Check if a specific peer is allowed to use our brain.
	 */
	isPeerAllowedBrain(peerId: string): boolean {
		return this.getPeerTrust(peerId)?.allowBrain === true
	}

	/** Whether this peer may call our tools at all — explicit tool/full trust, or share.tools. */
	private peerToolsEnabled(peerId: string): boolean {
		const explicit = this.matchPeerConfig(peerId)
		if (explicit && (explicit.trust === 'full' || explicit.trust === 'tool')) return true
		return this.config.share?.tools === true
	}

	/** Whether this peer may call a specific tool (honors per-peer allow/deny lists). */
	isPeerAllowedTool(peerId: string, toolName: string): boolean {
		const explicit = this.matchPeerConfig(peerId)
		if (explicit?.denyTools?.some((p) => matchToolPattern(p, toolName))) return false
		if (explicit?.allowTools && explicit.allowTools.length > 0) {
			return explicit.allowTools.some((p) => matchToolPattern(p, toolName))
		}
		// Peers without an explicit entry (e.g. public joiners) honor the share-level allowlist.
		if (!isSharedTool(toolName, this.config.share?.toolAllow)) return false
		return this.peerToolsEnabled(peerId)
	}

	/**
	 * Match a connected peer to its config entry.
	 * Matches by port (handles localhost vs real IP) or by instance name.
	 */
	private matchPeerConfig(peerId: string): {
		url: string
		trust?: string
		allowTools?: string[]
		denyTools?: string[]
		allowBrain?: boolean
	} | null {
		if (!this.config.peers) return null
		const instance = this.discovery?.getInstances().find((i) => i.id === peerId)
		if (!instance) return null

		for (const peerConfig of this.config.peers) {
			try {
				const configUrl = new URL(peerConfig.url)
				const configPort = configUrl.port || (configUrl.protocol === 'https:' ? '443' : '80')

				// Match by port (handles localhost:9701 matching 192.168.x.x:9701)
				if (instance.endpoint.includes(`:${configPort}`)) {
					return peerConfig
				}

				// Also match by exact host
				if (instance.endpoint.includes(configUrl.host)) {
					return peerConfig
				}
			} catch {
				continue
			}
		}
		return null
	}

	/**
	 * Get trust level for a peer.
	 */
	getPeerTrust(
		peerId: string,
	): { trust: string; allowTools?: string[]; denyTools?: string[]; allowBrain?: boolean } | null {
		const peerConfig = this.matchPeerConfig(peerId)
		if (peerConfig) {
			return {
				trust: peerConfig.trust ?? 'full',
				allowTools: peerConfig.allowTools,
				denyTools: peerConfig.denyTools,
				allowBrain: peerConfig.allowBrain,
			}
		}
		// Self-joined guest: authenticated (a known discovery instance) but not in static
		// peers config. Grant the restricted publicJoin trust — never 'full'.
		const pj = this.config.publicJoin
		if (pj?.enabled && this.discovery?.getInstances().some((i) => i.id === peerId)) {
			return { trust: pj.trustLevel ?? 'tool', allowBrain: pj.allowBrain ?? false }
		}
		return null
	}

	/**
	 * Get the keypair (for CLI display).
	 */
	/** Our instance name (for message framing). */
	getInstanceName(): string {
		return this.config.instanceName ?? 'vole'
	}

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
		// Explicit override wins — required for TLS so the advertised host matches the cert.
		const override = this.config.hostname ?? process.env.VOLE_NET_HOSTNAME
		if (override?.trim()) return override.trim()
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
export type {
	RemoteTaskRequest,
	RemoteTaskResult,
	RemoteToolCallRequest,
	RemoteToolCallResult,
} from './remote-task.js'
export { VoleNetSync } from './sync.js'
export type {
	MemorySyncEntry,
	MemorySearchRequest,
	MemorySearchResult,
	SessionSyncEntry,
} from './sync.js'
export { VoleNetLeader } from './leader.js'
export type { LeaderState } from './leader.js'

/**
 * Merge the transport-verified caller identity into remote tool params.
 * Always overwrites any incoming `__caller` — a peer cannot impersonate another instance.
 * Tools that want attribution declare an optional `__caller` parameter; others ignore it.
 */
export function withVerifiedCaller(
	params: unknown,
	instanceId: string,
	name?: string,
): Record<string, unknown> {
	const base =
		typeof params === 'object' && params !== null && !Array.isArray(params)
			? { ...(params as Record<string, unknown>) }
			: {}
	base.__caller = { instanceId, name: name ?? instanceId.substring(0, 8) }
	return base
}

/**
 * The endpoint an instance advertises to peers. An explicit publicUrl wins outright —
 * set it when VoleNet sits behind a reverse proxy so peers are told the proxy URL
 * (e.g. "https://club.example.com/mesh") instead of a raw listen port that may be firewalled.
 */
export function buildAdvertisedEndpoint(opts: {
	publicUrl?: string
	tls?: boolean
	hostname: string
	port: number
}): string {
	const override = opts.publicUrl?.trim().replace(/\/+$/, '')
	if (override) return override
	const scheme = opts.tls ? 'https' : 'http'
	return `${scheme}://${opts.hostname}:${opts.port}`
}

type PeerEntry = { url: string; trust?: string } & Record<string, unknown>

/**
 * Add a peer URL to a config peers list, REPLACING any existing entry on the same hostname —
 * re-joining a hub at a new endpoint (a proxied /mesh path instead of a raw :9710 port) must
 * update the entry, not stack a dead duplicate beside it. The replaced entry's trust and
 * per-peer settings carry over. Returns the new list plus the URL it replaced, if any.
 */
export function upsertPeerUrl(
	peers: PeerEntry[],
	url: string,
): { peers: PeerEntry[]; replaced?: string } {
	const norm = (u: string) => u.trim().replace(/\/+$/, '')
	const hostOf = (u: string): string | null => {
		try {
			return new URL(norm(u)).hostname || null
		} catch {
			return null
		}
	}
	const target = norm(url)
	if (peers.some((p) => norm(p.url) === target)) return { peers }
	const targetHost = hostOf(target)
	const stale = targetHost ? peers.find((p) => hostOf(p.url) === targetHost) : undefined
	const kept = stale ? peers.filter((p) => p !== stale) : peers.slice()
	kept.push(stale ? { ...stale, url: target } : { url: target, trust: 'full' })
	return { peers: kept, replaced: stale ? norm(stale.url) : undefined }
}
