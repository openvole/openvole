import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createLogger } from './logger.js'

const logger = createLogger('scheduler')

interface ScheduleEntry {
	id: string
	input: string
	intervalMinutes: number
	timer: ReturnType<typeof setInterval>
	createdAt: number
}

/** Persisted schedule data (no timer handle) */
interface PersistedSchedule {
	id: string
	input: string
	intervalMinutes: number
	createdAt: number
}

/** Persistent store for recurring schedules — saves to .openvole/schedules.json */
export class SchedulerStore {
	private schedules = new Map<string, ScheduleEntry>()
	private savePath: string | undefined
	private tickHandler: ((input: string) => void) | undefined

	/** Set the file path for persistence */
	setPersistence(filePath: string): void {
		this.savePath = filePath
	}

	/** Set the handler called when a schedule ticks */
	setTickHandler(handler: (input: string) => void): void {
		this.tickHandler = handler
	}

	/** Load persisted schedules from disk and restart their timers */
	async restore(): Promise<void> {
		if (!this.savePath || !this.tickHandler) return

		try {
			const raw = await fs.readFile(this.savePath, 'utf-8')
			const persisted = JSON.parse(raw) as PersistedSchedule[]

			for (const s of persisted) {
				this.add(s.id, s.input, s.intervalMinutes, () => {
					this.tickHandler!(s.input)
				}, s.createdAt)
			}

			if (persisted.length > 0) {
				logger.info(`Restored ${persisted.length} schedule(s) from disk`)
			}
		} catch {
			// No file or invalid — start fresh
		}
	}

	/** Create or replace a recurring schedule */
	add(
		id: string,
		input: string,
		intervalMinutes: number,
		onTick: () => void,
		createdAt?: number,
		immediate = false,
	): void {
		// Cancel existing schedule with same ID (idempotent upsert)
		if (this.schedules.has(id)) {
			this.cancel(id, true)
		}

		const intervalMs = intervalMinutes * 60_000
		if (immediate) {
			setTimeout(onTick, 0)
		}
		const timer = setInterval(onTick, intervalMs)

		this.schedules.set(id, {
			id,
			input,
			intervalMinutes,
			timer,
			createdAt: createdAt ?? Date.now(),
		})

		logger.info(`Schedule "${id}" created — every ${intervalMinutes}m: "${input.substring(0, 80)}"`)
		this.persist()
	}

	/** Cancel a schedule by ID */
	cancel(id: string, skipPersist = false): boolean {
		const entry = this.schedules.get(id)
		if (!entry) return false

		clearInterval(entry.timer)
		this.schedules.delete(id)
		logger.info(`Schedule "${id}" cancelled`)
		if (!skipPersist) this.persist()
		return true
	}

	/** List all active schedules */
	list(): Array<{ id: string; input: string; intervalMinutes: number; createdAt: number }> {
		return Array.from(this.schedules.values()).map(({ id, input, intervalMinutes, createdAt }) => ({
			id,
			input,
			intervalMinutes,
			createdAt,
		}))
	}

	/** Clear all schedules (for shutdown) */
	clearAll(): void {
		for (const entry of this.schedules.values()) {
			clearInterval(entry.timer)
		}
		this.schedules.clear()
		logger.info('All schedules cleared')
	}

	/** Save schedules to disk */
	private async persist(): Promise<void> {
		if (!this.savePath) return

		// Don't persist the heartbeat — it's recreated from config on startup
		const toSave: PersistedSchedule[] = Array.from(this.schedules.values())
			.filter((s) => s.id !== '__heartbeat__')
			.map(({ id, input, intervalMinutes, createdAt }) => ({
				id,
				input,
				intervalMinutes,
				createdAt,
			}))

		try {
			await fs.mkdir(path.dirname(this.savePath), { recursive: true })
			await fs.writeFile(this.savePath, JSON.stringify(toSave, null, 2) + '\n', 'utf-8')
		} catch (err) {
			logger.error(`Failed to persist schedules: ${err}`)
		}
	}
}
