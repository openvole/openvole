/**
 * The node this server talks to — usually not in this process.
 *
 * A Claude Code session gets an identity on the mesh rather than borrowing an agent's: its own
 * keypair, its own consent decisions. But an identity that only exists while an editor is open is
 * offline most of the time, and two open editors would run two nodes on one identity and fight over
 * the hub socket. So the node lives in a daemon — one per identity, started on demand, outliving
 * every session — and sessions attach to it.
 *
 * Reading does not go through the daemon. Messages are an append-only file, so a session reads them
 * directly and keeps its own cursor; only *acting* needs the node. That keeps the protocol small
 * and means a session can still show you your history if the daemon is somehow gone.
 */
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import {
	VoleNetManager,
	createEventBus,
	loadAuthorizedVoles,
	parsePublicKey,
} from '@openvole/volenet'
import { type Settings, loadStored, rememberPeer, resolveSettings } from './config.js'
import { connect, remoteNet, serve, spawnDaemon } from './daemon.js'
import { Inbox, type Message } from './inbox.js'
import { type NetLike, localNet } from './net-api.js'
import { type Notifier, notifier, preview } from './notify.js'

/** What a node needs to start. Resolved from stored settings, env and defaults. */
export type NodeOptions = Settings

export { resolveSettings }

export interface PendingRequest {
	kind: 'pair' | 'relay'
	from: string
	fromName: string
	note?: string
	at: number
}

export interface Notice {
	from: string
	fromName: string
	count: number
	last: number
}

export interface Node {
	net: NetLike
	inbox: Inbox
	/** Trust decisions waiting on the person, newest last. */
	requests: PendingRequest[]
	/** Who tried to reach us while we were away, as the hub reports on reconnect. */
	notices: Notice[]
	options: NodeOptions
	/** What happened when the node last tried to join the configured hub. */
	hubStatus: string
	/**
	 * Whether the client will run a model when the server asks — MCP's `sampling` capability. Set
	 * once the client has connected. Claude Code does not offer it; a channel notification is what
	 * gets an arriving message in front of the model there.
	 */
	canSample: boolean
	/** Where this node is running, which decides whether it is there when nothing is open. */
	where: 'daemon' | 'in-process'
	/** Be told when a message lands, so a session can wait for a reply rather than poll for one. */
	onMessage: (fn: (m: Message) => void) => () => void
	stop: () => Promise<void>
}

/**
 * Attach to this identity's daemon, starting one if none is running.
 *
 * Falls back to a node in this process when a daemon cannot be had — a sandbox that forbids
 * spawning, say. Everything still works; it is simply only present while this session is.
 */
export async function startNode(options: NodeOptions): Promise<Node> {
	const inbox = new Inbox(options.dir, options.session)
	await inbox.load()

	if (process.env.VOLENET_MCP_NO_DAEMON !== '1') {
		const conn = (await connect(options.dir)) ?? (await spawnDaemon(options.dir))
		if (conn) {
			return {
				net: remoteNet(conn),
				inbox,
				requests: [],
				notices: [],
				options,
				hubStatus: options.hub ? `joined ${options.hub}` : 'no hub configured',
				canSample: false,
				where: 'daemon',
				onMessage: watchLog(options.dir, inbox),
				stop: async () => {
					// The daemon is shared and stays; only this connection to it goes.
					conn.destroy()
				},
			}
		}
	}

	const local = await startLocal(options, inbox)
	return { ...local, where: 'in-process' }
}

