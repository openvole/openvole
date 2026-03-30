/**
 * VoleNet Remote Task — delegate tasks to remote peers, execute remote tools.
 * Transparent to the Brain — remote tools appear in the tool registry like local ones.
 */

import * as crypto from 'node:crypto'
import { createLogger } from '../core/logger.js'
import { createMessage, type VoleNetMessage } from './protocol.js'
import type { VoleNetTransport } from './transport.js'
import type { VoleNetDiscovery } from './discovery.js'
import type { KeyObject } from 'node:crypto'

const logger = createLogger('volenet-remote')

export interface RemoteTaskRequest {
	taskId: string
	input: string
	maxIterations?: number
	agentProfile?: string
	context?: string
}

export interface RemoteTaskResult {
	taskId: string
	status: 'queued' | 'running' | 'completed' | 'failed' | 'timeout'
	result?: string
	error?: string
	durationMs?: number
}

export interface RemoteToolCallRequest {
	callId: string
	toolName: string
	params: unknown
}

export interface RemoteToolCallResult {
	callId: string
	success: boolean
	output?: unknown
	error?: string
}

/**
 * Manages remote task delegation and tool execution across VoleNet peers.
 */
export class RemoteTaskManager {
	private transport: VoleNetTransport
	private discovery: VoleNetDiscovery
	private instanceId: string
	private privateKey: KeyObject
	private pendingTasks = new Map<string, {
		resolve: (result: RemoteTaskResult) => void
		reject: (error: Error) => void
		timer: ReturnType<typeof setTimeout>
	}>()
	private pendingToolCalls = new Map<string, {
		resolve: (result: RemoteToolCallResult) => void
		reject: (error: Error) => void
		timer: ReturnType<typeof setTimeout>
	}>()
	private routing: Record<string, string>

	constructor(
		transport: VoleNetTransport,
		discovery: VoleNetDiscovery,
		instanceId: string,
		privateKey: KeyObject,
		routing?: Record<string, string>,
	) {
		this.transport = transport
		this.discovery = discovery
		this.instanceId = instanceId
		this.privateKey = privateKey
		this.routing = routing ?? {}

		// Register message handlers
		this.transport.onMessage((message) => {
			this.handleMessage(message)
		})
	}

	/**
	 * Delegate a task to a remote peer.
	 * Returns when the remote task completes or times out.
	 */
	async delegateTask(
		targetInstanceId: string,
		request: RemoteTaskRequest,
		timeoutMs = 300_000,
	): Promise<RemoteTaskResult> {
		const taskId = request.taskId || crypto.randomUUID()

		const message = createMessage(
			'task:delegate',
			this.instanceId,
			targetInstanceId,
			{ ...request, taskId },
			this.privateKey,
		)

		const sent = await this.transport.sendToPeer(targetInstanceId, message)
		if (!sent) {
			return { taskId, status: 'failed', error: 'Failed to reach peer' }
		}

		logger.info(`Delegated task ${taskId.substring(0, 8)} to ${targetInstanceId.substring(0, 8)}: "${request.input.substring(0, 80)}"`)

		// Wait for result
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingTasks.delete(taskId)
				resolve({ taskId, status: 'timeout', error: `Task timed out after ${timeoutMs}ms` })
			}, timeoutMs)

			this.pendingTasks.set(taskId, { resolve, reject, timer })
		})
	}

	/**
	 * Execute a tool on a remote peer.
	 * Used by the tool registry when a tool is remote.
	 */
	async executeRemoteTool(
		targetInstanceId: string,
		toolName: string,
		params: unknown,
		timeoutMs = 60_000,
	): Promise<RemoteToolCallResult> {
		const callId = crypto.randomUUID()

		const message = createMessage(
			'tool:call',
			this.instanceId,
			targetInstanceId,
			{ callId, toolName, params } satisfies RemoteToolCallRequest,
			this.privateKey,
		)

		const sent = await this.transport.sendToPeer(targetInstanceId, message)
		if (!sent) {
			return { callId, success: false, error: 'Failed to reach peer' }
		}

		logger.info(`Remote tool call ${toolName} → ${targetInstanceId.substring(0, 8)}`)

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pendingToolCalls.delete(callId)
				resolve({ callId, success: false, error: `Remote tool call timed out after ${timeoutMs}ms` })
			}, timeoutMs)

			this.pendingToolCalls.set(callId, { resolve, reject: () => {}, timer })
		})
	}

	/**
	 * Resolve which peer should handle a tool call.
	 * Checks routing config first, then falls back to discovery.
	 */
	resolveToolTarget(toolName: string): string | null {
		// Check explicit routing rules (pattern matching)
		for (const [pattern, targetName] of Object.entries(this.routing)) {
			if (matchPattern(pattern, toolName)) {
				// Find instance by name
				const instances = this.discovery.getInstances()
				const target = instances.find((i) => i.name === targetName)
				if (target) return target.id
			}
		}

		// Check if any peer has this tool
		const owner = this.discovery.findToolOwner(toolName)
		return owner?.instanceId ?? null
	}

	/**
	 * Handle incoming messages related to tasks and tools.
	 */
	private handleMessage(message: VoleNetMessage): void {
		switch (message.type) {
			case 'task:result':
				this.handleTaskResult(message)
				break
			case 'task:status':
				this.handleTaskStatus(message)
				break
			case 'tool:result':
				this.handleToolResult(message)
				break
		}
	}

	private handleTaskResult(message: VoleNetMessage): void {
		const result = message.payload as RemoteTaskResult
		if (!result?.taskId) return

		const pending = this.pendingTasks.get(result.taskId)
		if (pending) {
			clearTimeout(pending.timer)
			this.pendingTasks.delete(result.taskId)
			pending.resolve(result)
			logger.info(`Remote task ${result.taskId.substring(0, 8)} completed: ${result.status}`)
		}
	}

	private handleTaskStatus(message: VoleNetMessage): void {
		const status = message.payload as { taskId: string; status: string }
		if (!status?.taskId) return
		logger.info(`Remote task ${status.taskId.substring(0, 8)} status: ${status.status}`)
	}

	private handleToolResult(message: VoleNetMessage): void {
		const result = message.payload as RemoteToolCallResult
		if (!result?.callId) return

		const pending = this.pendingToolCalls.get(result.callId)
		if (pending) {
			clearTimeout(pending.timer)
			this.pendingToolCalls.delete(result.callId)
			pending.resolve(result)
		}
	}

	/**
	 * Cleanup pending requests.
	 */
	dispose(): void {
		for (const [, pending] of this.pendingTasks) {
			clearTimeout(pending.timer)
			pending.resolve({ taskId: '', status: 'failed', error: 'VoleNet shutting down' })
		}
		this.pendingTasks.clear()

		for (const [, pending] of this.pendingToolCalls) {
			clearTimeout(pending.timer)
			pending.resolve({ callId: '', success: false, error: 'VoleNet shutting down' })
		}
		this.pendingToolCalls.clear()
	}
}

/**
 * Match a glob-like pattern against a tool name.
 * Supports: "image_*" matches "image_resize", "image_crop", etc.
 */
function matchPattern(pattern: string, name: string): boolean {
	if (pattern === name) return true
	if (pattern.endsWith('*')) {
		return name.startsWith(pattern.slice(0, -1))
	}
	return false
}
