/**
 * One node per machine, alive between sessions.
 *
 * A node that lives and dies with an editor session is *offline* whenever nothing is open: senders
 * hold what they cannot deliver, hubs record that somebody tried, and nothing arrives until you
 * reopen. That is a mailbox, not a channel. It also means two sessions run two nodes on one
 * identity, and a hub binds one socket per identity — so the second connection leaves the first
 * deaf.
 *
 * Both go away with a single long-lived process that owns the identity, the connections and the
 * writing of arrivals. Sessions attach to it over a unix socket and ask it to act. They do *not*
 * ask it what has arrived: the message log is a file, so reading stays local and needs no protocol.
 *
 * The socket is per identity directory, so a second daemon cannot start on the same identity, and
 * the first session to want one starts it.
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as net from 'node:net'
import * as path from 'node:path'
import { NET_METHODS, type NetLike } from './net-api.js'

export const socketPath = (dir: string) => path.join(dir, 'daemon.sock')

interface Request {
	id: number
	method: string
	args: unknown[]
}

interface Response {
	id: number
	ok: boolean
	result?: unknown
	error?: string
}

export interface ServeOptions {
	/** A session attached. */
	onBusy?: () => void
	/** The last session detached — nobody is holding this identity open any more. */
	onIdle?: () => void
}

/** Serve a node over a unix socket until the process is stopped. */
export async function serve(
	dir: string,
	node: NetLike,
	options: ServeOptions = {},
): Promise<net.Server> {
	const sock = socketPath(dir)
	await fs.mkdir(dir, { recursive: true })
	// A socket file outlives the process that made it. If nothing answers, it is stale.
	await fs.rm(sock, { force: true })

	// How many sessions are attached. The caller decides what an empty house means; all this knows
	// is when the number changes.
	let attached = 0

	const server = net.createServer((conn) => {
		attached += 1
		options.onBusy?.()
		let buffer = ''
		conn.setEncoding('utf-8')
		conn.on('data', (chunk) => {
			buffer += chunk
			for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
				const line = buffer.slice(0, nl)
				buffer = buffer.slice(nl + 1)
				if (line.trim()) void handle(line, conn, node)
			}
		})
		// A session going away is ordinary; it must never take the daemon with it.
		conn.on('error', () => undefined)
		conn.on('close', () => {
			attached = Math.max(0, attached - 1)
			if (attached === 0) options.onIdle?.()
		})
	})
	server.on('error', () => undefined)
	await new Promise<void>((done) => server.listen(sock, done))
	return server
}

async function handle(line: string, conn: net.Socket, node: NetLike): Promise<void> {
	let req: Request
	try {
		req = JSON.parse(line) as Request
	} catch {
		return
	}
	const reply = (r: Omit<Response, 'id'>) => {
		try {
			conn.write(`${JSON.stringify({ id: req.id, ...r })}\n`)
		} catch {
			// the session went away mid-call
		}
	}
	if (!(NET_METHODS as readonly string[]).includes(req.method)) {
		reply({ ok: false, error: `unknown method: ${req.method}` })
		return
	}
	try {
		const fn = node[req.method as keyof NetLike] as (...a: unknown[]) => Promise<unknown>
		reply({ ok: true, result: await fn(...(req.args ?? [])) })
	} catch (err) {
		reply({ ok: false, error: err instanceof Error ? err.message : String(err) })
	}
}

/** Talk to a daemon over its socket, as if the node were here. */
/**
 * Talk to a node over the socket, surviving the daemon going away.
 *
 * The daemon is not permanent — it leaves once the last session does, and it can be killed or
 * crash under a session that is still open. Rejecting whatever was in flight is only half of that:
 * a request made *after* the connection died would sit in `pending` for ever, because nothing was
 * ever going to answer it, and the caller sees a tool that hangs rather than one that failed.
 *
 * So the connection is a thing that can be dead, and asking again is how it comes back. Given a
 * `dir`, a call that finds the line down opens a new one — starting a daemon if none is listening —
 * and goes through that. Without one there is nowhere to reconnect to, and it fails at once.
 */