/** A node in this process — what the daemon itself runs, and the fallback when it cannot. */
export async function startLocal(
	options: NodeOptions,
	inbox: Inbox,
	/** Told when a message lands. Only the daemon passes one — it is the thing always running. */
	notify?: Notifier,
): Promise<Omit<Node, 'where'>> {
	const bus = createEventBus()
	const requests: PendingRequest[] = []
	const notices: Notice[] = []
	const listeners = new Set<(m: Message) => void>()

	const port = (await isFree(options.port)) ? options.port : 0
	// Everything this identity has been told to dial: the hub, and every node it has paired with.
	// Pairing records the address here so a restart reconnects instead of quietly going dark.
	const stored = await loadStored(options.dir)
	const dial = [
		...(options.hub ? [options.hub] : []),
		...(stored.peers ?? []).filter((u) => u !== options.hub),
	]
	const manager = new VoleNetManager(
		{
			enabled: true,
			instanceName: options.name,
			role: 'peer',
			port,
			keyPath: path.join(options.dir, 'net', 'vole_key'),
			// 'read' rather than 'full': these carry our traffic and answer our questions, they
			// have no business acting on this node.
			peers: dial.map((url) => ({ url, trust: 'read' as const })),
			// Pairing learns an address at runtime; without this it is forgotten on exit.
			persistPeer: (url) => rememberPeer(options.dir, url),
		},
		options.dir,
	)

	bus.on('volenet:chat', (d) => {
		const m = d as {
			from: string
			fromName: string
			text: string
			messageId: string
			timestamp: number
		}
		const message: Message = {
			peerId: m.from,
			peerName: m.fromName,
			dir: 'in',
			text: m.text,
			ts: m.timestamp,
			id: m.messageId,
		}
		// Only a message we had not already recorded wakes a waiter, so a replay cannot.
		void inbox.add(message).then((added) => {
			if (!added) return
			for (const fn of listeners) fn(message)
			// Nothing can wake a session, so tell the person instead. Reading it is their move.
			notify?.(`${message.peerName} on VoleNet`, preview(message.text))
		})
	})

	bus.on('volenet:chat:pending', (d) => {
		const p = d as { from: Array<{ from: string; fromName: string; count: number; last: number }> }
		for (const n of p.from ?? []) {
			const at = notices.findIndex((x) => x.from === n.from)
			if (at >= 0) notices[at] = n
			else notices.push(n)
		}
	})

	const remember = (kind: 'pair' | 'relay') => (d: unknown) => {
		const r = d as { from: string; fromName: string; note?: string }
		if (requests.some((x) => x.from === r.from && x.kind === kind)) return
		requests.push({ kind, from: r.from, fromName: r.fromName, note: r.note, at: Date.now() })
	}
	bus.on('volenet:pair:request', remember('pair'))
	bus.on('volenet:relay:request', remember('relay'))

	await manager.start(undefined, bus)
	const bound = manager.getTransport()?.getPort?.() ?? port
	const settings: NodeOptions = { ...options, port: bound || options.port }

	// Dialling a hub we have never met gets a 401: it has no reason to trust this key yet. The
	// join flow is the introduction, and it hands back the hub's own key to pin.
	let hubStatus = 'no hub configured'
	if (options.hub) {
		hubStatus = (await alreadyTrusts(options.dir, options.hub))
			? `joined ${options.hub}`
			: await join(manager, options.hub)
	}

	return {
		net: localNet(manager),
		inbox,
		requests,
		notices,
		options: settings,
		hubStatus,
		canSample: false,
		onMessage: (fn) => {
			listeners.add(fn)
			return () => listeners.delete(fn)
		},
		stop: () => manager.stop(),
	}
}

/** Run as the daemon: a node in this process, served over the socket, until stopped. */
export async function runDaemon(options: NodeOptions): Promise<void> {
	const inbox = new Inbox(options.dir, 'daemon')
	await inbox.load()
	const node = await startLocal(options, inbox, notifier())

	// The daemon outlives any one session, but not all of them.
	//
	// It used to run for ever, so an identity stayed online long after the last editor closed —
	// and a peer looking at the roster saw somebody there to talk to when there was nobody. That
	// is a worse lie than being offline: a sender holds what it cannot deliver and flushes it when
	// you are back, so going away costs nothing and pretending to be present costs a reply.
	//
	// The linger is for restarts. Quitting and reopening, or reloading plugins, drops the socket
	// for a few seconds; leaving on the first empty moment would mean a new node, a new port and a
	// fresh dial-out every time.
	const linger = lingerMs()
	let leaving: ReturnType<typeof setTimeout> | undefined
	const leave = (after: number) => {
		if (linger === null) return // asked to stay
		clearTimeout(leaving)
		leaving = setTimeout(() => {
			void node.stop().finally(() => process.exit(0))
		}, after)
	}

	await serve(options.dir, node.net, {
		onBusy: () => clearTimeout(leaving),
		onIdle: () => leave(linger ?? 0),
	})
	// Nobody has attached yet. A daemon spawned for a session that then failed to reach it would
	// otherwise sit here for ever, so give it a generous window and then go.
	leave(STARTUP_GRACE_MS)
	await new Promise(() => undefined)
}

