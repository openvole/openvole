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

import * as http from 'node:http'
import * as https from 'node:https'
import * as fs from 'node:fs'
import { WebSocketServer, WebSocket } from 'ws'
import { createLogger } from '../core/logger.js'
import {
	serialize,
	deserialize,
	type VoleNetMessage,
} from './protocol.js'

const logger = createLogger('volenet-transport')

const WS_RECONNECT_INTERVAL_MS = 5_000
const WS_RECONNECT_MAX_RETRIES = 10

export interface TransportConfig {
	port: number
	tls?: {
		cert: string
		key: string
	}
}

export type MessageHandler = (message: VoleNetMessage, peerId: string) => void

interface PeerConnection {
	peerId: string
	endpoint: string
	connected: boolean
	lastSeen: number
	ws: WebSocket | null
	reconnectTimer: ReturnType<typeof setTimeout> | null
	reconnectAttempts: number
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
	private config: TransportConfig
	private started = false

	constructor(config: TransportConfig) {
		this.config = config
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
				let body = ''
				req.on('data', (chunk: Buffer) => { body += chunk })
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
				const wsCount = Array.from(this.peers.values())
					.filter((p) => p.ws?.readyState === WebSocket.OPEN).length
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({
					protocol: 'volenet',
					version: 1,
					peers: this.peers.size,
					websocketConnections: wsCount,
				}))
				return
			}

			res.writeHead(404)
			res.end()
		}

		if (this.config.tls) {
			this.server = https.createServer({
				cert: fs.readFileSync(this.config.tls.cert),
				key: fs.readFileSync(this.config.tls.key),
			}, requestHandler)
		} else {
			this.server = http.createServer(requestHandler)
		}

		// Attach WebSocket server
		this.wss = new WebSocketServer({ server: this.server })

		this.wss.on('connection', (ws) => {
			ws.on('message', (data) => {
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

		await new Promise<void>((resolve, reject) => {
			this.server!.listen(this.config.port, () => {
				const scheme = this.config.tls ? 'wss' : 'ws'
				logger.info(`VoleNet server listening on ${scheme}://0.0.0.0:${this.config.port} (HTTP + WebSocket)`)
				resolve()
			})
			this.server!.on('error', reject)
		})

		this.started = true
	}

	/**
	 * Stop the transport.
	 */
	async stop(): Promise<void> {
		if (!this.started) return

		for (const [, peer] of this.peers) {
			if (peer.ws) peer.ws.close()
			if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer)
		}
		this.peers.clear()

		if (this.wss) {
			this.wss.close()
			this.wss = null
		}

		if (this.server) {
			await new Promise<void>((resolve) => {
				this.server!.close(() => resolve())
			})
			this.server = null
		}

		this.started = false
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
			logger.warn(`Send failed for ${peerId.substring(0, 8)}: ${err instanceof Error ? err.message : String(err)}`)
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
		if (this.peers.has(peerId)) return

		this.peers.set(peerId, {
			peerId,
			endpoint,
			connected: false,
			lastSeen: Date.now(),
			ws: null,
			reconnectTimer: null,
			reconnectAttempts: 0,
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
			transport: p.ws?.readyState === WebSocket.OPEN ? 'websocket' as const
				: p.connected ? 'http' as const
				: 'disconnected' as const,
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

		const scheme = peer.endpoint.startsWith('https') ? 'wss' : 'ws'
		const wsUrl = peer.endpoint.replace(/^https?/, scheme)

		try {
			const ws = new WebSocket(wsUrl)

			ws.on('open', () => {
				peer.ws = ws
				peer.connected = true
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
				if (peer.ws === ws) {
					peer.ws = null
					peer.connected = false
					this.scheduleReconnect(peerId)
				}
			})

			ws.on('error', () => {
				// close event fires after error — reconnect handled there
			})
		} catch {
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
