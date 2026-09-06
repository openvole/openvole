/**
 * What was said: one log, and a read cursor for each session reading it.
 *
 * An MCP server lives and dies with the editor session that spawned it, but a conversation does
 * not. VoleNet already makes an intermittent peer work — a sender holds what it could not deliver
 * and flushes when you reappear — so what was missing is somewhere to put what arrives that is
 * still there next time.
 *
 * The subtlety is that several editor sessions run at once, sharing one identity because pairing
 * once is the whole point of an identity. They must not share a *read* state: one session opening
 * its inbox would mark the messages seen and the next session would never hear about them. So the
 * messages are one append-only log, and being caught up is per session.
 *
 * Append-only also makes concurrency cheap. Two processes rewriting one JSON file lose each
 * other's writes; two processes appending a line each do not, and a cursor file has exactly one
 * writer. No locking, no daemon.
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

/** How many lines to keep. The oldest go when the log is next compacted. */
export const MAX_MESSAGES = 2000

export class Inbox {
	private messages: Message[] = []
	/** Per peer, the timestamp up to which *this* session has been shown its messages. */
	private readAt = new Map<string, number>()
	private writing: Promise<void> = Promise.resolve()

	/**
	 * @param dir   where the shared log and the cursors live
	 * @param session  which read state is ours. Sessions in different projects are different
	 *                 readers; the same project reopened is the same reader, so restarting does
	 *                 not replay everything already seen.
	 */
	constructor(
		private readonly dir: string,
		private readonly session = 'default',
	) {}

	private get log(): string {
		return path.join(this.dir, 'messages.jsonl')
	}

	private get cursor(): string {
		return path.join(this.dir, 'cursors', `${this.session}.json`)
	}

	async load(): Promise<void> {
		await this.adoptLegacy()
		this.messages = await readLog(this.log)
		try {
			const raw = JSON.parse(await fs.readFile(this.cursor, 'utf-8')) as Record<string, number>
			this.readAt = new Map(Object.entries(raw ?? {}))
		} catch {
			this.readAt = new Map()
		}
	}

	/** Re-read what other sessions have appended since we loaded. */
	async refresh(): Promise<void> {
		this.messages = await readLog(this.log)
	}

	/** Record a message. Returns false when this id was already recorded. */
	async add(m: Message): Promise<boolean> {
		await this.refresh()
		if (this.messages.some((x) => x.id === m.id)) return false
		this.messages.push(m)
		await this.append(m)
		return true
	}

	/** Everything with one peer, oldest first. */
	history(peerId: string, limit = 50): Message[] {
		return this.messages.filter((m) => m.peerId === peerId).slice(-limit)
	}

	/** Inbound messages this session has not been shown yet, oldest first. */
	unread(): Message[] {
		return this.messages.filter((m) => m.dir === 'in' && m.ts > (this.readAt.get(m.peerId) ?? 0))
	}

	/** Mark everything currently unread as seen — for this session, and nobody else. */
	async markRead(): Promise<void> {
		for (const m of this.unread()) {
			const at = this.readAt.get(m.peerId) ?? 0
			if (m.ts > at) this.readAt.set(m.peerId, m.ts)
		}
		await this.persistCursor()
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

	/** One line, one write — an append no other session can lose. */
	private append(m: Message): Promise<void> {
		this.writing = this.writing.then(async () => {
			await fs.mkdir(this.dir, { recursive: true })
			await fs.appendFile(this.log, `${JSON.stringify(m)}\n`, 'utf-8')
			if (this.messages.length > MAX_MESSAGES) await this.compact()
		})
		return this.writing
	}

	/** Rewrite the log with the newest MAX_MESSAGES. Rare, and atomic via rename. */
	private async compact(): Promise<void> {
		const keep = this.messages.slice(-MAX_MESSAGES)
		const tmp = `${this.log}.${process.pid}.tmp`
		await fs.writeFile(tmp, keep.map((m) => `${JSON.stringify(m)}\n`).join(''), 'utf-8')
		await fs.rename(tmp, this.log)
		this.messages = keep
	}

	private async persistCursor(): Promise<void> {
		await fs.mkdir(path.dirname(this.cursor), { recursive: true })
		const tmp = `${this.cursor}.tmp`
		await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(this.readAt), null, 2), 'utf-8')
		await fs.rename(tmp, this.cursor)
	}

	/**
	 * Carry over messages written before the log existed.
	 *
	 * Earlier versions kept one `inbox.json` holding both the messages and a single read state. The
	 * messages are still someone's; dropping them on upgrade would lose real conversations. The old
	 * read state is deliberately *not* carried over — it was one cursor for every session, so honouring
	 * it would mark messages seen for sessions that never saw them. Unread is the safe direction.
	 */
	private async adoptLegacy(): Promise<void> {
		const legacy = path.join(this.dir, 'inbox.json')
		try {
			await fs.access(this.log)
			return // the log exists; nothing to carry over
		} catch {
			// no log yet
		}
		let raw: { messages?: Message[] }
		try {
			raw = JSON.parse(await fs.readFile(legacy, 'utf-8')) as { messages?: Message[] }
		} catch {
			return
		}
		const messages = (raw.messages ?? []).filter(
			(m) => m && typeof m.peerId === 'string' && typeof m.text === 'string',
		)
		if (messages.length === 0) return
		await fs.mkdir(this.dir, { recursive: true })
		await fs.writeFile(this.log, messages.map((m) => `${JSON.stringify(m)}\n`).join(''), 'utf-8')
		await fs.rename(legacy, `${legacy}.migrated`)
	}
}

async function readLog(file: string): Promise<Message[]> {
	let body: string
	try {
		body = await fs.readFile(file, 'utf-8')
	} catch {
		return []
	}
	const out: Message[] = []
	for (const line of body.split('\n')) {
		if (!line.trim()) continue
		try {
			const m = JSON.parse(line) as Message
			if (m && typeof m.peerId === 'string' && typeof m.text === 'string') out.push(m)
		} catch {
			// A torn last line from a concurrent append: skip it, it will be read next time.
		}
	}
	return out
}
