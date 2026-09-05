/**
 * What was said, kept across sessions.
 *
 * An MCP server lives and dies with the editor session that spawned it, but a conversation does
 * not. VoleNet already makes an intermittent peer work — a sender holds what it could not deliver
 * and flushes when you reappear, and a hub hands you notices about who tried — so the only thing
 * missing is somewhere to put what arrives, that is still there next time.
 *
 * A flat log rather than a per-peer file: the useful question is almost always "what came in while
 * I was gone", across everyone, and that is one scan rather than a directory walk.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface Message {
	/** The peer this is with — the sender for 'in', the recipient for 'out'. */
	peerId: string
	peerName: string
	dir: 'in' | 'out'
	text: string
	/** Milliseconds since the epoch, from the signed message for 'in'. */
	ts: number
	/** The signed message id, so a replay or a double-flush cannot duplicate a line. */
	id: string
}

/** Kept small enough to hold in memory and cheap to rewrite; the oldest go first. */
export const MAX_MESSAGES = 2000

export class Inbox {
	private messages: Message[] = []
	/** Per peer, the timestamp up to which the session has been shown its messages. */
	private readAt = new Map<string, number>()
	private writing: Promise<void> = Promise.resolve()

	constructor(private readonly file: string) {}

	async load(): Promise<void> {
		try {
			const raw = JSON.parse(await fs.readFile(this.file, 'utf-8')) as {
				messages?: Message[]
				readAt?: Record<string, number>
			}
			this.messages = (raw.messages ?? []).filter(
				(m) => m && typeof m.peerId === 'string' && typeof m.text === 'string',
			)
			this.readAt = new Map(Object.entries(raw.readAt ?? {}))
		} catch {
			this.messages = []
			this.readAt = new Map()
		}
	}

	/** Record a message. Returns false when this id was already recorded. */
	async add(m: Message): Promise<boolean> {
		if (this.messages.some((x) => x.id === m.id)) return false
		this.messages.push(m)
		if (this.messages.length > MAX_MESSAGES) {
			this.messages.splice(0, this.messages.length - MAX_MESSAGES)
		}
		await this.persist()
		return true
	}

	/** Everything with one peer, oldest first. */
	history(peerId: string, limit = 50): Message[] {
		return this.messages.filter((m) => m.peerId === peerId).slice(-limit)
	}

	/** Inbound messages the session has not been shown yet, oldest first. */
	unread(): Message[] {
		return this.messages.filter((m) => m.dir === 'in' && m.ts > (this.readAt.get(m.peerId) ?? 0))
	}

	/** Mark everything currently unread as seen. */
	async markRead(): Promise<void> {
		for (const m of this.unread()) {
			const at = this.readAt.get(m.peerId) ?? 0
			if (m.ts > at) this.readAt.set(m.peerId, m.ts)
		}
		await this.persist()
	}

	/** Every peer we have said anything to or heard anything from, most recent first. */
	peers(): Array<{ peerId: string; peerName: string; last: number; unread: number }> {
		const by = new Map<string, { peerId: string; peerName: string; last: number; unread: number }>()
		for (const m of this.messages) {
			const e = by.get(m.peerId) ?? { peerId: m.peerId, peerName: m.peerName, last: 0, unread: 0 }
			if (m.peerName) e.peerName = m.peerName
			e.last = Math.max(e.last, m.ts)
			if (m.dir === 'in' && m.ts > (this.readAt.get(m.peerId) ?? 0)) e.unread++
			by.set(m.peerId, e)
		}
		return [...by.values()].sort((a, b) => b.last - a.last)
	}

	get size(): number {
		return this.messages.length
	}

	/** Serialised: two messages arriving together must not race each other's rewrite. */
	private persist(): Promise<void> {
		this.writing = this.writing.then(async () => {
			const body = JSON.stringify(
				{ messages: this.messages, readAt: Object.fromEntries(this.readAt) },
				null,
				2,
			)
			await fs.mkdir(path.dirname(this.file), { recursive: true })
			const tmp = `${this.file}.tmp`
			await fs.writeFile(tmp, body, 'utf-8')
			await fs.rename(tmp, this.file)
		})
		return this.writing
	}
}
