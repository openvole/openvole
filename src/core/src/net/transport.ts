/**
 * VoleNet Transport — HTTP server + WebSocket for peer communication.
 *
 * Two modes:
 * - HTTP POST: for initial auth and one-shot messages (fallback)
 * - WebSocket: for persistent bidirectional messaging (preferred)
 *
 * WebSocket enables NAT traversal — the peer behind NAT connects out,
 * and the other side pushes through the open connection.
 * Auto-reconnect with exponential backoff on disconnect.
 */

import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import { WebSocket, WebSocketServer } from 'ws'
import { createLogger } from '../core/logger.js'
import { type VoleNetMessage, deserialize, serialize } from './protocol.js'

const logger = createLogger('volenet-transport')

const WS_RECONNECT_INTERVAL_MS = 5_000
const WS_RECONNECT_MAX_RETRIES = 10
const MAX_MESSAGES_PER_MINUTE = 1200 // per source (IP / WS connection); generous — normal mesh traffic is well below
const MAX_MESSAGE_BYTES = 1_000_000 // cap inbound HTTP message bodies (1 MB)

export interface TransportConfig {
	port: number
	tls?: {
		cert: string
		key: string
	}
	/** Max inbound messages per minute per source (IP / WS connection). Default 1200. */
	maxMessagesPerMinute?: number
}

export type MessageHandler = (message: VoleNetMessage, peerId: string) => void
export type JoinHandler = (body: unknown, ip: string) => Promise<{ status: number; json: unknown }>

interface PeerConnection {
	peerId: string
	endpoint: string
	connected: boolean
	lastSeen: number
	ws: WebSocket | null
	reconnectTimer: ReturnType<typeof setTimeout> | null
	reconnectAttempts: number
	connecting: boolean
}

/**
 * VoleNet Transport layer.
 * HTTP server for initial connections + WebSocket for persistent messaging.
 */
export class VoleNetTransport {
	private server: http.Server | https.Server | null = null
	private wss: WebSocketServer | null = null
	private peers = new Map<string, PeerConnection>()
	private messageHandlers: MessageHandler[] = []
	private joinHandler: JoinHandler | null = null
	private msgWindow = new Map<string, number[]>()
	private wsConnSeq = 0
	private config: TransportConfig
	private started = false

	constructor(config: TransportConfig) {
		this.config = config
	}

	/** Register a handler for public self-join requests (HTTP POST /volenet/join). */
	setJoinHandler(handler: JoinHandler): void {
		this.joinHandler = handler
	}

	/** Sliding-window rate limit per source (IP or WS connection). Returns false when over. */
	private rateAllow(key: string): boolean {
		const max = this.config.maxMessagesPerMinute ?? MAX_MESSAGES_PER_MINUTE
		const now = Date.now()
		const win = (this.msgWindow.get(key) ?? []).filter((t) => now - t < 60_000)
		if (win.length >= max) {
			this.msgWindow.set(key, win)
			return false
		}
		win.push(now)
		this.msgWindow.set(key, win)
		return true
	}

