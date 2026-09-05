/**
 * Chat that could not be delivered because the other side was away.
 *
 * Two pieces, one on each end of a relay hub, and neither holds a readable message:
 *
 * - **ChatOutbox** (sender side): messages the hub could not forward wait *here*, on the
 *   sender's own machine, and go out when the recipient shows up in a roster again. The hub
 *   never stores them. That is deliberate rather than tidy: an envelope is sealed to the
 *   recipient's static keys with no ratchet, so ciphertext at rest anywhere but the endpoints
 *   is retroactively readable if that key is ever compromised. A notice carries nothing to
 *   decrypt.
 *
 * - **RelayNotices** (hub side): "somebody tried to reach you while you were away" — sender,
 *   count, first and last time. Routing metadata the hub already sees for every envelope it
 *   forwards, and nothing more. Handed to the member on reconnect and forgotten.
 *
 * Both persist as JSON under the node's net directory so a restart on either side loses
 * nothing: the sender's outbox because a phone gets closed and reopened, the hub's notices
 * because "the hub restarted" should not mean "you were never told".
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** What an outbox entry is. Consent traffic waits the same way chat does — a request that
 * vanished because the other side was away was the first thing a phone user noticed. */
export type OutboxKind = 'chat' | 'connect-request' | 'connect-accept' | 'connect-deny'

/** A message waiting on its recipient. `sentAt` is when it was written, which is what the recipient should see. */
export interface OutboxEntry {
	ref: string
	to: string
	toName: string
	text: string
	sentAt: number
	attempts: number
	lastError?: string
	/** Absent on entries written before consent traffic was held: chat. */
	kind?: OutboxKind
	/** connect-request only. */
	note?: string
}

/** What a hub tells a member on reconnect about one sender. */
export interface RelayNotice {
	from: string
	fromName: string
	count: number
	first: number
	last: number
}

export const DEFAULT_OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const DEFAULT_NOTICE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Ceiling on senders remembered per member, so a hub cannot be filled up with notices. */
export const MAX_NOTICE_SENDERS = 200

async function readJson<T>(file: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await fs.readFile(file, 'utf-8')) as T
	} catch {
		return fallback
	}
}

async function writeJson(file: string, value: unknown): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true })
	const tmp = `${file}.${process.pid}.tmp`
	await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8')
	await fs.rename(tmp, file)
}

export class ChatOutbox {
	private entries: OutboxEntry[] = []

	constructor(
		private readonly file: string,
		private readonly ttlMs = DEFAULT_OUTBOX_TTL_MS,
	) {}

	async load(now = Date.now()): Promise<void> {
		const raw = await readJson<unknown>(this.file, [])
		this.entries = Array.isArray(raw)
			? (raw as OutboxEntry[]).filter(
					(e) =>
						e &&
						typeof e.ref === 'string' &&
						typeof e.to === 'string' &&
						typeof e.text === 'string' &&
						typeof e.sentAt === 'number',
				)
			: []
		await this.sweep(now)
	}

	list(): OutboxEntry[] {
		return [...this.entries]
	}

	forPeer(to: string): OutboxEntry[] {
		return this.entries.filter((e) => e.to === to)
	}

	get size(): number {
		return this.entries.length
	}

	async add(entry: Omit<OutboxEntry, 'ref' | 'attempts'> & { ref?: string }): Promise<OutboxEntry> {
		const full: OutboxEntry = { ...entry, ref: entry.ref ?? crypto.randomUUID(), attempts: 0 }
		this.entries.push(full)
		await this.persist()
		return full
	}

	async remove(ref: string): Promise<boolean> {
		const before = this.entries.length
		this.entries = this.entries.filter((e) => e.ref !== ref)
		if (this.entries.length === before) return false
		await this.persist()
		return true
	}

	async noteAttempt(ref: string, error?: string): Promise<void> {
		const e = this.entries.find((x) => x.ref === ref)
		if (!e) return
		e.attempts++
		e.lastError = error
		await this.persist()
	}

