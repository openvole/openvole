import type { ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import * as crypto from 'node:crypto'
import type { TransportType } from '../paw/types.js'

import { createLogger } from './logger.js'

const logger = createLogger('ipc')

/** JSON-RPC 2.0 message */
export interface IpcMessage {
	jsonrpc: '2.0'
	id?: string
	method?: string
	params?: unknown
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

/** Pending request waiting for a response */
interface PendingRequest {
	resolve: (value: unknown) => void
	reject: (error: Error) => void
	timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 120_000

/** Transport abstraction that handles both Node IPC and stdio JSON-RPC */
export class IpcTransport {
	private pending = new Map<string, PendingRequest>()
	private handlers = new Map<string, (params: unknown) => Promise<unknown>>()
	private disposed = false

	constructor(
		private type: TransportType,
		private childProcess: ChildProcess,
		private timeoutMs = DEFAULT_TIMEOUT_MS,
	) {
		if (type === 'ipc') {
			this.setupIpcListeners()
		} else {
			this.setupStdioListeners()
		}
	}

	/** Register a handler for incoming requests from the Paw */
	onRequest(method: string, handler: (params: unknown) => Promise<unknown>): void {
		this.handlers.set(method, handler)
	}

	/** Send a request to the Paw and wait for a response */
	async request(method: string, params?: unknown): Promise<unknown> {
		if (this.disposed) {
			throw new Error('Transport has been disposed')
		}

		const id = crypto.randomUUID()
		const message: IpcMessage = { jsonrpc: '2.0', id, method, params }
		logger.trace(`Sending request: ${method} ${JSON.stringify(params ?? '', null, 2)}`)

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id)
				reject(new Error(`IPC request "${method}" timed out after ${this.timeoutMs}ms`))
			}, this.timeoutMs)

			this.pending.set(id, { resolve, reject, timer })
			this.send(message)
		})
	}

	/** Send a notification (no response expected) */
	notify(method: string, params?: unknown): void {
		if (this.disposed) return
		const message: IpcMessage = { jsonrpc: '2.0', method, params }
		this.send(message)
	}

	/** Clean up resources */
	dispose(): void {
		this.disposed = true
		for (const [, pending] of this.pending) {
			clearTimeout(pending.timer)
			pending.reject(new Error('Transport disposed'))
		}
		this.pending.clear()
		this.handlers.clear()
	}

	private send(message: IpcMessage): void {
		if (this.disposed) return
		if (this.type === 'ipc') {
			try {
				if (this.childProcess.connected) {
					this.childProcess.send?.(message)
				}
			} catch {
				// Channel already closed — ignore
			}
		} else {
			const json = JSON.stringify(message)
			const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`
			const stdin = this.childProcess.stdin as Writable | null
			if (stdin?.writable) {
				stdin.write(header + json)
			}
		}
	}

	private handleMessage(msg: IpcMessage): void {
		logger.trace(`Received message: ${msg.method ?? msg.id ?? 'unknown'} ${JSON.stringify(msg.params ?? msg.result ?? '', null, 2)}`)

		// Response to a pending request
		if (msg.id && this.pending.has(msg.id)) {
			const pending = this.pending.get(msg.id)!
			this.pending.delete(msg.id)
			clearTimeout(pending.timer)

			if (msg.error) {
				pending.reject(new Error(`${msg.error.message} (code: ${msg.error.code})`))
			} else {
				pending.resolve(msg.result)
			}
			return
		}

		// Incoming request from Paw
		if (msg.method && this.handlers.has(msg.method)) {
			const handler = this.handlers.get(msg.method)!
			handler(msg.params)
				.then((result) => {
					if (msg.id) {
						this.send({ jsonrpc: '2.0', id: msg.id, result })
					}
				})
				.catch((err: unknown) => {
					const errorMessage = err instanceof Error ? err.message : String(err)
					logger.error(`Handler error for "${msg.method}": ${errorMessage}`)
					if (msg.id) {
						this.send({
							jsonrpc: '2.0',
							id: msg.id,
							error: { code: -32603, message: errorMessage },
						})
					}
				})
		}
	}

	private setupIpcListeners(): void {
		this.childProcess.on('message', (msg: unknown) => {
			this.handleMessage(msg as IpcMessage)
		})
	}

	private setupStdioListeners(): void {
		const stdout = this.childProcess.stdout as Readable | null
		if (!stdout) {
			logger.error('No stdout stream available for stdio transport')
			return
		}

		let buffer = ''

		stdout.setEncoding('utf-8')
		stdout.on('data', (chunk: string) => {
			buffer += chunk

			// Parse Content-Length framed messages
			while (buffer.length > 0) {
				const headerEnd = buffer.indexOf('\r\n\r\n')
				if (headerEnd === -1) break

				const header = buffer.substring(0, headerEnd)
				const match = header.match(/Content-Length:\s*(\d+)/i)
				if (!match) {
					logger.error(`Invalid header in stdio transport: ${header}`)
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
					this.handleMessage(msg)
				} catch (err) {
					logger.error(`Failed to parse stdio JSON-RPC message: ${err}`)
				}
			}
		})
	}
}

/** Create a transport for a Paw subprocess */
export function createTransport(
	type: TransportType,
	childProcess: ChildProcess,
	timeoutMs?: number,
): IpcTransport {
	return new IpcTransport(type, childProcess, timeoutMs)
}