	/**
	 * Start the transport server (HTTP + WebSocket).
	 */
	async start(): Promise<void> {
		if (this.started) return

		const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
			if (req.url === '/health' && req.method === 'GET') {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ status: 'ok', protocol: 'volenet', version: 1 }))
				return
			}

			if (req.url === '/volenet/message' && req.method === 'POST') {
				const ip = req.socket.remoteAddress ?? 'unknown'
				if (!this.rateAllow(`ip:${ip}`)) {
					res.writeHead(429, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ error: 'rate limited' }))
					return
				}
				let body = ''
				req.on('data', (chunk: Buffer) => {
					body += chunk
					if (body.length > MAX_MESSAGE_BYTES) req.destroy()
				})
				req.on('end', () => {
					const message = deserialize(body)
					if (!message) {
						res.writeHead(400, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify({ error: 'Invalid message' }))
						return
					}
					for (const handler of this.messageHandlers) {
						handler(message, message.from)
					}
					res.writeHead(200, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ ok: true }))
				})
				return
			}

			if (req.url === '/volenet/info' && req.method === 'GET') {
				const peerList = this.getPeers()
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(
					JSON.stringify({
						ok: true,
						protocol: 'volenet',
						version: 1,
						peers: peerList.map((p) => ({
							id: p.peerId.substring(0, 8),
							endpoint: p.endpoint,
							connected: p.connected,
							transport: p.transport,
							lastSeen: p.lastSeen,
						})),
						peerCount: peerList.length,
						websocketConnections: peerList.filter((p) => p.transport === 'websocket').length,
					}),
				)
				return
			}

			if (req.url === '/volenet/join' && req.method === 'POST') {
				let body = ''
				req.on('data', (chunk: Buffer) => {
					body += chunk
					if (body.length > 8192) req.destroy()
				})
				req.on('end', () => {
					if (!this.joinHandler) {
						res.writeHead(404)
						res.end()
						return
					}
					let parsed: unknown
					try {
						parsed = JSON.parse(body)
					} catch {
						res.writeHead(400, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify({ error: 'invalid json' }))
						return
					}
					const ip = req.socket.remoteAddress ?? 'unknown'
					this.joinHandler(parsed, ip)
						.then(({ status, json }) => {
							res.writeHead(status, { 'Content-Type': 'application/json' })
							res.end(JSON.stringify(json))
						})
						.catch((e) => {
							res.writeHead(500, { 'Content-Type': 'application/json' })
							res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'join failed' }))
						})
				})
				return
			}

			res.writeHead(404)
			res.end()
		}

		if (this.config.tls) {
			this.server = https.createServer(
				{
					cert: fs.readFileSync(this.config.tls.cert),
					key: fs.readFileSync(this.config.tls.key),
				},
				requestHandler,
			)
		} else {
			this.server = http.createServer(requestHandler)
		}

		// Attach WebSocket server
		this.wss = new WebSocketServer({ server: this.server })

		this.wss.on('error', (err) => {
			logger.warn(`VoleNet WebSocket server error: ${err.message}`)
		})

		this.wss.on('connection', (ws) => {
			const connKey = `ws:${++this.wsConnSeq}`
			ws.on('message', (data) => {
				if (!this.rateAllow(connKey)) return
				const message = deserialize(data.toString())
				if (!message) return

				// Associate WS with peer on first message
				const peer = this.peers.get(message.from)
				if (peer && !peer.ws) {
					peer.ws = ws
					peer.connected = true
					logger.info(`WebSocket associated with peer ${message.from.substring(0, 8)}`)
				}

				for (const handler of this.messageHandlers) {
					handler(message, message.from)
				}
			})

			ws.on('close', () => {
				this.msgWindow.delete(connKey)
				for (const [peerId, peer] of this.peers) {
					if (peer.ws === ws) {
						peer.ws = null
						peer.connected = false
						logger.info(`WebSocket disconnected: ${peerId.substring(0, 8)}`)
						this.scheduleReconnect(peerId)
						break
					}
				}
			})

			ws.on('error', (err) => {
				logger.warn(`WebSocket error: ${err.message}`)
			})
		})

		await this.listen()

		// Bound successfully — downgrade the error handler so a transient runtime
		// socket error is logged instead of crashing the process (unhandled 'error').
		this.server!.on('error', (err) => {
			logger.warn(`VoleNet server error: ${(err as Error).message}`)
		})

		this.started = true
	}

	/** Bind the listening port, retrying briefly on EADDRINUSE (covers restart races). */
	private async listen(): Promise<void> {
		const maxAttempts = 5
		const retryDelayMs = 300
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				await new Promise<void>((resolve, reject) => {
					const server = this.server!
					const onError = (err: Error) => {
						server.removeListener('listening', onListening)
						reject(err)
					}
					const onListening = () => {
						server.removeListener('error', onError)
						const scheme = this.config.tls ? 'wss' : 'ws'
						logger.info(
							`VoleNet server listening on ${scheme}://0.0.0.0:${this.config.port} (HTTP + WebSocket)`,
						)
						resolve()
					}
					server.once('error', onError)
					server.once('listening', onListening)
					server.listen(this.config.port)
				})
				return
			} catch (err) {
				const e = err as NodeJS.ErrnoException
				if (e.code === 'EADDRINUSE' && attempt < maxAttempts) {
					logger.warn(
						`VoleNet port ${this.config.port} in use — retrying (${attempt}/${maxAttempts - 1}) in ${retryDelayMs}ms`,
					)
					await new Promise((r) => setTimeout(r, retryDelayMs))
					continue
				}
				throw new Error(
					e.code === 'EADDRINUSE'
						? `VoleNet could not bind port ${this.config.port}: still in use after ${maxAttempts} attempts — another instance may be running on this port.`
						: `VoleNet failed to start on port ${this.config.port}: ${e.message}`,
				)
			}
		}
	}

	/**
	 * Stop the transport.
	 */
	async stop(): Promise<void> {
		if (!this.started) return
		this.started = false

		for (const [, peer] of this.peers) {
			if (peer.ws) peer.ws.close()
			if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer)
		}
		this.peers.clear()

		// Close WS clients, then force-drop any lingering keep-alive / upgraded sockets
		// so the listening port is released promptly. Otherwise server.close() waits on
		// open connections and a restart races the old listener (EADDRINUSE).
		if (this.wss) {
			await new Promise<void>((resolve) => this.wss!.close(() => resolve()))
			this.wss = null
		}

		if (this.server) {
			this.server.closeAllConnections?.()
			await new Promise<void>((resolve) => this.server!.close(() => resolve()))
			this.server = null
		}

		logger.info('VoleNet server stopped')
	}

	onMessage(handler: MessageHandler): void {
		this.messageHandlers.push(handler)
	}

	/**
	 * Send a message to a peer.
	 * Prefers WebSocket (instant, bidirectional), falls back to HTTP POST.
	 */
	async sendToPeer(peerId: string, message: VoleNetMessage): Promise<boolean> {
		const peer = this.peers.get(peerId)
		if (!peer) {
			logger.warn(`Peer not found: ${peerId.substring(0, 8)}`)
			return false
		}

		// Try WebSocket first
		if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
			try {
				peer.ws.send(serialize(message))
				peer.lastSeen = Date.now()
				return true
			} catch {
				// Fall through to HTTP
			}
		}

		// Fall back to HTTP POST
		try {
			const response = await fetch(`${peer.endpoint}/volenet/message`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: serialize(message),
				signal: AbortSignal.timeout(10000),
			})
			peer.lastSeen = Date.now()
			return response.ok
		} catch (err) {
			logger.warn(
				`Send failed for ${peerId.substring(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
			)
			peer.connected = false
			return false
		}
	}

	async broadcast(message: VoleNetMessage): Promise<number> {
		let sent = 0
		for (const [peerId] of this.peers) {
			if (await this.sendToPeer(peerId, message)) sent++
		}
		return sent
	}

	/**
	 * Register a peer and initiate WebSocket connection.
	 */
	addPeer(peerId: string, endpoint: string): void {
		const existing = this.peers.get(peerId)
		if (existing) {
			// Peer re-announced (e.g. after a restart). Refresh endpoint, reset backoff, and
			// re-open the WebSocket if it has dropped — this is what heals the send path so a
			// reconnect/restart doesn't leave the peer un-sendable.
			if (endpoint) existing.endpoint = endpoint
			existing.reconnectAttempts = 0
			if (!existing.connecting && existing.ws?.readyState !== WebSocket.OPEN) {
				this.connectWebSocket(peerId)
			}
			return
		}

		this.peers.set(peerId, {
			peerId,
			endpoint,
			connected: false,
			lastSeen: Date.now(),
			ws: null,
			reconnectTimer: null,
			reconnectAttempts: 0,
			connecting: false,
		})

		this.connectWebSocket(peerId)
		logger.info(`Peer added: ${peerId.substring(0, 8)} (${endpoint})`)
	}

	removePeer(peerId: string): void {
		const peer = this.peers.get(peerId)
		if (peer) {
			if (peer.ws) peer.ws.close()
			if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer)
		}
		this.peers.delete(peerId)
		logger.info(`Peer removed: ${peerId.substring(0, 8)}`)
	}

	getPeers(): Array<{
		peerId: string
		endpoint: string
		connected: boolean
		lastSeen: number
		transport: 'websocket' | 'http' | 'disconnected'
	}> {
		return Array.from(this.peers.values()).map((p) => ({
			peerId: p.peerId,
			endpoint: p.endpoint,
			connected: p.connected,
			lastSeen: p.lastSeen,
			transport:
				p.ws?.readyState === WebSocket.OPEN
					? ('websocket' as const)
					: p.connected
						? ('http' as const)
						: ('disconnected' as const),
		}))
	}

	isPeerConnected(peerId: string): boolean {
		return this.peers.get(peerId)?.connected ?? false
	}

	async pingPeer(endpoint: string): Promise<boolean> {
		try {
			const response = await fetch(`${endpoint}/health`, {
				signal: AbortSignal.timeout(5000),
			})
			return response.ok
		} catch {
			return false
		}
	}

	/**
	 * Connect to a peer via WebSocket.
	 */
	private connectWebSocket(peerId: string): void {
		const peer = this.peers.get(peerId)
		if (!peer) return
		// Don't open a second socket while one is connecting or already open.
		if (peer.connecting || peer.ws?.readyState === WebSocket.OPEN) return
		if (!peer.endpoint) return

		const scheme = peer.endpoint.startsWith('https') ? 'wss' : 'ws'
		const wsUrl = peer.endpoint.replace(/^https?/, scheme)

		peer.connecting = true
		try {
			const ws = new WebSocket(wsUrl)

			ws.on('open', () => {
				peer.ws = ws
				peer.connected = true
				peer.connecting = false
				peer.reconnectAttempts = 0
				logger.info(`WebSocket connected to ${peerId.substring(0, 8)}`)
			})

			ws.on('message', (data) => {
				const message = deserialize(data.toString())
				if (!message) return
				for (const handler of this.messageHandlers) {
					handler(message, message.from)
				}
			})

			ws.on('close', () => {
				peer.connecting = false
				if (peer.ws === ws) {
					peer.ws = null
					peer.connected = false
				}
				// Reschedule on any close, including a failed initial connect (peer.ws never set).
				this.scheduleReconnect(peerId)
			})

			ws.on('error', () => {
				// close event fires after error — reconnect handled there
			})
		} catch {
			peer.connecting = false
			this.scheduleReconnect(peerId)
		}
	}

	/**
	 * Schedule WebSocket reconnect with exponential backoff.
	 */
	private scheduleReconnect(peerId: string): void {
		const peer = this.peers.get(peerId)
		if (!peer || peer.reconnectTimer) return
		if (peer.reconnectAttempts >= WS_RECONNECT_MAX_RETRIES) {
			logger.warn(`Max reconnect attempts for ${peerId.substring(0, 8)} — HTTP fallback only`)
			return
		}

		const delay = WS_RECONNECT_INTERVAL_MS * Math.pow(1.5, peer.reconnectAttempts)
		peer.reconnectAttempts++

		peer.reconnectTimer = setTimeout(() => {
			peer.reconnectTimer = null
			if (this.peers.has(peerId) && !peer.ws) {
				this.connectWebSocket(peerId)
			}
		}, delay)
	}
}