	/** Drop entries older than the TTL. Returns what was dropped so the owner can say so. */
	async sweep(now = Date.now()): Promise<OutboxEntry[]> {
		const expired = this.entries.filter((e) => now - e.sentAt > this.ttlMs)
		if (expired.length === 0) return []
		this.entries = this.entries.filter((e) => now - e.sentAt <= this.ttlMs)
		await this.persist()
		return expired
	}

	private async persist(): Promise<void> {
		await writeJson(this.file, this.entries)
	}
}

export class RelayNotices {
	/** to → (from → notice) */
	private byMember = new Map<string, Map<string, RelayNotice>>()

	constructor(
		private readonly file: string,
		private readonly ttlMs = DEFAULT_NOTICE_TTL_MS,
	) {}

	async load(now = Date.now()): Promise<void> {
		const raw = await readJson<Record<string, RelayNotice[]>>(this.file, {})
		this.byMember = new Map()
		for (const [to, list] of Object.entries(raw ?? {})) {
			if (!Array.isArray(list)) continue
			const m = new Map<string, RelayNotice>()
			for (const n of list) {
				if (n && typeof n.from === 'string' && typeof n.last === 'number') m.set(n.from, n)
			}
			if (m.size) this.byMember.set(to, m)
		}
		await this.sweep(now)
	}

	/** Remember that `from` tried to reach `to` just now. */
	async record(to: string, from: string, fromName: string, now = Date.now()): Promise<void> {
		let m = this.byMember.get(to)
		if (!m) {
			m = new Map()
			this.byMember.set(to, m)
		}
		const existing = m.get(from)
		if (existing) {
			existing.count++
			existing.last = now
			existing.fromName = fromName || existing.fromName
		} else {
			if (m.size >= MAX_NOTICE_SENDERS) {
				// Evict the sender we heard from longest ago rather than refuse the newest.
				let oldest: [string, RelayNotice] | undefined
				for (const kv of m) if (!oldest || kv[1].last < oldest[1].last) oldest = kv
				if (oldest) m.delete(oldest[0])
			}
			m.set(from, { from, fromName, count: 1, first: now, last: now })
		}
		await this.persist()
	}

	/** Hand over everything waiting for `to`, and forget it. */
	async take(to: string, now = Date.now()): Promise<RelayNotice[]> {
		await this.sweep(now)
		const m = this.byMember.get(to)
		if (!m || m.size === 0) return []
		this.byMember.delete(to)
		await this.persist()
		return [...m.values()].sort((a, b) => b.last - a.last)
	}

	/** Put notices back that could not be handed over after all (the member dropped off again). */
	async restore(to: string, notices: RelayNotice[]): Promise<void> {
		if (notices.length === 0) return
		let m = this.byMember.get(to)
		if (!m) {
			m = new Map()
			this.byMember.set(to, m)
		}
		for (const n of notices) {
			const ex = m.get(n.from)
			if (ex) {
				ex.count += n.count
				ex.first = Math.min(ex.first, n.first)
				ex.last = Math.max(ex.last, n.last)
			} else m.set(n.from, { ...n })
		}
		await this.persist()
	}

	peek(to: string): RelayNotice[] {
		return [...(this.byMember.get(to)?.values() ?? [])]
	}

	/** Members with something waiting. */
	get size(): number {
		return this.byMember.size
	}

	async sweep(now = Date.now()): Promise<void> {
		let changed = false
		for (const [to, m] of this.byMember) {
			for (const [from, n] of m) {
				if (now - n.last > this.ttlMs) {
					m.delete(from)
					changed = true
				}
			}
			if (m.size === 0) this.byMember.delete(to)
		}
		if (changed) await this.persist()
	}

	private async persist(): Promise<void> {
		const out: Record<string, RelayNotice[]> = {}
		for (const [to, m] of this.byMember) out[to] = [...m.values()]
		await writeJson(this.file, out)
	}
}
