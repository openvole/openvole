import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { type WebSocket, WebSocketServer } from 'ws'
import { getDashboardHtml } from './ui.js'

const logger = {
	info: (msg: string) => console.info(`[dashboard] ${msg}`),
	error: (msg: string) => console.error(`[dashboard] ${msg}`),
}

export interface DashboardServer {
	/** Broadcast a message to all connected WebSocket clients */
	broadcast(type: string, data: unknown, event?: string, spaceId?: string): void
	/** Shut down the server */
	close(): Promise<void>
}

export interface SpaceSummary {
	id: string
	name: string
	state: 'running' | 'stopped'
	pid?: number
}

export interface DashboardCallbacks {
	/** Multi-space (control plane). Omitted by the single-engine paw. */
	listSpaces?: () => Promise<SpaceSummary[]>
	createSpace?: (name: string) => Promise<unknown>
	removeSpace?: (spaceId: string) => Promise<unknown>
	startSpace?: (spaceId: string) => Promise<unknown>
	stopSpace?: (spaceId: string) => Promise<unknown>
	listAvailablePaws?: () => Promise<unknown>
	installPaw?: (name: string, spaceId?: string) => Promise<unknown>
	submitTask?: (input: string, sessionId?: string, spaceId?: string) => Promise<unknown>
	chatHistory?: (sessionId?: string, spaceId?: string) => Promise<unknown>
	chatSessions?: (spaceId?: string) => Promise<unknown>
	chatClear?: (sessionId: string, spaceId?: string) => Promise<unknown>
	volenetInstances?: (spaceId?: string) => Promise<unknown>
	volenetChatHistory?: (peerId?: string, spaceId?: string) => Promise<unknown>
	volenetChatSend?: (peerId: string, text: string, spaceId?: string) => Promise<unknown>
	volenetChatClear?: (peerId: string, spaceId?: string) => Promise<unknown>
	getPanelHtml?: (spaceId: string, paw: string) => Promise<unknown>
	callPawTool?: (spaceId: string, name: string, params: unknown) => Promise<unknown>
	/** Per-space; spaceId is undefined in single-engine mode. */
	fetchState: (spaceId?: string) => Promise<unknown>
	readConfig: (spaceId?: string) => Promise<unknown>
	writeConfig: (config: unknown, spaceId?: string) => Promise<unknown>
	readIdentity: (spaceId?: string) => Promise<unknown>
	writeIdentity: (filename: string, content: string, spaceId?: string) => Promise<unknown>
	restartEngine: (spaceId?: string) => Promise<unknown>
}

