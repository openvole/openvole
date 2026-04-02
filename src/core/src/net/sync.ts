/**
 * VoleNet Sync — memory and session synchronization across peers.
 *
 * Memory sync: write propagation + remote search + result merging.
 * Session sync: transcript replication for cross-device continuity.
 *
 * Conflict resolution: last-write-wins with instance attribution.
 * Consistency model: eventual (async propagation, no blocking).
 */

import type { KeyObject } from 'node:crypto'
import { createLogger } from '../core/logger.js'
import type { VoleNetDiscovery } from './discovery.js'
import { type VoleNetMessage, createMessage } from './protocol.js'
import type { VoleNetTransport } from './transport.js'

const logger = createLogger('volenet-sync')

/** Memory write event for propagation */
export interface MemorySyncEntry {
	file: string
	source: string
	content: string
	mode: 'overwrite' | 'append'
	timestamp: number
	instanceId: string
	version: number
}

/** Remote memory search request */
export interface MemorySearchRequest {
	query: string
	source?: string
	limit?: number
	requestId: string
}

/** Remote memory search result */
export interface MemorySearchResult {
	requestId: string
	instanceId: string
	instanceName: string
	results: Array<{
		file: string
		source: string
		score: number
		snippet: string
	}>
}

/** Session sync entry */
export interface SessionSyncEntry {
	sessionId: string
	role: string
	content: string
	timestamp: number
	instanceId: string
}

export interface SyncConfig {
	memory: boolean
	session: boolean
}

/**
 * Manages memory and session synchronization across VoleNet peers.
 */
export class VoleNetSync {
	private transport: VoleNetTransport
	private discovery: VoleNetDiscovery
	private instanceId: string
	private instanceName: string
	private privateKey: KeyObject
	private config: SyncConfig

	// Callbacks for local memory/session operations
	private onMemoryWrite?: (entry: MemorySyncEntry) => Promise<void>
	private onMemorySearch?: (request: MemorySearchRequest) => Promise<MemorySearchResult['results']>
	private onSessionWrite?: (entry: SessionSyncEntry) => Promise<void>

	// Pending remote search requests
	private pendingSearches = new Map<
		string,
		{
			results: MemorySearchResult[]
			timer: ReturnType<typeof setTimeout>
			resolve: (results: MemorySearchResult[]) => void
			expectedPeers: number
		}
	>()

	// Dedup: track recently synced writes to avoid echo loops
	private recentSyncs = new Set<string>()

	constructor(
		transport: VoleNetTransport,
		discovery: VoleNetDiscovery,
		instanceId: string,
		instanceName: string,
		privateKey: KeyObject,
		config: SyncConfig,
	) {
		this.transport = transport
		this.discovery = discovery
		this.instanceId = instanceId
		this.instanceName = instanceName
		this.privateKey = privateKey
		this.config = config

		// Register message handlers
		this.transport.onMessage((message) => {
			this.handleMessage(message)
		})
	}

	/**
	 * Register callback for when a remote memory write arrives.
	 * The callback should apply the write to the local memory store.
	 */
	setMemoryWriteHandler(handler: (entry: MemorySyncEntry) => Promise<void>): void {
		this.onMemoryWrite = handler
	}

	/**
	 * Register callback for handling remote memory search requests.
	 * The callback should search the local store and return results.
	 */
	setMemorySearchHandler(
		handler: (request: MemorySearchRequest) => Promise<MemorySearchResult['results']>,
	): void {
		this.onMemorySearch = handler
	}

	/**
	 * Register callback for when a remote session write arrives.
	 */
	setSessionWriteHandler(handler: (entry: SessionSyncEntry) => Promise<void>): void {
		this.onSessionWrite = handler
	}

	/**
	 * Propagate a local memory write to all peers.
	 * Called by paw-memory after a successful local write.
	 */
	async propagateMemoryWrite(entry: MemorySyncEntry): Promise<void> {
		if (!this.config.memory) return

		// Dedup — don't re-propagate writes we received from peers
		const syncKey = `${entry.file}:${entry.timestamp}:${entry.instanceId}`
		if (this.recentSyncs.has(syncKey)) return
		this.recentSyncs.add(syncKey)
		// Clean old entries (keep last 5 minutes)
		setTimeout(() => this.recentSyncs.delete(syncKey), 300_000)

		const message = createMessage('memory:sync', this.instanceId, '*', entry, this.privateKey)

		const sent = await this.transport.broadcast(message)
		if (sent > 0) {
			logger.debug(`Memory write propagated to ${sent} peer(s): ${entry.file}`)
		}
	}

