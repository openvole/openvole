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
	'task:completed': { taskId: string; result?: string }
	'task:failed': { taskId: string; error?: unknown; result?: string }
	'task:cancelled': { taskId: string }
	'rate:limited': { bucket: string; source?: string }
}

export type MessageBus = Emitter<BusEvents>

/** Create a new message bus instance */
export function createMessageBus(): MessageBus {
	return mitt<BusEvents>()
}
