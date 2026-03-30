/**
 * VoleNet Leader Election — ensures only one instance runs heartbeat/schedules.
 *
 * Algorithm: lowest instance ID wins (deterministic, no voting).
 * Leader sends periodic heartbeat. If 3 heartbeats missed (30s), next-lowest takes over.
 */

import { createLogger } from '../core/logger.js'
import { createMessage, type VoleNetMessage } from './protocol.js'
import type { VoleNetTransport } from './transport.js'
import type { VoleNetDiscovery } from './discovery.js'
import type { KeyObject } from 'node:crypto'

const logger = createLogger('volenet-leader')

const LEADER_HEARTBEAT_INTERVAL_MS = 10_000 // leader pings every 10s
const MAX_MISSED_HEARTBEATS = 3

export interface LeaderState {
	leaderId: string | null
	leaderName: string | null
	isLeader: boolean
	lastHeartbeat: number
	missedHeartbeats: number
}

/**
 * Manages leader election for heartbeat/schedule ownership.
 */
export class VoleNetLeader {
	private transport: VoleNetTransport
	private discovery: VoleNetDiscovery
	private instanceId: string
	private instanceName: string
	private privateKey: KeyObject

	private leaderId: string | null = null
	private leaderName: string | null = null
	private lastLeaderHeartbeat = 0
	private missedHeartbeats = 0
	private heartbeatTimer: ReturnType<typeof setInterval> | undefined
	private monitorTimer: ReturnType<typeof setInterval> | undefined

	// Callback when this instance becomes/loses leader
	private onBecomeLeader?: () => void
	private onLoseLeader?: () => void

	constructor(
		transport: VoleNetTransport,
		discovery: VoleNetDiscovery,
		instanceId: string,
		instanceName: string,
		privateKey: KeyObject,
	) {
		this.transport = transport
		this.discovery = discovery
		this.instanceId = instanceId
		this.instanceName = instanceName
		this.privateKey = privateKey

		this.transport.onMessage((message) => {
			this.handleMessage(message)
		})
	}

	/**
	 * Start leader election.
	 */
	start(
		onBecomeLeader?: () => void,
		onLoseLeader?: () => void,
	): void {
		this.onBecomeLeader = onBecomeLeader
		this.onLoseLeader = onLoseLeader

		// Determine initial leader (lowest ID among self + known peers)
		this.electLeader()

		// Start monitoring
		this.monitorTimer = setInterval(() => this.monitor(), LEADER_HEARTBEAT_INTERVAL_MS)

		logger.info(`Leader election started — current leader: ${this.leaderName ?? 'self'} (${(this.leaderId ?? this.instanceId).substring(0, 8)})`)
	}

	/**
	 * Stop leader election.
	 */
	stop(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer)
			this.heartbeatTimer = undefined
		}
		if (this.monitorTimer) {
			clearInterval(this.monitorTimer)
			this.monitorTimer = undefined
		}
		this.leaderId = null
		this.leaderName = null
	}

	/**
	 * Get current leader state.
	 */
	getState(): LeaderState {
		return {
			leaderId: this.leaderId,
			leaderName: this.leaderName,
			isLeader: this.isLeader(),
			lastHeartbeat: this.lastLeaderHeartbeat,
			missedHeartbeats: this.missedHeartbeats,
		}
	}

	/**
	 * Check if this instance is the leader.
	 */
	isLeader(): boolean {
		return this.leaderId === this.instanceId
	}

	/**
	 * Elect leader — lowest instance ID among all known instances + self.
	 */
	private electLeader(): void {
		const allIds = [this.instanceId]
		for (const instance of this.discovery.getInstances()) {
			allIds.push(instance.id)
		}
		allIds.sort()

		const newLeaderId = allIds[0]
		const wasLeader = this.isLeader()

		if (newLeaderId !== this.leaderId) {
			this.leaderId = newLeaderId

			if (newLeaderId === this.instanceId) {
				this.leaderName = this.instanceName
				logger.info(`This instance is now the leader`)
				this.startLeaderHeartbeat()
				if (!wasLeader) this.onBecomeLeader?.()
			} else {
				const instance = this.discovery.getInstances().find((i) => i.id === newLeaderId)
				this.leaderName = instance?.name ?? newLeaderId.substring(0, 8)
				logger.info(`Leader is: ${this.leaderName} (${newLeaderId.substring(0, 8)})`)
				this.stopLeaderHeartbeat()
				if (wasLeader) this.onLoseLeader?.()
			}
		}
	}

	/**
	 * Start sending leader heartbeats.
	 */
	private startLeaderHeartbeat(): void {
		this.stopLeaderHeartbeat()
		this.heartbeatTimer = setInterval(() => {
			const message = createMessage(
				'leader:heartbeat',
				this.instanceId,
				'*',
				{ timestamp: Date.now() },
				this.privateKey,
			)
			this.transport.broadcast(message)
		}, LEADER_HEARTBEAT_INTERVAL_MS)
	}

	/**
	 * Stop sending leader heartbeats.
	 */
	private stopLeaderHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer)
			this.heartbeatTimer = undefined
		}
	}

	/**
	 * Monitor leader liveness.
	 */
	private monitor(): void {
		// Re-elect if peers changed
		this.electLeader()

		// If we're not the leader, check if leader is alive
		if (!this.isLeader() && this.leaderId) {
			const timeSinceHeartbeat = Date.now() - this.lastLeaderHeartbeat

			if (this.lastLeaderHeartbeat > 0 && timeSinceHeartbeat > LEADER_HEARTBEAT_INTERVAL_MS * 1.5) {
				this.missedHeartbeats++
				logger.warn(`Leader heartbeat missed (${this.missedHeartbeats}/${MAX_MISSED_HEARTBEATS}) — last seen ${Math.round(timeSinceHeartbeat / 1000)}s ago`)

				if (this.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
					logger.warn(`Leader ${this.leaderName} appears down — triggering re-election`)
					this.missedHeartbeats = 0
					this.lastLeaderHeartbeat = 0
					// Remove dead leader from consideration and re-elect
					this.electLeader()
				}
			}
		}
	}

	/**
	 * Handle incoming leader-related messages.
	 */
	private handleMessage(message: VoleNetMessage): void {
		switch (message.type) {
			case 'leader:heartbeat':
				if (message.from === this.leaderId) {
					this.lastLeaderHeartbeat = Date.now()
					this.missedHeartbeats = 0
				}
				break

			case 'leader:claim':
				// Another instance is claiming leadership
				// Accept if their ID is lower than ours
				if (message.from < this.instanceId) {
					logger.info(`Accepted leader claim from ${message.from.substring(0, 8)}`)
					if (this.isLeader()) {
						this.stopLeaderHeartbeat()
						this.onLoseLeader?.()
					}
					this.leaderId = message.from
					const instance = this.discovery.getInstances().find((i) => i.id === message.from)
					this.leaderName = instance?.name ?? message.from.substring(0, 8)
					this.lastLeaderHeartbeat = Date.now()
					this.missedHeartbeats = 0

					// Acknowledge
					const ack = createMessage(
						'leader:ack',
						this.instanceId,
						message.from,
						{ accepted: true },
						this.privateKey,
					)
					this.transport.sendToPeer(message.from, ack)
				}
				break

			case 'leader:ack':
				// Our claim was acknowledged
				break
		}
	}
}
