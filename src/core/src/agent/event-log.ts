/**
 * Daily event log — every bus event the control plane broadcasts, written to disk in full.
 *
 * The dashboard's Live Events feed is a 500-line DOM buffer that clips each payload to one
 * line: it shows what is happening *now* and forgets it. So the interesting cases are exactly
 * the ones you cannot review — a tool result from four hours ago, the full error a task failed
 * with, what the agent did overnight.
 *
 * This is the durable copy: one JSON object per line (JSONL), the payload written whole with no
 * clipping, one file per local day so an overnight run stays inside one file and old days can be
 * read or removed independently.
 */

import { createWriteStream } from 'node:fs'
import type { WriteStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createLogger } from '../core/logger.js'

const logger = createLogger('event-log')

/** `events-YYYY-MM-DD.jsonl` */
const FILE_PREFIX = 'events-'
const FILE_SUFFIX = '.jsonl'
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Days of history kept. 0 disables pruning entirely. Override with VOLE_EVENT_LOG_DAYS. */
const DEFAULT_RETENTION_DAYS = 30

export interface EventLogEntry {
	/** Epoch ms. */
	ts: number
	/** Local ISO timestamp — readable when grepping the file directly. */
	time: string
	/** Which agent the event came from (absent in single-engine mode). */
	agentId?: string
	event: string
	data?: unknown
}

/** Local (not UTC) day key, so a file boundary matches the operator's midnight. */
export function dayKey(d: Date): string {
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}-${m}-${day}`
}

/** Local time as `YYYY-MM-DD HH:MM:SS.mmm` — sorts correctly and needs no timezone math to read. */
function localStamp(d: Date): string {
	const pad = (n: number, w = 2) => String(n).padStart(w, '0')
	return (
		`${dayKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
		`.${pad(d.getMilliseconds(), 3)}`
	)
}

export class EventLog {
	private readonly dir: string
	private readonly retentionDays: number
	private stream: WriteStream | undefined
	private streamDay: string | undefined
	/** Appends are serialized through this chain so lines never interleave. */
	private chain: Promise<void> = Promise.resolve()
	private closed = false

	constructor(dir: string, opts?: { retentionDays?: number }) {
		this.dir = dir
		const fromEnv = Number(process.env.VOLE_EVENT_LOG_DAYS)
		this.retentionDays =
			opts?.retentionDays ??
			(Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : DEFAULT_RETENTION_DAYS)
	}

	/** Absolute path of a day's log file. */
	fileFor(day: string): string {
		return path.join(this.dir, `${FILE_PREFIX}${day}${FILE_SUFFIX}`)
	}

	/**
	 * Record an event. Fire-and-forget by design: the control plane must never wait on disk to
	 * broadcast, and a full or read-only disk must degrade to "no history", never to a dead
	 * dashboard. Failures are logged once per rotation, not per event.
	 */
	append(event: string, data: unknown, agentId?: string): void {
		if (this.closed) return
		const now = new Date()
		const entry: EventLogEntry = {
			ts: now.getTime(),
			time: localStamp(now),
			...(agentId ? { agentId } : {}),
			event,
			data,
		}
		let line: string
		try {
			line = `${JSON.stringify(entry)}\n`
		} catch {
			// Circular or otherwise unserializable payload — keep the event, drop the data rather
			// than losing the line.
			line = `${JSON.stringify({ ...entry, data: '[unserializable]' })}\n`
		}
		this.chain = this.chain.then(() => this.write(now, line)).catch(() => {})
	}

	private async write(now: Date, line: string): Promise<void> {
		const day = dayKey(now)
		if (this.streamDay !== day) {
			await this.rotate(day)
		}
		const stream = this.stream
		if (!stream) return
		if (!stream.write(line)) {
			// Backpressure: wait for the buffer to drain before the next line so a burst of large
			// payloads can't grow the process heap without bound.
			await new Promise<void>((resolve) => stream.once('drain', resolve))
		}
	}

	private async rotate(day: string): Promise<void> {
		if (this.stream) {
			const old = this.stream
			this.stream = undefined
			await new Promise<void>((resolve) => old.end(resolve))
		}
		try {
			await fs.mkdir(this.dir, { recursive: true })
			const stream = createWriteStream(this.fileFor(day), { flags: 'a' })
			stream.on('error', (err) => {
				logger.warn(`Event log write failed (${day}): ${err.message}`)
			})
			this.stream = stream
			this.streamDay = day
			logger.info(`Event log → ${this.fileFor(day)}`)
			await this.prune()
		} catch (err) {
			// Remember the day anyway: without this every single event retries mkdir and floods the
			// log with the same failure.
			this.streamDay = day
			logger.warn(`Event log unavailable (${day}): ${err instanceof Error ? err.message : err}`)
		}
	}

	/** Days with a log file, newest first. */
	async listDays(): Promise<string[]> {
		try {
			const entries = await fs.readdir(this.dir)
			return entries
				.filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith(FILE_SUFFIX))
				.map((f) => f.slice(FILE_PREFIX.length, -FILE_SUFFIX.length))
				.filter((d) => DAY_RE.test(d))
				.sort()
				.reverse()
		} catch {
			return []
		}
	}

	/**
	 * Read a day's entries, newest first.
	 *
	 * `tail` bounds how many are parsed for the dashboard — the file itself is never truncated,
	 * and the raw download serves it whole. `dropped` reports what the bound left out so the UI
	 * can say so instead of silently implying it showed everything.
	 */
	async read(
		day: string,
		tail = 2000,
	): Promise<{ day: string; entries: EventLogEntry[]; total: number; dropped: number }> {
		if (!DAY_RE.test(day)) return { day, entries: [], total: 0, dropped: 0 }
		let raw: string
		try {
			raw = await fs.readFile(this.fileFor(day), 'utf-8')
		} catch {
			return { day, entries: [], total: 0, dropped: 0 }
		}
		const lines = raw.split('\n').filter((l) => l.trim().length > 0)
		const slice = tail > 0 ? lines.slice(-tail) : lines
		const entries: EventLogEntry[] = []
		for (const line of slice) {
			try {
				entries.push(JSON.parse(line) as EventLogEntry)
			} catch {
				// A torn last line (killed mid-write) — skip it rather than failing the whole read.
			}
		}
		entries.reverse()
		return { day, entries, total: lines.length, dropped: Math.max(0, lines.length - slice.length) }
	}

	/** Delete logs older than the retention window. */
	private async prune(): Promise<void> {
		if (this.retentionDays <= 0) return
		const cutoff = new Date()
		cutoff.setDate(cutoff.getDate() - this.retentionDays)
		const cutoffKey = dayKey(cutoff)
		for (const day of await this.listDays()) {
			if (day < cutoffKey) {
				await fs.unlink(this.fileFor(day)).catch(() => {})
				logger.info(`Event log pruned: ${day} (older than ${this.retentionDays} days)`)
			}
		}
	}

	/** Flush and close the current file. */
	async close(): Promise<void> {
		this.closed = true
		await this.chain.catch(() => {})
		const stream = this.stream
		this.stream = undefined
		if (stream) await new Promise<void>((resolve) => stream.end(resolve))
	}
}
