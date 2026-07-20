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
	broadcast(type: string, data: unknown, event?: string, agentId?: string): void
	/** Shut down the server */
	close(): Promise<void>
}

export interface AgentSummary {
	id: string
	name: string
	state: 'running' | 'stopped'
	pid?: number
	/** This agent can manage its siblings via the control plane (agent_* tools). */
	orchestrator?: boolean
}

/** @deprecated Pre-rename alias — use AgentSummary. */
export type SpaceSummary = AgentSummary

export interface DashboardCallbacks {
	/** Multi-agent (control plane). Omitted by the single-engine paw. */
	listAgents?: () => Promise<AgentSummary[]>
	createAgent?: (name: string) => Promise<unknown>
	removeAgent?: (agentId: string) => Promise<unknown>
	startAgent?: (agentId: string) => Promise<unknown>
	stopAgent?: (agentId: string) => Promise<unknown>
	listAvailablePaws?: () => Promise<unknown>
	installPaw?: (name: string, agentId?: string) => Promise<unknown>
	submitTask?: (input: string, sessionId?: string, agentId?: string) => Promise<unknown>
	chatHistory?: (sessionId?: string, agentId?: string) => Promise<unknown>
	chatSessions?: (agentId?: string) => Promise<unknown>
	chatClear?: (sessionId: string, agentId?: string) => Promise<unknown>
	volenetInstances?: (agentId?: string) => Promise<unknown>
	volenetChatHistory?: (peerId?: string, agentId?: string) => Promise<unknown>
	volenetChatSend?: (peerId: string, text: string, agentId?: string) => Promise<unknown>
	volenetChatClear?: (peerId: string, agentId?: string) => Promise<unknown>
	volenetRelayMembers?: (agentId?: string) => Promise<unknown>
	volenetRelayRequests?: (agentId?: string) => Promise<unknown>
	volenetRelayConnect?: (
		peerId: string,
		note: string | undefined,
		agentId?: string,
	) => Promise<unknown>
	volenetRelayApprove?: (peerId: string, agentId?: string) => Promise<unknown>
	volenetRelayDeny?: (peerId: string, agentId?: string) => Promise<unknown>
	volenetRelayRevoke?: (peerId: string, agentId?: string) => Promise<unknown>
	getPanelHtml?: (agentId: string, paw: string) => Promise<unknown>
	/** Tools with real JSON-schema parameters for the MCP bridge (falls back to fetchState). */
	listMcpTools?: (agentId?: string) => Promise<unknown>
	callPawTool?: (agentId: string, name: string, params: unknown) => Promise<unknown>
	/** Per-agent; agentId is undefined in single-engine mode. */
	fetchState: (agentId?: string) => Promise<unknown>
	readConfig: (agentId?: string) => Promise<unknown>
	writeConfig: (config: unknown, agentId?: string) => Promise<unknown>
	readIdentity: (agentId?: string) => Promise<unknown>
	writeIdentity: (filename: string, content: string, agentId?: string) => Promise<unknown>
	restartEngine: (agentId?: string) => Promise<unknown>
}

// Injected into every served panel. The panel runs in a sandboxed (null-origin) iframe so it
// can't read the dashboard token or reach the parent; this shim reroutes its `fetch('tool/…')`
// calls to the parent via postMessage, which forwards them over the authenticated WebSocket.
const PANEL_SHIM =
	'<script>(function(){' +
	'var _f=window.fetch,seq=0,pend={};' +
	"window.addEventListener('message',function(e){var d=e.data;if(d&&d.__voleToolResult&&pend[d.reqId]){pend[d.reqId](d.result);delete pend[d.reqId];}});" +
	'window.fetch=function(u,o){' +
	"if(typeof u==='string'&&(u.indexOf('tool/')===0||u.indexOf('./tool/')===0)){" +
	"var nm=u.indexOf('./tool/')===0?u.slice(7):u.slice(5);" +
	'var pr={};try{pr=o&&o.body?JSON.parse(o.body):{};}catch(_){}' +
	"var id='t'+(++seq);" +
	'return new Promise(function(rs){' +
	'pend[id]=function(r){rs({ok:true,status:200,json:function(){return Promise.resolve(r);},text:function(){return Promise.resolve(JSON.stringify(r));}});};' +
	"parent.postMessage({__voleTool:true,reqId:id,name:nm,params:pr},'*');" +
	'});}' +
	'return _f.apply(window,arguments);};})();</script>'

