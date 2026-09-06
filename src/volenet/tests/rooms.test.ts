import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager, createEventBus, generateKeyPair } from '../src/index.js'
import { MAX_ROOM_MEMBERS, RoomStore } from '../src/rooms.js'

/**
 * Rooms: many-to-many across a hub that reads nothing (PROTOCOL.md §7c).
 *
 * A post is sealed once per member, so a room is not a new delivery path — it is the existing
 * private one, run N times. What these check is that membership is the hub's business, that the
 * fan-out actually reaches everyone, and that removing somebody stops them reading by
 * construction rather than by anyone remembering to rotate a key.
 */

const HUB = 19871
const A = 19872
const B = 19873

let hub: VoleNetManager
let a: VoleNetManager
let b: VoleNetManager
let idA: string
let idB: string
let roomId: string
const arrivedAtB: Array<{ text: string; room?: string }> = []

const until = async (cond: () => boolean, ms = 20000) => {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error('timed out')
		await new Promise((r) => setTimeout(r, 100))
	}
}

beforeAll(async () => {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-rooms-'))
	const roots = { hub: path.join(base, 'hub'), a: path.join(base, 'a'), b: path.join(base, 'b') }
	const keys: Record<string, string> = {}
	for (const [who, root] of Object.entries(roots)) {
		await fs.mkdir(path.join(root, '.openvole/net'), { recursive: true })
		keys[who] = (await generateKeyPair(path.join(root, '.openvole/net'), who)).publicKeyString
	}
	idA = (await import('../src/index.js')).parsePublicKey(keys.a)!.instanceId
	idB = (await import('../src/index.js')).parsePublicKey(keys.b)!.instanceId

	// Everyone trusts the hub and the hub trusts everyone: a room is about membership, not trust.
	await fs.writeFile(
		path.join(roots.hub, '.openvole/net/authorized_voles'),
		`${keys.a}\n${keys.b}\n`,
	)
	await fs.writeFile(
		path.join(roots.a, '.openvole/net/authorized_voles'),
		`${keys.hub}\n${keys.b}\n`,
	)
	await fs.writeFile(
		path.join(roots.b, '.openvole/net/authorized_voles'),
		`${keys.hub}\n${keys.a}\n`,
	)

	hub = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'hub',
			role: 'peer',
			port: HUB,
			hostname: '127.0.0.1',
			relay: { enabled: true, acceptFrom: '*' },
		},
		roots.hub,
	)
	await hub.start()

	const peers = [{ url: `http://127.0.0.1:${HUB}`, trust: 'read' as const }]
	a = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'a',
			role: 'peer',
			port: A,
			hostname: '127.0.0.1',
			peers,
			relay: { enabled: false, acceptFrom: '*' },
		},
		roots.a,
	)
	const busB = createEventBus()
	busB.on('volenet:chat', (d) => {
		const m = d as { text: string; room?: string }
		arrivedAtB.push({ text: m.text, room: m.room })
	})
	b = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'b',
			role: 'peer',
			port: B,
			hostname: '127.0.0.1',
			peers,
			relay: { enabled: false, acceptFrom: '*' },
		},
		roots.b,
	)
	await a.start()
	await b.start(undefined, busB)
	await until(() => hub.getInstances().length >= 2)
}, 60000)

afterAll(async () => {
	await Promise.all([a?.stop(), b?.stop(), hub?.stop()])
})

describe('rooms', () => {
	it('is created and joined through the hub, which hands back the members’ keys', async () => {
		await a.roomCommand('hub', 'room:create', { name: 'the-room' })
		await until(() => a.getRooms().length > 0)
		roomId = a.getRooms()[0]!.room
		expect(a.getRooms()[0]?.name).toBe('the-room')

		await b.roomCommand('hub', 'room:join', { room: roomId })
		// Both sides learn the membership, with keys — a sender fans out itself, so ids alone
		// would be useless.
		await until(() => a.getRooms()[0]!.members.length === 2 && b.getRooms().length > 0)
		const members = a.getRooms()[0]!.members
		expect(members.map((m) => m.name).sort()).toEqual(['a', 'b'])
		expect(members.every((m) => m.publicKey.startsWith('vole-ed25519'))).toBe(true)
	}, 40000)

	it('delivers a post to every member, marked with the room', async () => {
		arrivedAtB.length = 0
		const res = await a.postToRoom(roomId, 'hello room')
		expect(res.ok).toBe(true)
		expect(res.sent).toBe(1) // one copy, sealed to b — not to itself

		await until(() => arrivedAtB.length > 0)
		expect(arrivedAtB[0]).toEqual({ text: 'hello room', room: roomId })
	}, 40000)

	it('stops a leaver reading by construction, with no key to rotate', async () => {
		await b.roomCommand('hub', 'room:leave', { room: roomId })
		await until(() => a.getRooms()[0]!.members.length === 1)

		arrivedAtB.length = 0
		const res = await a.postToRoom(roomId, 'after you left')
		expect(res.sent).toBe(0) // nobody left to seal to
		await new Promise((r) => setTimeout(r, 1000))
		expect(arrivedAtB).toEqual([]) // and nothing could have reached them
	}, 40000)

	it('refuses to post to a room this node is not in', async () => {
		const res = await b.postToRoom(roomId, 'not mine')
		expect(res.ok).toBe(false)
		expect(res.error).toContain('not in that room')
	})
})

describe('RoomStore', () => {
	it('enforces the ceiling rather than getting quietly slow', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-roomstore-'))
		const store = new RoomStore(path.join(dir, 'rooms.json'))
		await store.load()
		const room = await store.create('big', 'member-0')
		for (let i = 1; i < MAX_ROOM_MEMBERS; i++) {
			expect(typeof (await store.join(room.id, `member-${i}`))).not.toBe('string')
		}
		// The size where sealing per member stops making sense is the size it refuses at.
		expect(await store.join(room.id, 'one-too-many')).toBe('full')
	})

	it('survives a restart, because a restart should not dissolve every room', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-roomstore-'))
		const file = path.join(dir, 'rooms.json')
		const first = new RoomStore(file)
		await first.load()
		const room = await first.create('kept', 'me')

		const second = new RoomStore(file)
		await second.load()
		expect(second.get(room.id)?.name).toBe('kept')
		expect(second.forMember('me').map((r) => r.id)).toEqual([room.id])
		expect(await second.leave(room.id, 'nobody')).toBe('not-a-member')
		expect(await second.join('no-such-id', 'me')).toBe('no-such-room')
	})
})
