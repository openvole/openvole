/**
 * Everything the tools need from a node, as a flat surface.
 *
 * The tools used to reach into `VoleNetManager` directly, including through the objects it hands
 * back — `getTransport()?.getPeers()`, `getRemoteTaskManager().delegateTask()`. That is fine while
 * the node lives in the same process, and impossible once it does not: a socket cannot return a
 * transport. Flattening it to plain calls with plain values is what lets the same tools run
 * against a node here or a node in a daemon, which is what being *present* while no session is
 * open requires.
 */
import type { VoleNetManager } from '@openvole/volenet'

export interface PeerInfo {
	id: string
	name: string
	connected: boolean
}

export interface RelayMemberInfo {
	id: string
	name: string
	viaHubName: string
	connected: boolean
	accepted: boolean
	incoming: boolean
	awaiting: boolean
}

export interface PairRequestInfo {
	id: string
	name: string
	note?: string
	wants?: string[]
}

export interface PairGrantInput {
	trust?: 'full' | 'tool' | 'read'
	allowBrain?: boolean
}

export interface SendResult {
	ok: boolean
	delivered?: boolean
	relayed?: boolean
	error?: string
}

export interface AskResult {
	status: string
	result?: string
	error?: string
}

export interface Identity {
	instanceId: string
	publicKeyString: string
}

export interface RoomView {
	room: string
	name: string
	topic?: string
	members: Array<{ instanceId: string; name: string }>
}

/** A node, wherever it happens to be running. */
export interface NetLike {
	identity(): Promise<Identity | null>
	/** Peers this node holds a direct link with, and whether the socket is live. */
	instances(): Promise<PeerInfo[]>
	relayMembers(): Promise<RelayMemberInfo[]>
	sendChat(to: string, text: string): Promise<SendResult>
	askBrain(to: string, input: string, fromName: string, timeoutMs: number): Promise<AskResult>
	joinHub(
		url: string,
	): Promise<{ ok: boolean; pending?: boolean; hubName?: string; error?: string }>
	addPeer(url: string): Promise<void>
	forgetPeer(url: string): Promise<boolean>
	probePair(url: string): Promise<{
		ok: boolean
		name?: string
		fingerprint?: string
		publicKey?: string
		alreadyTrusted?: boolean
		error?: string
	}>
	initiatePair(
		url: string,
		publicKey: string,
		note?: string,
		wants?: string[],
	): Promise<{ ok: boolean; pending?: boolean; error?: string }>
	requestRelayConnect(
		ref: string,
		note?: string,
	): Promise<{ ok: boolean; queued?: boolean; error?: string }>
	approveRelayConnect(ref: string): Promise<{ ok: boolean; error?: string }>
	denyRelayConnect(ref: string): Promise<{ ok: boolean; error?: string }>
	/** Rooms this node is in, as its hub last described them (PROTOCOL.md §7c). */
	rooms(): Promise<RoomView[]>
	roomCommand(
		hub: string,
		type: 'room:create' | 'room:join' | 'room:leave' | 'room:invite' | 'room:list',
		payload: Record<string, unknown>,
	): Promise<{ ok: boolean; error?: string }>
	/** Post to a room: one sealed copy per member, so there is no key and no rotation. */
	postToRoom(
		room: string,
		text: string,
	): Promise<{ ok: boolean; sent: number; held: number; skipped: number; error?: string }>
	listPairRequests(): Promise<PairRequestInfo[]>
	acceptPair(ref: string, grant?: PairGrantInput): Promise<{ ok: boolean; error?: string }>
	denyPair(ref: string): Promise<{ ok: boolean }>
}

/** The same surface, backed by a manager in this process. */
export function localNet(m: VoleNetManager): NetLike {
	return {
		async identity() {
			const k = m.getKeyPair()
			return k ? { instanceId: k.instanceId, publicKeyString: k.publicKeyString } : null
		},
		async instances() {
			// Whether a direct link is live is the transport's business — an instance record
			// outlives the socket, so `lastSeen` alone would report a dead link as online.
			const live = new Set(
				(m.getTransport()?.getPeers() ?? []).filter((p) => p.connected).map((p) => p.peerId),
			)
			return m.getInstances().map((i) => ({ id: i.id, name: i.name, connected: live.has(i.id) }))
		},
		async relayMembers() {
			return m.getRelayMembers().map((r) => ({
				id: r.id,
				name: r.name,
				viaHubName: r.viaHubName,
				connected: r.connected,
				accepted: r.accepted,
				incoming: r.incoming,
				awaiting: r.awaiting,
			}))
		},
		sendChat: (to, text) => m.sendChat(to, text),
		async askBrain(to, input, fromName, timeoutMs) {
			const mgr = m.getRemoteTaskManager()
			if (!mgr) return { status: 'failed', error: 'remote task manager not available' }
			const r = await mgr.delegateTask(to, { taskId: '', input, fromName }, timeoutMs)
			return { status: r.status, result: r.result, error: r.error }
		},
		joinHub: (url) => m.initiateJoin(url),
		addPeer: (url) => m.addPeer(url),
		async forgetPeer(url) {
			return m.forgetPeer(url)
		},
		probePair: (url) => m.probePair(url),
		initiatePair: (url, publicKey, note, wants) =>
			m.initiatePair(url, publicKey, note, wants as 'brain'[] | undefined),
		requestRelayConnect: (ref, note) => m.requestRelayConnect(ref, note),
		approveRelayConnect: (ref) => m.approveRelayConnect(ref),
		denyRelayConnect: (ref) => m.denyRelayConnect(ref),
		async listPairRequests() {
			return m.listPairRequests().map((r) => ({
				id: r.id,
				name: r.name,
				note: r.note,
				wants: r.wants,
			}))
		},
		async rooms() {
			return m.getRooms().map((r) => ({
				room: r.room,
				name: r.name,
				topic: r.topic,
				members: r.members.map((x) => ({ instanceId: x.instanceId, name: x.name })),
			}))
		},
		roomCommand: (hub, type, payload) => m.roomCommand(hub, type, payload),
		postToRoom: (room, text) => m.postToRoom(room, text),
		acceptPair: (ref, grant) => m.acceptPair(ref, grant),
		denyPair: (ref) => m.denyPair(ref),
	}
}

/** The method names a remote node must answer — kept beside the interface so they cannot drift. */
export const NET_METHODS = [
	'identity',
	'instances',
	'relayMembers',
	'sendChat',
	'askBrain',
	'joinHub',
	'addPeer',
	'forgetPeer',
	'probePair',
	'initiatePair',
	'requestRelayConnect',
	'approveRelayConnect',
	'denyRelayConnect',
	'rooms',
	'roomCommand',
	'postToRoom',
	'listPairRequests',
	'acceptPair',
	'denyPair',
] as const satisfies ReadonlyArray<keyof NetLike>
