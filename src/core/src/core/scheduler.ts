import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Cron } from 'croner'
import { createLogger } from './logger.js'

const logger = createLogger('scheduler')

interface ScheduleEntry {
	id: string
	input: string
	/** Cron expression (e.g. "0 13 * * *" for daily at 1 PM UTC) */
	cron: string
	job: Cron
	createdAt: number
}

/** Persisted schedule data (no job handle) */
interface PersistedSchedule {
	id: string
	input: string
	cron: string
	createdAt: number
}

/** Persistent store for recurring schedules using cron expressions */
export class SchedulerStore {
	private schedules = new Map<string, ScheduleEntry>()
	private savePath: string | undefined
	private tickHandler: ((input: string) => void) | undefined
	private writeChain: Promise<void> = Promise.resolve()
	private restoring = false

	/** Set the file path for persistence */
	setPersistence(filePath: string): void {
		this.savePath = filePath
	}

	/** Set the handler called when a schedule ticks */
	setTickHandler(handler: (input: string) => void): void {
		this.tickHandler = handler
	}

	/** Load schedule data from disk without starting cron jobs (for read-only access). Never persists. */
	async loadFromDisk(): Promise<void> {
		if (!this.savePath) return
		const savedPath = this.savePath
		// Temporarily disable persistence so read-only access can't overwrite the file
		this.savePath = undefined
		try {
			const raw = await fs.readFile(savedPath, 'utf-8')
			const persisted = JSON.parse(raw) as PersistedSchedule[]
			for (const s of persisted) {
				const job = new Cron(s.cron, { timezone: 'UTC', paused: true }, () => {})
				this.schedules.set(s.id, {
					id: s.id,
					input: s.input,
					cron: s.cron,
					job,
					createdAt: s.createdAt,
				})
			}
		} catch {
			// No file or invalid
		}
		this.savePath = savedPath
	}

	/** Load persisted schedules from disk and restart their jobs */
	async restore(): Promise<void> {
		if (!this.savePath || !this.tickHandler) return

		try {
			const raw = await fs.readFile(this.savePath, 'utf-8')
			const persisted = JSON.parse(raw) as PersistedSchedule[]

			// Skip persistence during restore — we're loading existing data, not creating new
			this.restoring = true
			for (const s of persisted) {
				this.add(
					s.id,
					s.input,
					s.cron,
					() => {
						this.tickHandler!(s.input)
					},
					s.createdAt,
				)
			}
			this.restoring = false

			if (persisted.length > 0) {
				logger.info(`Restored ${persisted.length} schedule(s) from disk`)
			}
		} catch (err) {
			this.restoring = false
			logger.warn(`Could not restore schedules: ${err}`)
		}
	}

	/** Create or replace a recurring schedule */
	add(
		id: string,
		input: string,
		cron: string,
		onTick: () => void,
		createdAt?: number,
		immediate = false,
	): void {
		// Cancel existing schedule with same ID (idempotent upsert)
		if (this.schedules.has(id)) {
			this.cancel(id, true)
		}

		if (immediate) {
			setTimeout(onTick, 0)
		}

		const job = new Cron(cron, { timezone: 'UTC' }, onTick)

		this.schedules.set(id, {
			id,
			input,
			cron,
			job,
			createdAt: createdAt ?? Date.now(),
		})

		const next = job.nextRun()
		logger.info(
			`Schedule "${id}" created — cron: ${cron} (next: ${next?.toISOString() ?? 'unknown'}): "${input.substring(0, 80)}"`,
		)
		this.persist()
	}

	/** Cancel a schedule by ID */
	cancel(id: string, skipPersist = false): boolean {
		const entry = this.schedules.get(id)
		if (!entry) return false

		entry.job.stop()
		this.schedules.delete(id)
		logger.info(`Schedule "${id}" cancelled`)
		if (!skipPersist) this.persist()
		return true
	}

	/** List all active schedules */
	list(): Array<{ id: string; input: string; cron: string; nextRun?: string; createdAt: number }> {
		return Array.from(this.schedules.values()).map(({ id, input, cron, job, createdAt }) => ({
			id,
			input,
			cron,
			nextRun: job.nextRun()?.toISOString(),
			createdAt,
		}))
	}

	/** Clear all schedules (for shutdown). Disables persistence so the file is never overwritten. */
	clearAll(): void {
		this.savePath = undefined
		for (const entry of this.schedules.values()) {
			entry.job.stop()
		}
		this.schedules.clear()
		logger.info('All schedules cleared')
	}

	/** Save schedules to disk (serialized — only one write at a time) */
	private persist(): void {
		// Skip persistence during restore — data is already on disk
		if (this.restoring) return

		const targetPath = this.savePath
		if (!targetPath) return

		// Don't persist the heartbeat — it's recreated from config on startup
		const toSave: PersistedSchedule[] = Array.from(this.schedules.values())
			.filter((s) => s.id !== '__heartbeat__')
			.map(({ id, input, cron, createdAt }) => ({
				id,
				input,
				cron,
				createdAt,
			}))

		// Chain writes to prevent concurrent fs.writeFile corruption
		this.writeChain = this.writeChain.then(async () => {
			// Re-check path in case clearAll() ran while queued
			if (!this.savePath) return

			// Safety: never overwrite a non-empty file with an empty array.
			if (toSave.length === 0) {
				try {
					const existing = await fs.readFile(targetPath, 'utf-8')
					const parsed = JSON.parse(existing) as unknown[]
					if (parsed.length > 0) {
						logger.warn(
							`Refusing to overwrite ${parsed.length} persisted schedule(s) with empty list`,
						)
						return
					}
				} catch {
					// File doesn't exist or is invalid — safe to write []
				}
			}

			try {
				await fs.mkdir(path.dirname(targetPath), { recursive: true })
				await fs.writeFile(targetPath, JSON.stringify(toSave, null, 2) + '\n', 'utf-8')
				logger.debug(`Persisted ${toSave.length} schedule(s) to disk`)
			} catch (err) {
				logger.error(`Failed to persist schedules: ${err}`)
			}
		})
	}
}