/** How long to wait for the first session before concluding nobody is coming. */
const STARTUP_GRACE_MS = 60_000

/** The default pause between the last session leaving and the daemon following it. */
const DEFAULT_LINGER_MS = 20_000

/**
 * How long to stay after the last session goes, or null to stay indefinitely.
 *
 * `VOLENET_MCP_LINGER` is seconds; `forever` keeps the old always-on behaviour, which is what you
 * want on a machine whose whole job is to be reachable.
 */
export function lingerMs(value = process.env.VOLENET_MCP_LINGER?.trim()): number | null {
	if (!value) return DEFAULT_LINGER_MS
	if (value === 'forever') return null
	const seconds = Number(value)
	return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_LINGER_MS
}

/**
 * Notice messages the daemon appended.
 *
 * The daemon receives them, so a session cannot be told directly — but the log is a file, and a
 * file can be watched. Cheap, and it works no matter which process did the writing.
 */
function watchLog(dir: string, inbox: Inbox): (fn: (m: Message) => void) => () => void {
	return (fn) => {
		const file = path.join(dir, 'messages.jsonl')
		const seen = new Set(inbox.history('', 0).map((m) => m.id))
		let closed = false
		const check = async () => {
			if (closed) return
			const before = new Set(inbox.unread().map((m) => m.id))
			await inbox.refresh()
			for (const m of inbox.unread()) {
				if (!before.has(m.id) && !seen.has(m.id)) {
					seen.add(m.id)
					fn(m)
				}
			}
		}
		let watcher: fsSync.FSWatcher | undefined
		try {
			watcher = fsSync.watch(path.dirname(file), (_e, name) => {
				if (name === 'messages.jsonl') void check()
			})
		} catch {
			// no watcher available; the poll below still gets there
		}
		const timer = setInterval(() => void check(), 1000)
		return () => {
			closed = true
			clearInterval(timer)
			watcher?.close()
		}
	}
}

async function join(node: VoleNetManager, hub: string): Promise<string> {
	const res = await node.initiateJoin(hub)
	if (!res.ok) return `could not join ${hub}: ${res.error}`
	if (res.pending) return `waiting for approval at ${hub}`
	return `joined ${res.hubName ?? hub}`
}

/**
 * Whether the hub at this URL is already trusted, so a restart does not re-join every time.
 * It asks who the hub says it is, then looks that id up in what we already trust.
 */
export async function alreadyTrusts(dir: string, hub: string): Promise<boolean> {
	try {
		const r = await fetch(`${hub.replace(/\/$/, '')}/volenet/info`, {
			signal: AbortSignal.timeout(8000),
		})
		const info = (await r.json()) as { publicKey?: string }
		const parsed = info.publicKey ? parsePublicKey(info.publicKey) : null
		if (!parsed) return false
		return (await loadAuthorizedVoles(path.join(dir, 'net'))).has(parsed.instanceId)
	} catch {
		return false
	}
}

/**
 * Whether anything is already listening on a port.
 *
 * A node serves the VoleNet endpoints so peers can dial *in*, which for a session behind NAT
 * essentially never happens — it dials out, to a hub or an agent. So a taken port is not worth
 * failing over.
 */
async function isFree(port: number): Promise<boolean> {
	const netmod = await import('node:net')
	return new Promise((resolve) => {
		const probe = netmod
			.createServer()
			.once('error', () => resolve(false))
			.once('listening', () => probe.close(() => resolve(true)))
			.listen(port, '0.0.0.0')
	})
}
