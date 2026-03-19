import * as crypto from 'node:crypto'
import type { MessageBus } from './bus.js'
import type { RateLimiter } from './rate-limiter.js'
import type { RateLimits } from '../config/index.js'
import { createLogger } from './logger.js'

/** Task states */
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

/** A discrete unit of work for the agent loop */
export interface AgentTask {
	id: string
	source: 'user' | 'schedule' | 'heartbeat' | 'paw'
	input: string
	status: TaskStatus
	createdAt: number
	startedAt?: number
	completedAt?: number
	result?: string
	error?: string
	sessionId?: string
	metadata?: Record<string, unknown>
}

export type TaskRunner = (task: AgentTask) => Promise<void>

const logger = createLogger('task-queue')

/** FIFO task queue with configurable concurrency */
export class TaskQueue {
	private queue: AgentTask[] = []
	private running = new Map<string, AgentTask>()
	private completed: AgentTask[] = []
	private runner: TaskRunner | undefined
	private draining = false

	constructor(
		private bus: MessageBus,
		private concurrency = 1,
		private rateLimiter?: RateLimiter,
		private rateLimits?: RateLimits,
	) {}

	/** Set the task runner function (called by the agent loop) */
	setRunner(runner: TaskRunner): void {
		this.runner = runner
	}

	/** Enqueue a new task */
	enqueue(
		input: string,
		source: 'user' | 'schedule' | 'heartbeat' | 'paw' = 'user',
		options?: { sessionId?: string; metadata?: Record<string, unknown> },
	): AgentTask {
		const task: AgentTask = {
			id: crypto.randomUUID(),
			source,
			input,
			status: 'queued',
			createdAt: Date.now(),
			sessionId: options?.sessionId,
			metadata: options?.metadata,
		}

		// Check tasksPerHour rate limit (warn but still enqueue)
		if (this.rateLimiter && this.rateLimits?.tasksPerHour) {
			const limit = this.rateLimits.tasksPerHour[source]
			if (limit != null) {
				const bucket = `tasks:per-hour:${source}`
				if (!this.rateLimiter.tryConsume(bucket, limit, 3_600_000)) {
					logger.warn(
						`Rate limit warning: tasksPerHour for source "${source}" exceeded (limit: ${limit}). Task will still be enqueued.`,
					)
					this.bus.emit('rate:limited', { bucket, source })
				}
			}
		}

		this.queue.push(task)
		logger.info(`Task ${task.id} queued (source: ${source})`)
		this.bus.emit('task:queued', { taskId: task.id })
		this.drain()
		return task
	}

	/** Cancel a task by ID */
	cancel(taskId: string): boolean {
		// Cancel from queue
		const queueIdx = this.queue.findIndex((t) => t.id === taskId)
		if (queueIdx !== -1) {
			const task = this.queue.splice(queueIdx, 1)[0]
			task.status = 'cancelled'
			task.completedAt = Date.now()
			this.completed.push(task)
			logger.info(`Task ${taskId} cancelled (was queued)`)
			this.bus.emit('task:cancelled', { taskId })
			return true
		}

		// Cancel running task (mark it — the loop must check this)
		const running = this.running.get(taskId)
		if (running) {
			running.status = 'cancelled'
			logger.info(`Task ${taskId} marked for cancellation (running)`)
			return true
		}

		return false
	}

	/** Get all tasks (queued + running + completed) */
	list(): AgentTask[] {
		return [
			...this.queue,
			...Array.from(this.running.values()),
			...this.completed.slice(-50), // keep last 50 completed
		]
	}

	/** Get a task by ID */
	get(taskId: string): AgentTask | undefined {
		return (
			this.queue.find((t) => t.id === taskId) ??
			this.running.get(taskId) ??
			this.completed.find((t) => t.id === taskId)
		)
	}

	/** Check if a task has been cancelled */
	isCancelled(taskId: string): boolean {
		const task = this.running.get(taskId)
		return task?.status === 'cancelled'
	}

	private async drain(): Promise<void> {
		if (this.draining) return
		this.draining = true

		try {
			while (this.queue.length > 0 && this.running.size < this.concurrency) {
				if (!this.runner) {
					logger.error('No task runner configured')
					break
				}

				const task = this.queue.shift()!
				task.status = 'running'
				task.startedAt = Date.now()
				this.running.set(task.id, task)

				logger.info(`Task ${task.id} started`)
				this.bus.emit('task:started', { taskId: task.id })

				// Run task without blocking the drain loop for concurrency > 1
				this.runTask(task)
			}
		} finally {
			this.draining = false
		}
	}

	private async runTask(task: AgentTask): Promise<void> {
		try {
			await this.runner!(task)
			if (task.status !== 'cancelled') {
				task.status = 'completed'
			}
			task.completedAt = Date.now()
			logger.info(`Task ${task.id} ${task.status}`)
			this.bus.emit('task:completed', { taskId: task.id, result: task.result })
		} catch (err) {
			task.status = 'failed'
			task.completedAt = Date.now()
			task.error = err instanceof Error ? err.message : String(err)
			logger.error(`Task ${task.id} failed: ${task.error}`)
			this.bus.emit('task:failed', { taskId: task.id, error: err })
		} finally {
			this.running.delete(task.id)
			this.completed.push(task)
			// Drain next tasks
			this.drain()
		}
	}
}
