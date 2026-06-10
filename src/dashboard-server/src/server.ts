import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { type WebSocket, WebSocketServer } from 'ws'
import { getDashboardHtml } from './ui.js'

const logger = {
	info: (msg: string) => console.info(`[paw-dashboard] ${msg}`),
	error: (msg: string) => console.error(`[paw-dashboard] ${msg}`),
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
): DashboardServer {
	const clients = new Set<WebSocket>()
	// Per-connection selected space (control-plane mode); undefined = single-engine.
	const selected = new Map<WebSocket, string | undefined>()

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
					const p = cmd.params as { name: string }
					respond(await callbacks.installPaw?.(p?.name, sel()))
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

	wss.on('connection', async (ws) => {
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

	httpServer.listen(port, () => {
		logger.info(`Dashboard running at http://localhost:${port}`)
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
