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
const DEFAULT_MAX_CONNECTIONS = 1000 // cap concurrent inbound WebSocket connections (DoS)
const DEFAULT_AUTH_TIMEOUT_MS = 10_000 // close inbound sockets that never send a verified message (DoS)
const DEFAULT_MAX_MESSAGES_PER_SECOND = 5000 // global inbound message ceiling across all sources (load shed)
const REPLAY_WINDOW_MS = 65_000 // remember accepted (from,id) a bit beyond the 60s freshness window
const REPLAY_MAX_ENTRIES = 20_000 // sweep the replay cache once it grows past this

export interface TransportConfig {
	port: number
	tls?: {
		cert: string
		key: string
	}
	/** Max inbound messages per minute per source (IP / WS connection). Default 1200. */
	maxMessagesPerMinute?: number
	/** Max concurrent inbound WebSocket connections (DoS). Default 1000. */
	maxConnections?: number
	/** Close an inbound WS that doesn't send a verified message within this window, ms (DoS). Default 10000. */
	authTimeoutMs?: number
	/** Global inbound message ceiling per second across all sources (load shed). Default 5000. */
	maxMessagesPerSecond?: number
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
	/** Optional outbound transform — wraps a message in a sealed:direct envelope before sending. */
	private sealer: ((peerId: string, message: VoleNetMessage) => VoleNetMessage) | null = null
	private joinHandler: JoinHandler | null = null
	private msgWindow = new Map<string, number[]>()
	private wsConnSeq = 0
	private config: TransportConfig
	private started = false
	private wsConnections = 0
	private globalWindow: number[] = []
	private verifyFn?: (message: VoleNetMessage) => boolean
	private responder?: (message: VoleNetMessage) => VoleNetMessage | null
	private onConnectCbs: Array<(peerId: string) => void> = []
	private onDisconnectCbs: Array<(peerId: string) => void> = []
	private seenMsgs = new Map<string, number>()

	constructor(config: TransportConfig) {
		this.config = config
	}

	/** Register a handler for public self-join requests (HTTP POST /volenet/join). */
	setJoinHandler(handler: JoinHandler): void {
		this.joinHandler = handler
	}

	/**
	 * Inject a signature verifier. An inbound WebSocket is bound to a peer id ONLY after a
	 * message from it verifies — so an attacker can't claim a victim's id and hijack its
	 * downstream traffic.
	 */
	setVerifier(fn: (message: VoleNetMessage) => boolean): void {
		this.verifyFn = fn
	}

	/**
	 * Inject a request responder for request/response messages (e.g. `discover` over HTTP).
	 * The returned message is delivered inline in the HTTP response body, so a peer behind NAT
	 * learns the responder's identity without the responder having to dial it back.
	 */
	setResponder(fn: (message: VoleNetMessage) => VoleNetMessage | null): void {
		this.responder = fn
	}

	/**
	 * Called when an outbound WebSocket to a peer opens. Lets the owner push a signed message
	 * immediately so the remote side binds this socket without waiting for the next heartbeat —
	 * which is what makes reverse delivery (hub→NAT'd-follower) consistent right after (re)connect.
	 */
	setOnConnect(fn: (peerId: string) => void): void {
		this.onConnectCbs.push(fn)
	}

	setOnDisconnect(fn: (peerId: string) => void): void {
		this.onDisconnectCbs.push(fn)
	}

	/** Global sliding-window message ceiling across all sources (load shed). False when over. */
	private globalRateAllow(): boolean {
		const now = Date.now()
		const max = this.config.maxMessagesPerSecond ?? DEFAULT_MAX_MESSAGES_PER_SECOND
		this.globalWindow = this.globalWindow.filter((t) => now - t < 1000)
		if (this.globalWindow.length >= max) return false
		this.globalWindow.push(now)
		return true
	}

