/**
 * Task storage — `tasks.jsonl` inside each project directory.
 *
 * Append-only with last-line-wins per id, matching the house idiom (agent/event-log.ts,
 * paw-session, paw-recall). Every state change is a new line, so the file *is* the audit trail:
 * how long a task sat queued, what blocked it, how many times it was retried. No separate history
 * store, and a partially-written trailing line costs one update rather than the file.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createLogger } from '../core/logger.js'
import type { ProjectStore } from './store.js'
import { TASKS_NAME } from './store.js'
import {
	ProjectError,
	type ProjectTask,
	TASK_TRANSITIONS,
	TERMINAL_TASK_STATES,
	type TaskBudget,
	type TaskEvent,
	type TaskState,
} from './types.js'

const logger = createLogger('project-tasks')

export interface CreateTaskInput {
	projectId: string
	goal: string
	doneCriteria?: string[]
	budget?: TaskBudget
	priority?: number
}

export interface TaskFilter {
	projectId?: string
	state?: TaskState | 'open' | 'all'
}

/** States that still need work — the default view, and what `next()` and the board care about. */
const OPEN_STATES: readonly TaskState[] = [
	'queued',
	'running',
	'verifying',
	'waiting_approval',
	'blocked',
]

let counter = 0

function newTaskId(): string {
	counter = (counter + 1) % 0xffff
	return `t_${Date.now().toString(36)}${counter.toString(36).padStart(3, '0')}`
}

export class TaskStore {
	constructor(private readonly projects: ProjectStore) {}

	private fileFor(projectId: string): string {
		return path.join(this.projects.dirFor(projectId), TASKS_NAME)
	}

	async create(input: CreateTaskInput): Promise<ProjectTask> {
		const goal = input.goal?.trim()
		if (!goal) throw new ProjectError('task goal is empty')
		if (!(await this.projects.exists(input.projectId))) {
			throw new ProjectError(`no such project: "${input.projectId}"`)
		}

		const now = Date.now()
		const task: ProjectTask = {
			id: newTaskId(),
			projectId: input.projectId,
			goal,
			doneCriteria: (input.doneCriteria ?? []).map((c) => c.trim()).filter(Boolean),
			...(input.budget ? { budget: input.budget } : {}),
			state: 'queued',
			priority: input.priority ?? 0,
			note: null,
			artifacts: [],
			iterationsUsed: 0,
			createdAt: now,
			updatedAt: now,
		}
		await this.append(task)
		return task
	}

	async get(projectId: string, taskId: string): Promise<ProjectTask | null> {
		const all = await this.readAll(projectId)
		return all.get(taskId) ?? null
	}

	async list(filter: TaskFilter = {}): Promise<ProjectTask[]> {
		const projectIds = filter.projectId
			? [filter.projectId]
			: (await this.projects.list({ status: 'all' })).map((p) => p.id)

		const out: ProjectTask[] = []
		for (const id of projectIds) {
			for (const task of (await this.readAll(id)).values()) {
				if (!matchesState(task.state, filter.state)) continue
				out.push(task)
			}
		}
		return out.sort(byPriorityThenAge)
	}

	/**
	 * The scheduler's entry point: the highest-priority queued task, oldest first within a
	 * priority. Only `active` projects are considered — pausing a project stops its work being
	 * picked up without touching its tasks.
	 */
	async next(projectId?: string): Promise<ProjectTask | null> {
		const projects = projectId
			? [projectId]
			: (await this.projects.list({ status: 'active' })).map((p) => p.id)

		const candidates: ProjectTask[] = []
		for (const id of projects) {
			for (const task of (await this.readAll(id)).values()) {
				if (task.state === 'queued') candidates.push(task)
			}
		}
		if (candidates.length === 0) return null
		return candidates.sort(byPriorityThenAge)[0]
	}

	/**
	 * Apply a patch. State changes are validated against TASK_TRANSITIONS — an illegal move
	 * throws rather than silently landing, because the states carry meaning the review queue
	 * depends on (a task must not reach `done` without passing through `verifying`).
	 */
	async update(
		projectId: string,
		taskId: string,
		patch: Partial<Omit<ProjectTask, 'id' | 'projectId' | 'createdAt'>>,
	): Promise<ProjectTask> {
		const current = await this.get(projectId, taskId)
		if (!current) throw new ProjectError(`no such task: "${taskId}" in project "${projectId}"`)

		if (patch.state && patch.state !== current.state) {
			const legal = TASK_TRANSITIONS[current.state]
			if (!legal.includes(patch.state)) {
				const detail = legal.length
					? `(from ${current.state}, allowed: ${legal.join(', ')})`
					: `— ${current.state} is terminal`
				throw new ProjectError(`illegal transition ${current.state} → ${patch.state} ${detail}`)
			}
		}

		const next: ProjectTask = {
			...current,
			...patch,
			id: current.id,
			projectId: current.projectId,
			createdAt: current.createdAt,
			updatedAt: Date.now(),
		}
		await this.append(next)
		return next
	}

