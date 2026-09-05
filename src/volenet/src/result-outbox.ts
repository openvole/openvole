/**
 * Answers that could not be delivered because the peer had gone.
 *
 * A `task:delegate` runs our brain, which takes as long as a model takes. A peer that asked
 * from a phone may well be closed by the time the answer is ready — and unlike chat, nobody
 * else is holding a copy: the asker has the question, we have the only answer. Writing it to
 * a socket that is no longer there lost it outright, and the asker was left with a question
 * that never came back.
 *
 * So an undelivered answer waits here, on the machine that produced it, and goes out when
 * that peer next speaks to us. The payload is stored rather than the signed message, because
 * a message carries a timestamp and freshness is enforced on receipt: it is re-signed at
 * delivery, exactly as the chat outbox re-signs what it held.
 *
 * Bounded on purpose — a peer that never comes back must not grow a file forever.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** One answer waiting on the peer that asked for it. */
export interface PendingResult {
	/** Who asked. */
	peerId: string
	/** Their id for the task — what the answer must carry to be recognised. */
	taskId: string
	status: string
	result?: string
	error?: string
	/** When the answer was ready. */
	at: number
	attempts: number
}

export const DEFAULT_RESULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Ceiling per peer, oldest dropped first, so one absent asker cannot fill the disk. */
export const MAX_RESULTS_PER_PEER = 50

export class ResultOutbox {
	private entries: PendingResult[] = []

	constructor(
		private readonly file: string,
		private readonly ttlMs = DEFAULT_RESULT_TTL_MS,
	) {}

	async load(now = Date.now()): Promise<void> {
		try {
			const raw = JSON.parse(await fs.readFile(this.file, 'utf-8')) as unknown
			this.entries = Array.isArray(raw)
				? (raw as PendingResult[]).filter(
						(e) =>
							e &&
							typeof e.peerId === 'string' &&
							typeof e.taskId === 'string' &&
							typeof e.at === 'number',
					)
				: []
		} catch {
			this.entries = []
		}
		await this.sweep(now)
	}

	list(): PendingResult[] {
		return [...this.entries]
	}

	forPeer(peerId: string): PendingResult[] {
		return this.entries.filter((e) => e.peerId === peerId)
	}

	has(peerId: string): boolean {
		return this.entries.some((e) => e.peerId === peerId)
	}

	get size(): number {
		return this.entries.length
	}

	/** Hold an answer. Re-asking the same task replaces the old answer rather than stacking. */
	async add(entry: Omit<PendingResult, 'attempts'>): Promise<PendingResult> {
		this.entries = this.entries.filter(
			(e) => !(e.peerId === entry.peerId && e.taskId === entry.taskId),
		)
		const full: PendingResult = { ...entry, attempts: 0 }
		this.entries.push(full)
		const mine = this.entries.filter((e) => e.peerId === entry.peerId)
		if (mine.length > MAX_RESULTS_PER_PEER) {
			const drop = new Set(mine.slice(0, mine.length - MAX_RESULTS_PER_PEER))
			this.entries = this.entries.filter((e) => !drop.has(e))
		}
		await this.persist()
		return full
	}

	async remove(peerId: string, taskId: string): Promise<boolean> {
		const before = this.entries.length
		this.entries = this.entries.filter((e) => !(e.peerId === peerId && e.taskId === taskId))
		if (this.entries.length === before) return false
		await this.persist()
		return true
	}

	async noteAttempt(peerId: string, taskId: string): Promise<void> {
		const e = this.entries.find((x) => x.peerId === peerId && x.taskId === taskId)
		if (!e) return
		e.attempts++
		await this.persist()
	}

	/** Drop answers older than the TTL. Returns what was dropped so the owner can say so. */
	async sweep(now = Date.now()): Promise<PendingResult[]> {
		const expired = this.entries.filter((e) => now - e.at > this.ttlMs)
		if (expired.length === 0) return []
		this.entries = this.entries.filter((e) => now - e.at <= this.ttlMs)
		await this.persist()
		return expired
	}

	private async persist(): Promise<void> {
		await fs.mkdir(path.dirname(this.file), { recursive: true })
		await fs.writeFile(this.file, JSON.stringify(this.entries, null, 2), 'utf-8')
	}
}