	/**
	 * Central inbound gate. Every message must (a) verify — valid signature from an authorized
	 * peer — and (b) not be a replay of a recently-accepted (from,id), before it reaches ANY
	 * handler. Fails closed if no verifier is wired. This makes verification a single chokepoint
	 * so an individual handler can never forget to check.
	 */
	private verifyAndAccept(message: VoleNetMessage): boolean {
		if (!this.verifyFn || !this.verifyFn(message)) return false
		const key = `${message.from}:${message.id}`
		const now = Date.now()
		if (this.seenMsgs.has(key)) return false // replay within the freshness window
		this.seenMsgs.set(key, now)
		if (this.seenMsgs.size > REPLAY_MAX_ENTRIES) {
			for (const [k, t] of this.seenMsgs) if (now - t > REPLAY_WINDOW_MS) this.seenMsgs.delete(k)
		}
		return true
	}

	/** Sliding-window rate limit per source (IP or WS connection). Returns false when over. */
	private rateAllow(key: string): boolean {
		const max = this.config.maxMessagesPerMinute ?? MAX_MESSAGES_PER_MINUTE
		const now = Date.now()
		// Prune stale per-source windows so the map can't grow unbounded under IP/connection spray.
		if (this.msgWindow.size > 4096) {
			for (const [k, ts] of this.msgWindow) {
				if (ts.length === 0 || now - ts[ts.length - 1] > 60_000) this.msgWindow.delete(k)
			}
		}
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
				if (!this.rateAllow(`ip:${ip}`) || !this.globalRateAllow()) {
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
					// Verify signature + authorization + replay BEFORE any handler runs.
					if (!this.verifyAndAccept(message)) {
						res.writeHead(401, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify({ error: 'unverified' }))
						return
					}
					for (const handler of this.messageHandlers) {
						handler(message, message.from)
					}
					// Inline reply (e.g. discover:response) so a NAT'd sender learns our identity
					// from its own request — we don't have to dial it back.
					const reply = this.responder ? this.responder(message) : null
					res.writeHead(200, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify(reply ? { ok: true, response: reply } : { ok: true }))
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
		this.wss = new WebSocketServer({ server: this.server, maxPayload: MAX_MESSAGE_BYTES })

		this.wss.on('error', (err) => {
			logger.warn(`VoleNet WebSocket server error: ${err.message}`)
		})

		this.wss.on('connection', (ws) => {
			// Attach an error listener immediately — a socket erroring during the cap/auth-timeout
			// close below (before the main handler is wired) would otherwise crash the process.
			ws.on('error', () => {})
			// Connection cap (DoS): refuse new sockets past the limit.
			const maxConns = this.config.maxConnections ?? DEFAULT_MAX_CONNECTIONS
			if (this.wsConnections >= maxConns) {
				ws.close(1013, 'too many connections')
				return
			}
			this.wsConnections++

			const connKey = `ws:${++this.wsConnSeq}`
			let authedPeerId: string | null = null

			// Auth timeout (DoS): drop sockets that never send a verified message.
			const authTimer = setTimeout(() => {
				if (!authedPeerId) {
					logger.warn('Closing unauthenticated WebSocket (auth timeout)')
					ws.close(1008, 'auth timeout')
				}
			}, this.config.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS)

			ws.on('message', (data) => {
				if (!this.rateAllow(connKey)) return // per-connection rate limit
				if (!this.globalRateAllow()) return // global load shed
				const message = deserialize(data.toString())
				if (!message) return
				// Verify signature + authorization + replay for EVERY message before dispatch.
				if (!this.verifyAndAccept(message)) return

				if (!authedPeerId) {
					// First verified message binds this socket to that peer id (the binding is what
					// sendToPeer routes over). An attacker can't bind a victim's id — verifyAndAccept
					// already proved the signature.
					authedPeerId = message.from
					clearTimeout(authTimer)
					const existing = this.peers.get(message.from)
					if (existing) {
						existing.ws = ws
						existing.connected = true
					} else {
						this.peers.set(message.from, {
							peerId: message.from,
							endpoint: '',
							connected: true,
							lastSeen: Date.now(),
							ws,
							reconnectTimer: null,
							reconnectAttempts: 0,
							connecting: false,
						})
					}
					logger.info(`WebSocket authenticated + bound to peer ${message.from.substring(0, 8)}`)
					for (const cb of this.onConnectCbs) cb(message.from)
				} else if (message.from !== authedPeerId) {
					// A socket authenticated as one peer cannot later speak for another.
					return
				}

				for (const handler of this.messageHandlers) {
					handler(message, message.from)
				}
			})

			ws.on('close', () => {
				this.wsConnections--
				clearTimeout(authTimer)
				this.msgWindow.delete(connKey)
				for (const [peerId, peer] of this.peers) {
					if (peer.ws === ws) {
						peer.ws = null
						peer.connected = false
						logger.info(`WebSocket disconnected: ${peerId.substring(0, 8)}`)
						for (const cb of this.onDisconnectCbs) cb(peerId)
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
		this.seenMsgs.clear()
		this.msgWindow.clear()
		this.globalWindow = []

		// Close WS clients, then force-drop any lingering keep-alive / upgraded sockets
		// so the listening port is released promptly. Otherwise server.close() waits on
		// open connections and a restart races the old listener (EADDRINUSE).
		if (this.wss) {
			// wss.close() waits for every client socket; reconnect churn can leave inbound
			// sockets that no peer entry references (a rebind replaces entry.ws, orphaning the
			// old one). Terminate them all or close() never calls back and stop() hangs.
			for (const client of this.wss.clients) client.terminate()
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

	/** Install the outbound seal transform (direct end-to-end encryption). */
	setSealer(fn: (peerId: string, message: VoleNetMessage) => VoleNetMessage): void {
		this.sealer = fn
	}

	/**
	 * Feed a message into the normal receive pipeline as if it arrived over the wire. Used to
	 * re-dispatch the inner message recovered from a sealed:direct envelope, so every handler
	 * (tool calls, sync, chat) processes it — with full signature/replay/authorization checks —
	 * exactly as an unencrypted direct message.
	 */
	injectMessage(message: VoleNetMessage): boolean {
		if (!this.verifyAndAccept(message)) return false
		for (const handler of this.messageHandlers) handler(message, message.from)
		return true
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

		// Direct-seal hook: the manager may wrap this into a sealed:direct envelope (transparent
		// end-to-end encryption to a capable peer). Relay/bootstrap types pass through unchanged.
		const outbound = this.sealer ? this.sealer(peerId, message) : message

		// Try WebSocket first
		if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
			try {
				peer.ws.send(serialize(outbound))
				peer.lastSeen = Date.now()
				// A successful push proves the channel is live — heal `connected` in case a prior
				// HTTP-fallback failure (e.g. to a NAT'd peer's unreachable advertised endpoint)
				// latched it false. Only the WS bind/open path sets it true, so without this a
				// stuck-false peer would never recover even while its socket works.
				peer.connected = true
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
				body: serialize(outbound),
				// Short fallback: when there's no live socket (e.g. a NAT'd peer mid-reconnect),
				// fail fast instead of hanging — the WS is the real delivery path.
				signal: AbortSignal.timeout(5000),
			})
			peer.lastSeen = Date.now()
			return response.ok
		} catch (err) {
			logger.warn(
				`Send failed for ${peerId.substring(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
			)
			// Do NOT latch `connected = false` here. This one-shot HTTP POST fails routinely for
			// NAT'd peers whose advertised endpoint (a LAN/private IP) the hub can't reach — but
			// their real delivery path is the inbound WebSocket they hold open to us. Connectivity
			// is owned by the WS bind (true) / close (false) lifecycle; a failed best-effort
			// fallback must not mark a peer with a live socket offline.
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
		if (!this.started) return // no fresh dials during/after shutdown
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
				// Push a signed message now so the remote binds this socket immediately
				// (don't wait up to a heartbeat interval) — keeps reverse delivery consistent.
				for (const cb of this.onConnectCbs) cb(peerId)
			})

			ws.on('message', (data) => {
				if (!this.globalRateAllow()) return // global load shed
				const message = deserialize(data.toString())
				if (!message) return
				// Verify signature + authorization + replay before dispatch (same gate as inbound).
				if (!this.verifyAndAccept(message)) return
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
