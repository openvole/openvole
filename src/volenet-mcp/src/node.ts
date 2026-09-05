/**
 * The VoleNet node this server *is*.
 *
 * A Claude Code session gets its own identity on the mesh rather than borrowing an agent's: its
 * own keypair, its own name, its own consent decisions. That is the whole point — "my agent" and
 * "your agent" have to be different principals before anything between them means much.
 *
 * The node lives only while the editor session does, which VoleNet already handles: a sender holds
 * what it could not deliver and flushes when we reappear, and a hub hands us notices about who
 * tried while we were gone. So an intermittent peer is a supported peer, not a degraded one.
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { VoleNetManager, createMessageBus } from 'openvole'
import { Inbox } from './inbox.js'

export interface NodeOptions {
	/** What others see us as. Not identity — the key is. */
	name: string
	/** A hub to join, so we are reachable by people and agents that cannot dial us. */
	hub?: string
	/** Where the keypair, trust store and transcript live. */
	dir: string
	/** The port the node listens on, for peers that *can* dial us (same LAN, mostly). */
	port: number
}

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
	net: VoleNetManager
	inbox: Inbox
	/** Trust decisions waiting on the person, newest last. */
	requests: PendingRequest[]
	/** Who tried to reach us while we were away, as the hub reports on reconnect. */
	notices: Notice[]
	options: NodeOptions
	stop: () => Promise<void>
}

export function defaultDir(): string {
	return process.env.VOLENET_MCP_DIR?.trim() || path.join(os.homedir(), '.openvole', 'volenet-mcp')
}

export function optionsFromEnv(): NodeOptions {
	return {
		name: process.env.VOLENET_MCP_NAME?.trim() || `claude-${os.hostname().split('.')[0]}`,
		hub: process.env.VOLENET_MCP_HUB?.trim() || undefined,
		dir: defaultDir(),
		port: Number(process.env.VOLENET_MCP_PORT ?? 9750) || 9750,
	}
}

export async function startNode(options: NodeOptions): Promise<Node> {
	const bus = createMessageBus()
	const inbox = new Inbox(path.join(options.dir, 'inbox.json'))
	await inbox.load()

	const requests: PendingRequest[] = []
	const notices: Notice[] = []

	const net = new VoleNetManager(
		{
			enabled: true,
			instanceName: options.name,
			role: 'peer',
			port: options.port,
			keyPath: path.join(options.dir, 'net', 'vole_key'),
			// A hub is a peer we dial. 'read' rather than 'full': a hub carries our sealed traffic,
			// it has no business acting on this node.
			peers: options.hub ? [{ url: options.hub, trust: 'read' }] : [],
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
		void inbox.add({
			peerId: m.from,
			peerName: m.fromName,
			dir: 'in',
			text: m.text,
			ts: m.timestamp,
			id: m.messageId,
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

	await net.start(undefined, bus)

	return {
		net,
		inbox,
		requests,
		notices,
		options,
		stop: () => net.stop(),
	}
}