export function createDashboardServer(
	port: number,
	callbacks: DashboardCallbacks,
	options?: { host?: string; token?: string },
): DashboardServer {
	const clients = new Set<WebSocket>()
	// Per-connection selected agent (control-plane mode); undefined = single-engine.
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

	// Serve an embedded paw panel (HTML) and proxy its tool calls, all over IPC to the agent.
	async function servePanel(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		try {
			const u = new URL(req.url || '/', 'http://localhost')
			const parts = u.pathname.split('/').filter(Boolean) // ['panel', agent, encPaw, ...]
			const agent = parts[1] ? decodeURIComponent(parts[1]) : ''
			const paw = parts[2] ? decodeURIComponent(parts[2]) : ''
			if (!agent || !paw) {
				res.writeHead(404)
				res.end()
				return
			}
			if (parts[3] === 'tool' && parts[4]) {
				let body = ''
				for await (const chunk of req) body += chunk
				const params = body ? JSON.parse(body) : {}
				const result = await callbacks.callPawTool?.(agent, decodeURIComponent(parts[4]), params)
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify(result ?? {}))
				return
			}
			const r = (await callbacks.getPanelHtml?.(agent, paw)) as { html?: string } | undefined
			if (!r?.html) {
				res.writeHead(404)
				res.end('panel not found')
				return
			}
			res.writeHead(200, {
				'Content-Type': 'text/html; charset=utf-8',
				'X-Content-Type-Options': 'nosniff',
			})
			res.end(PANEL_SHIM + r.html)
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

		// MCP endpoint: /mcp/<agent> — exposes the agent's tools to an MCP client (e.g. a
		// Claude Code brain). Token-gated; a non-browser MCP client sends no Origin, so the
		// token is the gate. Tool execution reuses the same engine path as the panels.
		if (req.url?.startsWith('/mcp/')) {
			if (!tokenOk(req)) {
				res.writeHead(401)
				res.end()
				return
			}
			const agent = decodeURIComponent(
				new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean)[1] ?? '',
			)
			if (!agent) {
				res.writeHead(404)
				res.end()
				return
			}
			void (async () => {
				try {
					let raw = ''
					for await (const chunk of req) raw += chunk
					const body = raw ? JSON.parse(raw) : undefined
					const { handleMcpRequest } = await import('./mcp.js')
					await handleMcpRequest(req, res, body, {
						listTools: async () => {
							type McpTool = { name: string; description?: string; parameters?: unknown }
							if (callbacks.listMcpTools) {
								try {
									const tools = (await callbacks.listMcpTools(agent)) as McpTool[] | undefined
									if (Array.isArray(tools)) return tools
								} catch {
									/* older engine without tools_mcp — fall back to the state projection */
								}
							}
							const state = (await callbacks.fetchState(agent)) as { tools?: McpTool[] }
							return state?.tools ?? []
						},
						callTool: async (name, args) =>
							(await callbacks.callPawTool?.(agent, name, args)) ?? {
								error: 'tool execution unavailable',
							},
					})
				} catch (e) {
					if (!res.headersSent) {
						res.writeHead(500)
						res.end(e instanceof Error ? e.message : String(e))
					}
				}
			})()
			return
		}

		// Embedded paw panels: /panel/<agent>/<encodedPaw>/  and  .../tool/<name>
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
				case 'list_agents':
					respond((await callbacks.listAgents?.()) ?? [])
					break
				case 'list_available_paws':
					respond((await callbacks.listAvailablePaws?.()) ?? [])
					break
				case 'install_paw': {
					const p = cmd.params as { name: string; agentId?: string }
					respond(await callbacks.installPaw?.(p?.name, p?.agentId ?? sel()))
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
				case 'call_paw_tool': {
					// Sandboxed panels proxy tool calls here over the authenticated WS, scoped to the
					// agent the parent passes — the panel itself never holds the token.
					const p = cmd.params as {
						agent?: string
						name?: string
						params?: Record<string, unknown>
					}
					respond(
						await callbacks.callPawTool?.(p?.agent ?? sel() ?? '', p?.name ?? '', p?.params ?? {}),
					)
					break
				}
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
				case 'volenet_relay_members':
					respond(await callbacks.volenetRelayMembers?.(sel()))
					break
				case 'volenet_relay_requests':
					respond(await callbacks.volenetRelayRequests?.(sel()))
					break
				case 'volenet_relay_connect': {
					const p = cmd.params as { peerId: string; note?: string }
					respond(await callbacks.volenetRelayConnect?.(p?.peerId, p?.note, sel()))
					break
				}
				case 'volenet_relay_approve': {
					const p = cmd.params as { peerId: string }
					respond(await callbacks.volenetRelayApprove?.(p?.peerId, sel()))
					break
				}
				case 'volenet_relay_deny': {
					const p = cmd.params as { peerId: string }
					respond(await callbacks.volenetRelayDeny?.(p?.peerId, sel()))
					break
				}
				case 'volenet_relay_revoke': {
					const p = cmd.params as { peerId: string }
					respond(await callbacks.volenetRelayRevoke?.(p?.peerId, sel()))
					break
				}
				case 'select_agent': {
					const p = cmd.params as { agentId?: string }
					selected.set(ws, p?.agentId)
					respond(await callbacks.fetchState(p?.agentId))
					break
				}
				case 'create_agent': {
					const p = cmd.params as { name: string }
					respond(await callbacks.createAgent?.(p?.name))
					break
				}
				case 'remove_agent': {
					const p = cmd.params as { agentId: string }
					respond(await callbacks.removeAgent?.(p?.agentId))
					break
				}
				case 'start_agent': {
					const p = cmd.params as { agentId: string }
					respond(await callbacks.startAgent?.(p?.agentId))
					break
				}
				case 'stop_agent': {
					const p = cmd.params as { agentId: string }
					respond(await callbacks.stopAgent?.(p?.agentId))
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

		// Send initial snapshot: agents list (control plane) or state (single-engine paw)
		try {
			if (callbacks.listAgents) {
				ws.send(JSON.stringify({ type: 'agents', data: await callbacks.listAgents() }))
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
		broadcast(type: string, data: unknown, event?: string, agentId?: string) {
			const msg: Record<string, unknown> = { type, data }
			if (event) msg.event = event
			if (agentId !== undefined) msg.agentId = agentId
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
