/**
 * VoleNet Transport — HTTPS server + WebSocket for peer communication.
 * Handles incoming connections, outgoing peer connections, and message routing.
 */

import * as http from 'node:http'
import * as https from 'node:https'
import * as fs from 'node:fs'
import { createLogger } from '../core/logger.js'
import {
	serialize,
	deserialize,
	type VoleNetMessage,
} from './protocol.js'

const logger = createLogger('volenet-transport')

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
	ws: import('node:http').IncomingMessage | null // placeholder for WebSocket
	endpoint: string
	connected: boolean
	lastSeen: number
}

/**
 * VoleNet Transport layer.
 * Manages HTTP server for incoming connections and WebSocket clients for peers.
 */
export class VoleNetTransport {
	private server: http.Server | https.Server | null = null
	private peers = new Map<string, PeerConnection>()
	private messageHandlers: MessageHandler[] = []
	private config: TransportConfig
	private started = false

	constructor(config: TransportConfig) {
		this.config = config
	}

	/**
	 * Start the transport server.
	 */
	async start(): Promise<void> {
		if (this.started) return

		const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
			// Health endpoint
			if (req.url === '/health' && req.method === 'GET') {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ status: 'ok', protocol: 'volenet', version: 1 }))
				return
			}

			// Message endpoint
			if (req.url === '/volenet/message' && req.method === 'POST') {
				let body = ''
				req.on('data', (chunk) => { body += chunk })
				req.on('end', () => {
					const message = deserialize(body)
					if (!message) {
						res.writeHead(400, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify({ error: 'Invalid message' }))
						return
					}
					// Route to handlers
					for (const handler of this.messageHandlers) {
						handler(message, message.from)
					}
					res.writeHead(200, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ ok: true }))
				})
				return
			}

			// Auth challenge endpoint
			if (req.url === '/volenet/auth' && req.method === 'POST') {
				let body = ''
				req.on('data', (chunk) => { body += chunk })
				req.on('end', () => {
					const message = deserialize(body)
					if (!message) {
						res.writeHead(400)
						res.end()
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

			// Peer info endpoint
			if (req.url === '/volenet/info' && req.method === 'GET') {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({
					protocol: 'volenet',
					version: 1,
					peers: this.peers.size,
				}))
				return
			}

			res.writeHead(404)
			res.end()
		}

		if (this.config.tls) {
			const tlsOptions = {
				cert: fs.readFileSync(this.config.tls.cert),
				key: fs.readFileSync(this.config.tls.key),
			}
			this.server = https.createServer(tlsOptions, requestHandler)
		} else {
			this.server = http.createServer(requestHandler)
		}

		await new Promise<void>((resolve, reject) => {
			this.server!.listen(this.config.port, () => {
				const scheme = this.config.tls ? 'https' : 'http'
				logger.info(`VoleNet server listening on ${scheme}://0.0.0.0:${this.config.port}`)
				resolve()
			})
			this.server!.on('error', reject)
		})

		this.started = true
	}

	/**
	 * Stop the transport server.
	 */
	async stop(): Promise<void> {
		if (!this.started) return

		// Close peer connections
		this.peers.clear()

		// Close server
		if (this.server) {
			await new Promise<void>((resolve) => {
				this.server!.close(() => resolve())
			})
			this.server = null
		}

		this.started = false
		logger.info('VoleNet server stopped')
	}

	/**
	 * Register a message handler.
	 */
	onMessage(handler: MessageHandler): void {
		this.messageHandlers.push(handler)
	}

	/**
	 * Send a message to a specific peer via HTTP POST.
	 */
	async sendToPeer(peerId: string, message: VoleNetMessage): Promise<boolean> {
		const peer = this.peers.get(peerId)
		if (!peer) {
			logger.warn(`Peer not found: ${peerId}`)
			return false
		}

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
			logger.warn(`Failed to send to peer ${peerId}: ${err instanceof Error ? err.message : String(err)}`)
			peer.connected = false
			return false
		}
	}

	/**
	 * Broadcast a message to all connected peers.
	 */
	async broadcast(message: VoleNetMessage): Promise<number> {
		let sent = 0
		for (const [peerId] of this.peers) {
			if (await this.sendToPeer(peerId, message)) {
				sent++
			}
		}
		return sent
	}

	/**
	 * Register a peer connection.
	 */
	addPeer(peerId: string, endpoint: string): void {
		this.peers.set(peerId, {
			peerId,
			ws: null,
			endpoint,
			connected: true,
			lastSeen: Date.now(),
		})
		logger.info(`Peer added: ${peerId.substring(0, 8)} (${endpoint})`)
	}

	/**
	 * Remove a peer connection.
	 */
	removePeer(peerId: string): void {
		this.peers.delete(peerId)
		logger.info(`Peer removed: ${peerId.substring(0, 8)}`)
	}

	/**
	 * Get all connected peers.
	 */
	getPeers(): Array<{ peerId: string; endpoint: string; connected: boolean; lastSeen: number }> {
		return Array.from(this.peers.values()).map((p) => ({
			peerId: p.peerId,
			endpoint: p.endpoint,
			connected: p.connected,
			lastSeen: p.lastSeen,
		}))
	}

	/**
	 * Check if a peer is connected.
	 */
	isPeerConnected(peerId: string): boolean {
		return this.peers.get(peerId)?.connected ?? false
	}

	/**
	 * Ping a peer to check connectivity.
	 */
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
}
