/**
 * Reverse-RPC client: lets an orchestrator agent call its ControlPlane parent over the
 * Node IPC channel it was spawned with. Sends `{creq:{id,method,params}}`, resolves on the
 * matching `{cres:{id,result|error}}`. Holds no engine references — create it ONCE per
 * process (it survives in-process engine restarts; only the tools are re-registered).
 */

// Longer than the control plane's own 15s child-RPC timeout, so when the parent's nested
// callAgent(target) times out, its descriptive error reaches us as a message instead of
// being masked by our own generic timeout.
const ORCHESTRATE_TIMEOUT_MS = 20_000

interface Pending {
	resolve: (value: unknown) => void
	reject: (err: Error) => void
	timeout: ReturnType<typeof setTimeout>
}

/** The slice of `process` the client needs (injectable for tests). */
export interface IpcChannel {
	send?: (msg: unknown) => void
	connected?: boolean
	on(event: 'message', listener: (msg: unknown) => void): unknown
	on(event: 'disconnect', listener: () => void): unknown
}

export interface ParentClient {
	call(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>
}

export function createParentClient(channel: IpcChannel = process): ParentClient {
	let nextId = 1
	const pending = new Map<number, Pending>()

	channel.on('message', (msg: unknown) => {
		const res = (msg as { cres?: { id: number; result?: unknown; error?: string } })?.cres
		if (!res || typeof res.id !== 'number') return
		const p = pending.get(res.id)
		if (!p) return
		pending.delete(res.id)
		clearTimeout(p.timeout)
		if (res.error) p.reject(new Error(res.error))
		else p.resolve(res.result)
	})

	// Parent gone (vole serve stopped): fail fast instead of letting calls hang to timeout.
	channel.on('disconnect', () => {
		for (const p of pending.values()) {
			clearTimeout(p.timeout)
			p.reject(new Error('Control plane disconnected'))
		}
		pending.clear()
	})

	return {
		call(method, params = {}, timeoutMs = ORCHESTRATE_TIMEOUT_MS): Promise<unknown> {
			if (!channel.send || !channel.connected) {
				return Promise.reject(new Error('Not running under vole serve (no control channel)'))
			}
			const id = nextId++
			return new Promise<unknown>((resolve, reject) => {
				const timeout = setTimeout(() => {
					pending.delete(id)
					reject(new Error(`Control-plane request timed out: ${method}`))
				}, timeoutMs)
				pending.set(id, { resolve, reject, timeout })
				channel.send?.({ creq: { id, method, params } })
			})
		},
	}
}
