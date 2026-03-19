import { createLogger } from './logger.js'

const logger = createLogger('scheduler')

interface ScheduleEntry {
	id: string
	input: string
	intervalMinutes: number
	timer: ReturnType<typeof setInterval>
	createdAt: number
}

/** In-memory store for brain-created recurring schedules */
export class SchedulerStore {
	private schedules = new Map<string, ScheduleEntry>()

	/** Create or replace a recurring schedule */
	add(
		id: string,
		input: string,
		intervalMinutes: number,
		onTick: () => void,
	): void {
		// Cancel existing schedule with same ID (idempotent upsert)
		if (this.schedules.has(id)) {
			this.cancel(id)
		}

		const intervalMs = intervalMinutes * 60_000
		const timer = setInterval(onTick, intervalMs)

		this.schedules.set(id, {
			id,
			input,
			intervalMinutes,
			timer,
			createdAt: Date.now(),
		})

		logger.info(`Schedule "${id}" created — every ${intervalMinutes}m: "${input.substring(0, 80)}"`)
	}

	/** Cancel a schedule by ID */
	cancel(id: string): boolean {
		const entry = this.schedules.get(id)
		if (!entry) return false

		clearInterval(entry.timer)
		this.schedules.delete(id)
		logger.info(`Schedule "${id}" cancelled`)
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
}
