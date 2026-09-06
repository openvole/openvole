/**
 * Rooms: many-to-many over a hub that still reads nothing (PROTOCOL.md §7c).
 *
 * A post is sealed once per member. There is no room key, which is the whole design: removing a
 * member takes effect by construction — you stop sealing to them — rather than by rotating a key
 * that a removed member could otherwise keep reading past. A shared key would not even avoid the
 * per-member work, since the key itself has to be sealed to each member on every rotation.
 *
 * The cost is bandwidth: N envelopes per post, each carrying the ML-KEM ciphertext. That suits a
 * room and not a broadcast channel, so a room has a member ceiling and says so, rather than
 * quietly getting slow at the size where the design stops making sense.
 *
 * The hub holds membership and a name. No posts, no history, no ciphertext.
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** The size past which sealing per member stops being sensible. Enforced by the hub at join. */
export const MAX_ROOM_MEMBERS = 64

/** How long a room with nobody in it is kept before the hub forgets it. */
export const EMPTY_ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface RoomRecord {
	id: string
	name: string
	topic?: string
	/** Instance ids. Keys are looked up from the hub's own directory when a room is described. */
	members: string[]
	createdAt: number
	/** When the room last had a member, so an abandoned one can be forgotten. */
	lastOccupied: number
}

/** A room as a member sees it: enough to fan out a post without asking anything further. */
export interface RoomMember {
	instanceId: string
	name: string
	publicKey: string
	xPublicKey?: string
	mlkemPublicKey?: string
}

export interface RoomInfo {
	room: string
	name: string
	topic?: string
	members: RoomMember[]
}

export type RoomError = 'full' | 'not-a-member' | 'no-such-room' | 'refused'

/** The hub's side: who is in what. Persisted, so a restart does not dissolve every room. */
export class RoomStore {
	private rooms = new Map<string, RoomRecord>()
	private writing: Promise<void> = Promise.resolve()

	constructor(private readonly file: string) {}

	async load(now = Date.now()): Promise<void> {
		try {
			const raw = JSON.parse(await fs.readFile(this.file, 'utf-8')) as RoomRecord[]
			for (const r of Array.isArray(raw) ? raw : []) {
				if (r?.id && typeof r.name === 'string' && Array.isArray(r.members)) {
					this.rooms.set(r.id, { ...r, lastOccupied: r.lastOccupied ?? now })
				}
			}
		} catch {
			// no rooms yet
		}
		await this.sweep(now)
	}

	get(id: string): RoomRecord | undefined {
		return this.rooms.get(id)
	}

	list(): RoomRecord[] {
		return [...this.rooms.values()]
	}

	/** Rooms this member belongs to. */
	forMember(instanceId: string): RoomRecord[] {
		return this.list().filter((r) => r.members.includes(instanceId))
	}

	async create(name: string, creator: string, topic?: string): Promise<RoomRecord> {
		const room: RoomRecord = {
			id: crypto.randomUUID(),
			name: name.slice(0, 64) || 'room',
			...(topic ? { topic: topic.slice(0, 200) } : {}),
			members: [creator],
			createdAt: Date.now(),
			lastOccupied: Date.now(),
		}
		this.rooms.set(room.id, room)
		await this.persist()
		return room
	}

	/** Add a member. The ceiling is the design's edge, so it is refused rather than stretched. */
	async join(id: string, instanceId: string): Promise<RoomRecord | RoomError> {
		const room = this.rooms.get(id)
		if (!room) return 'no-such-room'
		if (room.members.includes(instanceId)) return room
		if (room.members.length >= MAX_ROOM_MEMBERS) return 'full'
		room.members.push(instanceId)
		room.lastOccupied = Date.now()
		await this.persist()
		return room
	}

	async leave(id: string, instanceId: string): Promise<RoomRecord | RoomError> {
		const room = this.rooms.get(id)
		if (!room) return 'no-such-room'
		if (!room.members.includes(instanceId)) return 'not-a-member'
		room.members = room.members.filter((m) => m !== instanceId)
		if (room.members.length > 0) room.lastOccupied = Date.now()
		await this.persist()
		return room
	}

	/** Drop rooms nobody has been in for the TTL. */
	async sweep(now = Date.now()): Promise<RoomRecord[]> {
		const gone = this.list().filter(
			(r) => r.members.length === 0 && now - r.lastOccupied > EMPTY_ROOM_TTL_MS,
		)
		if (gone.length === 0) return []
		for (const r of gone) this.rooms.delete(r.id)
		await this.persist()
		return gone
	}

	private persist(): Promise<void> {
		this.writing = this.writing.then(async () => {
			await fs.mkdir(path.dirname(this.file), { recursive: true })
			const tmp = `${this.file}.tmp`
			await fs.writeFile(tmp, JSON.stringify(this.list(), null, 2), 'utf-8')
			await fs.rename(tmp, this.file)
		})
		return this.writing
	}
}
