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
	'rate:limited': { bucket: string; source?: string }
	'engine:restart': Record<string, never>
}

export type MessageBus = Emitter<BusEvents>

/** Create a new message bus instance */
export function createMessageBus(): MessageBus {
	return mitt<BusEvents>()
}