export function remoteNet(conn: net.Socket, dir?: string): NetLike {
	let next = 1
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
	let socket = conn
	let live = true

	const fail = (why: string) => {
		live = false
		for (const [, w] of pending) w.reject(new Error(why))
		pending.clear()
	}

	const wire = (s: net.Socket) => {
		let buffer = ''
		s.setEncoding('utf-8')
		s.on('data', (chunk) => {
			buffer += chunk
			for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
				const line = buffer.slice(0, nl)
				buffer = buffer.slice(nl + 1)
				if (!line.trim()) continue
				try {
					const res = JSON.parse(line) as Response
					const waiter = pending.get(res.id)
					if (!waiter) continue
					pending.delete(res.id)
					if (res.ok) waiter.resolve(res.result)
					else waiter.reject(new Error(res.error ?? 'daemon error'))
				} catch {
					// not ours
				}
			}
		})
		// Only the socket we are currently using gets to declare the line dead; an old one closing
		// after we have already moved on says nothing about the new one.
		s.on('close', () => {
			if (s === socket) fail('the volenet daemon closed the connection')
		})
		s.on('error', (e) => {
			if (s === socket) fail(e.message)
		})
	}
	wire(socket)

	/** Get a working line, opening a new one if the last is gone. */
	const ready = async (): Promise<void> => {
		if (live && !socket.destroyed) return
		if (!dir) throw new Error('the volenet daemon is not running')
		const fresh = (await connect(dir)) ?? (await spawnDaemon(dir))
		if (!fresh) throw new Error('could not reach or start the volenet daemon')
		socket = fresh
		live = true
		wire(socket)
	}

	const call = async (method: string, ...args: unknown[]) => {
		await ready()
		return new Promise<unknown>((resolve, reject) => {
			const id = next++
			pending.set(id, { resolve, reject })
			// A write that cannot go out must reject rather than wait for an answer that is not
			// coming — this is the shape the hang took.
			socket.write(`${JSON.stringify({ id, method, args })}\n`, (err) => {
				if (!err) return
				pending.delete(id)
				reject(err)
			})
		})
	}

	return Object.fromEntries(
		NET_METHODS.map((m) => [m, (...args: unknown[]) => call(m, ...args)]),
	) as unknown as NetLike
}

/** Connect to a daemon already listening, or null when none is. */
export async function connect(dir: string): Promise<net.Socket | null> {
	return new Promise((resolve) => {
		const conn = net.createConnection(socketPath(dir))
		const give = (ok: boolean) => {
			conn.removeAllListeners('connect')
			conn.removeAllListeners('error')
			if (ok) resolve(conn)
			else {
				conn.destroy()
				resolve(null)
			}
		}
		conn.once('connect', () => give(true))
		conn.once('error', () => give(false))
	})
}

/**
 * Start a daemon for this identity and wait for it to answer.
 *
 * Detached and with its streams released, so it outlives the session that happened to start it —
 * which is the entire point: being reachable is not supposed to depend on an editor being open.
 */
export async function spawnDaemon(
	dir: string,
	env: NodeJS.ProcessEnv = {},
): Promise<net.Socket | null> {
	const entry = process.argv[1]
	if (!entry) return null
	const child = spawn(process.execPath, [entry, 'daemon'], {
		detached: true,
		stdio: 'ignore',
		env: { ...process.env, ...env, VOLENET_MCP_DIR: dir },
	})
	child.unref()

	// Poll briefly rather than guess a fixed delay: it is listening when it answers.
	for (let i = 0; i < 40; i++) {
		const conn = await connect(dir)
		if (conn) return conn
		await new Promise((r) => setTimeout(r, 100))
	}
	return null
}