	/**
	 * Search memory across all peers + local.
	 * Returns merged results from all sources, re-ranked by score.
	 */
	async searchRemoteMemory(
		query: string,
		options?: { source?: string; limit?: number; timeoutMs?: number },
	): Promise<MemorySearchResult[]> {
		if (!this.config.memory) return []

		const instances = this.discovery.getInstances()
		if (instances.length === 0) return []

		const requestId = `search-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
		const timeoutMs = options?.timeoutMs ?? 5000
		const limit = options?.limit ?? 10

		const message = createMessage(
			'memory:search',
			this.instanceId,
			'*',
			{
				query,
				source: options?.source,
				limit,
				requestId,
			} satisfies MemorySearchRequest,
			this.privateKey,
		)

		// Set up result collector
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				const pending = this.pendingSearches.get(requestId)
				this.pendingSearches.delete(requestId)
				resolve(pending?.results ?? [])
			}, timeoutMs)

			this.pendingSearches.set(requestId, {
				results: [],
				timer,
				resolve,
				expectedPeers: instances.length,
			})

			this.transport.broadcast(message)
		})
	}

	/**
	 * Propagate a session message to peers.
	 */
	async propagateSessionWrite(entry: SessionSyncEntry): Promise<void> {
		if (!this.config.session) return

		const syncKey = `${entry.sessionId}:${entry.timestamp}:${entry.instanceId}`
		if (this.recentSyncs.has(syncKey)) return
		this.recentSyncs.add(syncKey)
		setTimeout(() => this.recentSyncs.delete(syncKey), 300_000)

		const message = createMessage('session:sync', this.instanceId, '*', entry, this.privateKey)

		await this.transport.broadcast(message)
	}

	/**
	 * Handle incoming sync messages.
	 */
	private handleMessage(message: VoleNetMessage): void {
		switch (message.type) {
			case 'memory:sync':
				this.handleMemorySync(message)
				break
			case 'memory:search':
				this.handleMemorySearchRequest(message)
				break
			case 'memory:results':
				this.handleMemorySearchResults(message)
				break
			case 'session:sync':
				this.handleSessionSync(message)
				break
		}
	}

	/**
	 * Handle incoming memory write from a peer.
	 */
	private async handleMemorySync(message: VoleNetMessage): Promise<void> {
		const entry = message.payload as MemorySyncEntry
		if (!entry?.file || !entry?.content) return

		// Dedup
		const syncKey = `${entry.file}:${entry.timestamp}:${entry.instanceId}`
		if (this.recentSyncs.has(syncKey)) return
		this.recentSyncs.add(syncKey)
		setTimeout(() => this.recentSyncs.delete(syncKey), 300_000)

		logger.debug(`Memory sync from ${message.from.substring(0, 8)}: ${entry.file} (${entry.mode})`)

		if (this.onMemoryWrite) {
			try {
				await this.onMemoryWrite(entry)
			} catch (err) {
				logger.warn(
					`Failed to apply memory sync: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}
	}

	/**
	 * Handle remote memory search request — search local store and reply.
	 */
	private async handleMemorySearchRequest(message: VoleNetMessage): Promise<void> {
		const request = message.payload as MemorySearchRequest
		if (!request?.query || !request?.requestId) return

		if (!this.onMemorySearch) return

		try {
			const results = await this.onMemorySearch(request)
			const response = createMessage(
				'memory:results',
				this.instanceId,
				message.from,
				{
					requestId: request.requestId,
					instanceId: this.instanceId,
					instanceName: this.instanceName,
					results,
				} satisfies MemorySearchResult,
				this.privateKey,
			)
			await this.transport.sendToPeer(message.from, response)
		} catch (err) {
			logger.warn(
				`Failed to handle memory search: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}

	/**
	 * Handle memory search results from a peer.
	 */
	private handleMemorySearchResults(message: VoleNetMessage): void {
		const result = message.payload as MemorySearchResult
		if (!result?.requestId) return

		const pending = this.pendingSearches.get(result.requestId)
		if (!pending) return

		pending.results.push(result)

		// If all peers responded, resolve early
		if (pending.results.length >= pending.expectedPeers) {
			clearTimeout(pending.timer)
			this.pendingSearches.delete(result.requestId)
			pending.resolve(pending.results)
		}
	}

	/**
	 * Handle session sync from a peer.
	 */
	private async handleSessionSync(message: VoleNetMessage): Promise<void> {
		const entry = message.payload as SessionSyncEntry
		if (!entry?.sessionId || !entry?.content) return

		const syncKey = `${entry.sessionId}:${entry.timestamp}:${entry.instanceId}`
		if (this.recentSyncs.has(syncKey)) return
		this.recentSyncs.add(syncKey)
		setTimeout(() => this.recentSyncs.delete(syncKey), 300_000)

		logger.debug(`Session sync from ${message.from.substring(0, 8)}: ${entry.sessionId}`)

		if (this.onSessionWrite) {
			try {
				await this.onSessionWrite(entry)
			} catch (err) {
				logger.warn(
					`Failed to apply session sync: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}
	}

	/**
	 * Cleanup.
	 */
	dispose(): void {
		for (const [, pending] of this.pendingSearches) {
			clearTimeout(pending.timer)
			pending.resolve([])
		}
		this.pendingSearches.clear()
		this.recentSyncs.clear()
	}
}
