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
import * as path from 'node:path'
import {
	VoleNetManager,
	createEventBus,
	loadAuthorizedVoles,
	parsePublicKey,
} from '@openvole/volenet'
import { type Settings, resolveSettings } from './config.js'
import { Inbox } from './inbox.js'

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
	net: VoleNetManager
	inbox: Inbox
	/** What happened when we tried to join the configured hub, for whoami to report honestly. */
	hubStatus: string
	/** Trust decisions waiting on the person, newest last. */
	requests: PendingRequest[]
	/** Who tried to reach us while we were away, as the hub reports on reconnect. */
	notices: Notice[]
	options: NodeOptions
	stop: () => Promise<void>
}

export async function startNode(options: NodeOptions): Promise<Node> {
	const bus = createEventBus()
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

	// Dialling a hub we have never met gets a 401: it has no reason to trust this key yet. The
	// join flow is what introduces us, and it hands back the hub's own key to pin — the half that
	// matters, since from then on only that key may sign hub traffic to us.
	let hubStatus = 'no hub configured'
	if (options.hub) {
		hubStatus = (await alreadyTrusts(options.dir, options.hub))
			? `joined ${options.hub}`
			: await join(net, options.hub)
	}

	return {
		net,
		inbox,
		requests,
		notices,
		options,
		hubStatus,
		stop: () => net.stop(),
	}
}

async function join(net: VoleNetManager, hub: string): Promise<string> {
	const res = await net.initiateJoin(hub)
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
