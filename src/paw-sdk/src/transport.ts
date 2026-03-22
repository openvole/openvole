/** JSON-RPC 2.0 message */
interface IpcMessage {
	jsonrpc: '2.0'
	id?: string
	method?: string
	params?: unknown
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

type RequestHandler = (params: unknown) => Promise<unknown>

/** Create an IPC transport for Node.js Paw subprocesses */
export function createIpcTransport() {
	const handlers = new Map<string, RequestHandler>()

	// Increase max listeners — concurrent query/request calls each add a temporary listener
	process.setMaxListeners(Math.max(process.getMaxListeners(), 25))

	// Listen for incoming messages from the core
	process.on('message', async (msg: IpcMessage) => {
		if (!msg.method) return

		const handler = handlers.get(msg.method)
		if (handler) {
			try {
				const result = await handler(msg.params)
				if (msg.id) {
					process.send!({ jsonrpc: '2.0', id: msg.id, result })
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				if (msg.id) {
					process.send!({
						jsonrpc: '2.0',
						id: msg.id,
						error: { code: -32603, message },
					})
				}
			}
		}
	})

	return {
		/** Register a handler for a method called by the core */
		onRequest(method: string, handler: RequestHandler): void {
			handlers.set(method, handler)
		},

		/** Send a notification to the core (no response expected) */
		send(method: string, params?: unknown): void {
			process.send!({ jsonrpc: '2.0', method, params })
		},

		/** Send a request to the core and wait for a response */
		async request(method: string, params?: unknown): Promise<unknown> {
			const id = crypto.randomUUID()
			const message: IpcMessage = { jsonrpc: '2.0', id, method, params }

			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error(`Request "${method}" timed out`))
				}, 30_000)

				const listener = (msg: IpcMessage) => {
					if (msg.id === id) {
						clearTimeout(timeout)
						process.off('message', listener)
						if (msg.error) {
							reject(new Error(msg.error.message))
						} else {
							resolve(msg.result)
						}
					}
				}

				process.on('message', listener)
				process.send!(message)
			})
		},

		/** Subscribe to bus events from the core */
		subscribe(events: string[]): void {
			process.send!({ jsonrpc: '2.0', method: 'subscribe', params: { events } })
		},

		/** Query core state (tools, paws, skills, tasks) */
		async query(type: 'tools' | 'paws' | 'skills' | 'tasks'): Promise<unknown> {
			const id = crypto.randomUUID()
			const message: IpcMessage = { jsonrpc: '2.0', id, method: 'query', params: { type } }

			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error(`Query "${type}" timed out`))
				}, 10_000)

				const listener = (msg: IpcMessage) => {
					if (msg.id === id) {
						clearTimeout(timeout)
						process.off('message', listener)
						if (msg.error) {
							reject(new Error(msg.error.message))
						} else {
							resolve(msg.result)
						}
					}
				}

				process.on('message', listener)
				process.send!(message)
			})
		},

		/** Register a handler for forwarded bus events */
		onBusEvent(handler: (event: string, data: unknown) => void): void {
			handlers.set('bus_event', async (params) => {
				const { event, data } = params as { event: string; data: unknown }
				handler(event, data)
				return { ok: true }
			})
		},

		/** Create a task in the core's task queue (for channel Paws that receive inbound messages) */
		async createTask(input: string, metadata?: Record<string, unknown> & { sessionId?: string }): Promise<{ taskId: string }> {
			const { sessionId, ...rest } = metadata ?? {}
			const id = crypto.randomUUID()
			const message: IpcMessage = {
				jsonrpc: '2.0',
				id,
				method: 'create_task',
				params: { input, source: 'paw', sessionId, metadata: rest },
			}

			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error('createTask timed out'))
				}, 10_000)

				const listener = (msg: IpcMessage) => {
					if (msg.id === id) {
						clearTimeout(timeout)
						process.off('message', listener)
						if (msg.error) {
							reject(new Error(msg.error.message))
						} else {
							resolve(msg.result as { taskId: string })
						}
					}
				}

				process.on('message', listener)
				process.send!(message)
			})
		},
	}
}

/** Create a stdio transport for non-Node Paw processes (LSP-style framing) */
export function createStdioTransport() {
	const handlers = new Map<string, RequestHandler>()
	let buffer = ''

	process.stdin.setEncoding('utf-8')
	process.stdin.on('data', (chunk: string) => {
		buffer += chunk
		processBuffer()
	})

	async function processBuffer(): Promise<void> {
		while (buffer.length > 0) {
			const headerEnd = buffer.indexOf('\r\n\r\n')
			if (headerEnd === -1) break

			const header = buffer.substring(0, headerEnd)
			const match = header.match(/Content-Length:\s*(\d+)/i)
			if (!match) {
				buffer = buffer.substring(headerEnd + 4)
				continue
			}

			const contentLength = Number.parseInt(match[1], 10)
			const bodyStart = headerEnd + 4
			if (buffer.length < bodyStart + contentLength) break

			const body = buffer.substring(bodyStart, bodyStart + contentLength)
			buffer = buffer.substring(bodyStart + contentLength)

			try {
				const msg = JSON.parse(body) as IpcMessage
				await handleMessage(msg)
			} catch {
				// Skip malformed messages
			}
		}
	}

	async function handleMessage(msg: IpcMessage): Promise<void> {
		if (!msg.method) return

		const handler = handlers.get(msg.method)
		if (handler) {
			try {
				const result = await handler(msg.params)
				if (msg.id) {
					send({ jsonrpc: '2.0', id: msg.id, result })
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				if (msg.id) {
					send({
						jsonrpc: '2.0',
						id: msg.id,
						error: { code: -32603, message },
					})
				}
			}
		}
	}

	function send(message: IpcMessage): void {
		const json = JSON.stringify(message)
		const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`
		process.stdout.write(header + json)
	}

	return {
		onRequest(method: string, handler: RequestHandler): void {
			handlers.set(method, handler)
		},

		send(method: string, params?: unknown): void {
			send({ jsonrpc: '2.0', method, params })
		},
	}
}
