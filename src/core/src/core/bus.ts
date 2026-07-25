import mitt, { type Emitter } from 'mitt'

/** Events emitted on the message bus */
export type BusEvents = {
	'tool:registered': { toolName: string; pawName: string }
	'tool:unregistered': { toolName: string; pawName: string }
	'paw:registered': { pawName: string }
	'paw:unregistered': { pawName: string }
	'paw:crashed': { pawName: string; error?: unknown }
	'task:queued': { taskId: string }
	'task:started': { taskId: string }
	'task:completed': { taskId: string; result?: string; sessionId?: string }
	'task:failed': { taskId: string; error?: unknown; result?: string; sessionId?: string }
	'task:cancelled': { taskId: string }
	'agent:completed': {
		taskId: string
		parentTaskId: string
		status: string
		result?: string
		error?: string
	}
	'volenet:tool:executed': {
		toolName: string
		fromInstance: string
		success: boolean
		durationMs: number
		error?: string
	}
	'volenet:chat': {
		from: string
		fromName: string
		text: string
		messageId: string
		timestamp: number
		/** True when the message arrived through a relay hub as a sealed envelope. */
		relayed?: boolean
	}
	'volenet:relay:error': {
		/** The relay hub that reported the failure. */
		via: string
		to?: string
		reason?: string
	}
	/** A relay member asked to connect — awaiting this agent's approval. */
	'volenet:relay:request': { from: string; fromName: string; note?: string }
	/** A relay member accepted this agent's connect-request. */
	'volenet:relay:accepted': { from: string; fromName: string }
	/** A relay member denied this agent's connect-request. */
	'volenet:relay:denied': { from: string; fromName: string }
	/** An unknown node asked to pair (vole net pair) — awaiting this operator's accept. */
	'volenet:pair:request': { from: string; fromName: string; note?: string }
	/** VoleDrop: a peer offered a file (auto=true when acceptFrom auto-accepted it). */
	'volenet:file:offer': {
		transferId: string
		from: string
		fromName: string
		name: string
		size: number
		note?: string
		auto: boolean
	}
	/** VoleDrop: transfer progress (throttled to ~2/sec per transfer). */
	'volenet:file:progress': {
		transferId: string
		dir: 'send' | 'recv'
		bytes: number
		totalBytes: number
		pct: number
	}
	/** VoleDrop: a file landed in the inbox (sha256-verified). */
	'volenet:file:received': {
		transferId: string
		from: string
		fromName: string
		name: string
		path: string
		size: number
		sha256: string
	}
	/** VoleDrop: the peer verified and stored a file this agent sent. */
	'volenet:file:sent': {
		transferId: string
		to: string
		toName: string
		name: string
		size: number
	}
	'volenet:file:failed': { transferId: string; dir: 'send' | 'recv'; code: string; detail?: string }
	'volenet:file:rejected': { transferId: string; by: string; reason: string }
	'rate:limited': { bucket: string; source?: string }
	'engine:restart': Record<string, never>
}

export type MessageBus = Emitter<BusEvents>

/** Create a new message bus instance */
export function createMessageBus(): MessageBus {
	return mitt<BusEvents>()
}