	/**
	 * Charge iterations against the task's budget, blocking when it runs out.
	 *
	 * Exhaustion is a *recoverable stop*, never a silent truncation: the human sees a blocked task
	 * with the reason and can raise the budget and requeue it.
	 */
	async chargeIterations(
		projectId: string,
		taskId: string,
		used: number,
	): Promise<{ task: ProjectTask; exhausted: boolean }> {
		const current = await this.get(projectId, taskId)
		if (!current) throw new ProjectError(`no such task: "${taskId}"`)

		const total = (current.iterationsUsed ?? 0) + used
		const max = current.budget?.maxIterations
		const deadline = current.budget?.deadline
		const overIterations = typeof max === 'number' && max > 0 && total >= max
		const overDeadline = typeof deadline === 'number' && deadline > 0 && Date.now() >= deadline

		if ((overIterations || overDeadline) && !TERMINAL_TASK_STATES.includes(current.state)) {
			const reason = overIterations
				? `budget exhausted — ${total}/${max} iterations used`
				: 'deadline passed'
			// blocked is reachable from every non-terminal state except… none: check anyway so a
			// future state addition can't produce an illegal write here.
			const canBlock = TASK_TRANSITIONS[current.state].includes('blocked')
			const task = canBlock
				? await this.update(projectId, taskId, {
						state: 'blocked',
						note: reason,
						iterationsUsed: total,
					})
				: await this.update(projectId, taskId, { iterationsUsed: total })
			logger.info(`task ${taskId} blocked: ${reason}`)
			return { task, exhausted: true }
		}

		const task = await this.update(projectId, taskId, { iterationsUsed: total })
		return { task, exhausted: false }
	}

	/**
	 * The lifecycle of every task in a project: which states it passed through and when.
	 *
	 * The data was always there — `append` writes a full record per change and `readAll` throws all
	 * but the last away — so this is a second pass over the same file, not new bookkeeping.
	 *
	 * Only *state changes* become events. A record that merely charged iterations moved nothing a
	 * reader cares about, and emitting one per write would bury the six moves that matter under
	 * dozens of identical lines.
	 *
	 * Newest first, matching how the board reads: what happened most recently is what you came to
	 * find out.
	 */
	async history(projectId: string): Promise<Map<string, TaskEvent[]>> {
		const out = new Map<string, TaskEvent[]>()
		for (const [id, records] of (await this.readRecords(projectId)).entries()) {
			const events: TaskEvent[] = []
			let previous: TaskState | null = null
			for (const record of records) {
				if (record.state === previous) continue
				previous = record.state
				events.push({
					state: record.state,
					at: record.updatedAt ?? record.createdAt,
					...(record.note ? { note: record.note } : {}),
				})
			}
			// The creating record carries `createdAt === updatedAt`, so the first event is the
			// creation and needs no special case.
			out.set(id, events.reverse())
		}
		return out
	}

	private async append(task: ProjectTask): Promise<void> {
		const file = this.fileFor(task.projectId)
		await fs.mkdir(path.dirname(file), { recursive: true })
		await fs.appendFile(file, `${JSON.stringify(task)}\n`, 'utf-8')
	}

	/** Last line wins per id. A malformed line is skipped, not fatal. */
	private async readAll(projectId: string): Promise<Map<string, ProjectTask>> {
		const byId = new Map<string, ProjectTask>()
		for (const [id, records] of (await this.readRecords(projectId)).entries()) {
			const last = records[records.length - 1]
			if (last) byId.set(id, last)
		}
		return byId
	}

	/** Every record per id, in the order they were written. A malformed line is skipped, not fatal. */
	private async readRecords(projectId: string): Promise<Map<string, ProjectTask[]>> {
		const byId = new Map<string, ProjectTask[]>()
		let raw: string
		try {
			raw = await fs.readFile(this.fileFor(projectId), 'utf-8')
		} catch {
			return byId
		}
		for (const line of raw.split('\n')) {
			const trimmed = line.trim()
			if (!trimmed) continue
			try {
				const task = JSON.parse(trimmed) as ProjectTask
				if (!task?.id) continue
				const records = byId.get(task.id)
				if (records) records.push(task)
				else byId.set(task.id, [task])
			} catch {
				// A torn trailing line costs one update, not the file.
			}
		}
		return byId
	}
}

function matchesState(state: TaskState, want?: TaskState | 'open' | 'all'): boolean {
	if (!want || want === 'open') return OPEN_STATES.includes(state)
	if (want === 'all') return true
	return state === want
}

function byPriorityThenAge(a: ProjectTask, b: ProjectTask): number {
	if (b.priority !== a.priority) return b.priority - a.priority
	return a.createdAt - b.createdAt
}