export function createDashboardServer(
	port: number,
	callbacks: DashboardCallbacks,
	options?: { host?: string; token?: string },
): DashboardServer {
	const clients = new Set<WebSocket>()
	// Per-connection selected space (control-plane mode); undefined = single-engine.
	const selected = new Map<WebSocket, string | undefined>()
	const host = options?.host ?? '0.0.0.0'
	const token = options?.token

	// Require the session token (query ?token= or x-vole-token header) when one is configured.
	const tokenOk = (req: http.IncomingMessage): boolean => {
		if (!token) return true
		const u = new URL(req.url || '/', 'http://localhost')
		const provided =
			u.searchParams.get('token') ?? (req.headers['x-vole-token'] as string | undefined)
		return provided === token
	}
	// Reject cross-site requests (CSWSH/CSRF): a browser's Origin must match the Host it connected to.
	const sameOrigin = (req: http.IncomingMessage): boolean => {
		const origin = req.headers.origin
		if (!origin) return true // non-browser client (no Origin) — still token-gated
		try {
			return new URL(origin).host === req.headers.host
		} catch {
			return false
		}
	}

	// Resolve assets directory relative to the paw's own directory
	const assetsDir = path.resolve(
		import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
		'..',
		'assets',
	)

	const MIME_TYPES: Record<string, string> = {
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.ico': 'image/x-icon',
		'.svg': 'image/svg+xml',
	}

	// Serve an embedded paw panel (HTML) and proxy its tool calls, all over IPC to the space.
	async function servePanel(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		try {
			const u = new URL(req.url || '/', 'http://localhost')
			const parts = u.pathname.split('/').filter(Boolean) // ['panel', space, encPaw, ...]
			const space = parts[1] ? decodeURIComponent(parts[1]) : ''
			const paw = parts[2] ? decodeURIComponent(parts[2]) : ''
			if (!space || !paw) {
				res.writeHead(404)
				res.end()
				return
			}
			if (parts[3] === 'tool' && parts[4]) {
				let body = ''
				for await (const chunk of req) body += chunk
				const params = body ? JSON.parse(body) : {}
				const result = await callbacks.callPawTool?.(space, decodeURIComponent(parts[4]), params)
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify(result ?? {}))
				return
			}
			const r = (await callbacks.getPanelHtml?.(space, paw)) as { html?: string } | undefined
			if (!r?.html) {
				res.writeHead(404)
				res.end('panel not found')
				return
			}
			res.writeHead(200, {
				'Content-Type': 'text/html; charset=utf-8',
				'X-Content-Type-Options': 'nosniff',
			})
			res.end(r.html)
		} catch (e) {
			res.writeHead(500)
			res.end(e instanceof Error ? e.message : String(e))
		}
	}

	// HTTP server — serves the dashboard HTML and static assets
	const httpServer = http.createServer((req, res) => {
		// Serve favicon
		if (req.url === '/favicon.ico') {
			try {
				const icon = fs.readFileSync(path.join(assetsDir, 'vole.ico'))
				res.writeHead(200, {
					'Content-Type': 'image/x-icon',
					'Cache-Control': 'public, max-age=86400',
				})
				res.end(icon)
			} catch {
				res.writeHead(404)
				res.end()
			}
			return
		}

		// Serve static assets from /assets/*
		if (req.url?.startsWith('/assets/')) {
			const fileName = path.basename(req.url)
			const filePath = path.resolve(assetsDir, fileName)
			// Prevent path traversal
			if (!filePath.startsWith(assetsDir)) {
				res.writeHead(403)
				res.end()
				return
			}
			try {
				const file = fs.readFileSync(filePath)
				const ext = path.extname(fileName).toLowerCase()
				res.writeHead(200, {
					'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
					'Cache-Control': 'public, max-age=86400',
					'X-Content-Type-Options': 'nosniff',
				})
				res.end(file)
			} catch {
				res.writeHead(404)
				res.end()
			}
			return
		}

		// Embedded paw panels: /panel/<space>/<encodedPaw>/  and  .../tool/<name>
		if (req.url?.startsWith('/panel/')) {
			const isTool = req.url.includes('/tool/')
			if (isTool) {
				// A tool POST executes a paw tool. Require a PRESENT, matching Origin: a browser's
				// same-origin POST sends one; a token-less curl or a cross-site page does not / won't
				// match. (Missing Origin is NOT allowed here, unlike the token-gated routes.)
				const origin = req.headers.origin
				let ok = false
				try {
					ok = !!origin && new URL(origin).host === req.headers.host
				} catch {
					ok = false
				}
				if (!ok) {
					res.writeHead(403)
					res.end()
					return
				}
			} else if (!tokenOk(req)) {
				// Panel HTML is opened by the dashboard with ?token=.
				res.writeHead(401)
				res.end()
				return
			}
			void servePanel(req, res)
			return
		}

		if (!tokenOk(req)) {
			res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
			res.end('Unauthorized — open the dashboard using the tokenized URL printed by `vole serve`.')
			return
		}
		res.writeHead(200, {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-cache',
			'X-Content-Type-Options': 'nosniff',
			'X-Frame-Options': 'DENY',
		})
		res.end(getDashboardHtml(port))
	})

	/** Handle incoming WebSocket commands from the browser */
	async function handleCommand(
		ws: WebSocket,
		cmd: { type: string; id: string; params?: unknown },
	): Promise<void> {
		const respond = (data?: unknown, error?: string) => {
			if (ws.readyState === ws.OPEN) {
				ws.send(JSON.stringify({ type: 'response', id: cmd.id, data, error }))
			}
		}

		try {
			const sel = (): string | undefined => selected.get(ws)
			switch (cmd.type) {
				case 'list_spaces':
					respond((await callbacks.listSpaces?.()) ?? [])
					break
				case 'list_available_paws':
					respond((await callbacks.listAvailablePaws?.()) ?? [])
					break
				case 'install_paw': {
					const p = cmd.params as { name: string; spaceId?: string }
					respond(await callbacks.installPaw?.(p?.name, p?.spaceId ?? sel()))
					break
				}
				case 'submit': {
					const p = cmd.params as { input: string; sessionId?: string }
					respond(await callbacks.submitTask?.(p?.input, p?.sessionId, sel()))
					break
				}
				case 'chat_history': {
					const p = cmd.params as { sessionId?: string }
					respond(await callbacks.chatHistory?.(p?.sessionId, sel()))
					break
				}
				case 'chat_sessions':
					respond(await callbacks.chatSessions?.(sel()))
					break
				case 'chat_clear': {
					const p = cmd.params as { sessionId: string }
					respond(await callbacks.chatClear?.(p?.sessionId, sel()))
					break
				}
				case 'volenet_instances':
					respond(await callbacks.volenetInstances?.(sel()))
					break
				case 'volenet_chat_history': {
					const p = cmd.params as { peerId?: string }
					respond(await callbacks.volenetChatHistory?.(p?.peerId, sel()))
					break
				}
				case 'volenet_chat_send': {
					const p = cmd.params as { peerId: string; text: string }
					respond(await callbacks.volenetChatSend?.(p?.peerId, p?.text, sel()))
					break
				}
				case 'volenet_chat_clear': {
					const p = cmd.params as { peerId: string }
					respond(await callbacks.volenetChatClear?.(p?.peerId, sel()))
					break
				}
				case 'select_space': {
					const p = cmd.params as { spaceId?: string }
					selected.set(ws, p?.spaceId)
					respond(await callbacks.fetchState(p?.spaceId))
					break
				}
				case 'create_space': {
					const p = cmd.params as { name: string }
					respond(await callbacks.createSpace?.(p?.name))
					break
				}
				case 'remove_space': {
					const p = cmd.params as { spaceId: string }
					respond(await callbacks.removeSpace?.(p?.spaceId))
					break
				}
				case 'start_space': {
					const p = cmd.params as { spaceId: string }
					respond(await callbacks.startSpace?.(p?.spaceId))
					break
				}
				case 'stop_space': {
					const p = cmd.params as { spaceId: string }
					respond(await callbacks.stopSpace?.(p?.spaceId))
					break
				}
				case 'fetch_state':
					respond(await callbacks.fetchState(sel()))
					break
				case 'read_config':
					respond(await callbacks.readConfig(sel()))
					break
				case 'write_config': {
					const p = cmd.params as { config: unknown }
					respond(await callbacks.writeConfig(p?.config, sel()))
					break
				}
				case 'read_identity':
					respond(await callbacks.readIdentity(sel()))
					break
				case 'write_identity': {
					const p = cmd.params as { filename: string; content: string }
					respond(await callbacks.writeIdentity(p?.filename, p?.content, sel()))
					break
				}
				case 'restart_engine':
					respond(await callbacks.restartEngine(sel()))
					break
				default:
					respond(undefined, `Unknown command: ${cmd.type}`)
			}
		} catch (err) {
			respond(undefined, err instanceof Error ? err.message : String(err))
		}
	}

	// WebSocket server — real-time events + commands
	const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

	wss.on('connection', async (ws, req) => {
		// Token + same-origin gate — kills cross-site WebSocket hijacking and unauthorized control.
		if (!tokenOk(req) || !sameOrigin(req)) {
			ws.close(1008, 'unauthorized')
			return
		}
		clients.add(ws)
		logger.info(`Client connected (${clients.size} total)`)

		ws.on('close', () => {
			clients.delete(ws)
			selected.delete(ws)
			logger.info(`Client disconnected (${clients.size} total)`)
		})

		ws.on('error', (err) => {
			logger.error(`WebSocket error: ${err.message}`)
			clients.delete(ws)
		})

		// Handle incoming commands from the browser
		ws.on('message', (raw) => {
			try {
				const msg = JSON.parse(raw.toString())
				if (msg.type && msg.id) {
					handleCommand(ws, msg)
				}
			} catch {
				// Ignore malformed messages
			}
		})

		// Send initial snapshot: spaces list (control plane) or state (single-engine paw)
		try {
			if (callbacks.listSpaces) {
				ws.send(JSON.stringify({ type: 'spaces', data: await callbacks.listSpaces() }))
			} else {
				ws.send(JSON.stringify({ type: 'state', data: await callbacks.fetchState() }))
			}
		} catch (err) {
			logger.error(`Failed to send initial snapshot: ${err}`)
		}
	})

	httpServer.on('error', (err) => {
		// Without this, EADDRINUSE (port already in use, e.g. a restart race) crashes the process.
		logger.error(`Dashboard HTTP server error: ${(err as Error).message}`)
	})
	httpServer.listen(port, host, () => {
		const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host
		logger.info(`Dashboard listening on ${host}:${port} (open http://${shown}:${port})`)
	})

	return {
		broadcast(type: string, data: unknown, event?: string, spaceId?: string) {
			const msg: Record<string, unknown> = { type, data }
			if (event) msg.event = event
			if (spaceId !== undefined) msg.spaceId = spaceId
			const message = JSON.stringify(msg)
			for (const client of clients) {
				if (client.readyState === client.OPEN) {
					client.send(message)
				}
			}
		},

		async close() {
			for (const client of clients) {
				client.close()
			}
			clients.clear()
			wss.close()
			return new Promise<void>((resolve) => {
				httpServer.close(() => resolve())
			})
		},
	}
}
