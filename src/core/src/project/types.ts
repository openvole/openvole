/**
 * Projects and their work items.
 *
 * A **project** is one body of work living in the agent's workspace: a directory under
 * `.openvole/workspace/` containing a `.project.json` manifest. The filesystem is the index —
 * there is no separate registry to drift out of sync.
 *
 * A **ProjectTask** is a durable unit of work inside a project — a goal with done-criteria that
 * may span many agent runs over hours or days. Deliberately NOT called `Task`: core already has
 * `AgentTask`/`TaskQueue` (core/task.ts), which is a single in-memory loop *execution*. One
 * ProjectTask ("port paw-database off better-sqlite3") is worked on across many AgentTasks.
 */

/** What kind of work this is — drives scan heuristics and, later, kind-specific paws. */
export type ProjectKind = 'code' | 'writing' | 'media' | 'research' | 'general'

export type ProjectStatus = 'active' | 'paused' | 'archived'

export interface ProjectManifest {
	/** Also the directory name. Lowercase, filesystem- and URL-safe. */
	id: string
	name: string
	kind: ProjectKind
	/**
	 * Absolute path to files the project operates on, when they live outside the workspace
	 * (a git repo, a footage folder). Absent means the project *is* its workspace folder.
	 *
	 * A privilege boundary, not a convenience field — see `validateProjectRoot`.
	 */
	root?: string
	status: ProjectStatus
	/** Inferred by project_scan (phase 2). Informational — never used for permissions. */
	stack?: string[]
	/** Narrows the agent's tool profile for this project. Can never widen it. */
	toolProfile?: { allow?: string[]; deny?: string[] }
	tags?: string[]
	createdAt: number
	updatedAt: number
}

export type TaskState =
	| 'queued'
	| 'running'
	/** Checking output against doneCriteria. The phase that stops "the agent said it finished". */
	| 'verifying'
	/** Reserved for the phase-3 approval gate; nothing transitions here yet. */
	| 'waiting_approval'
	/** Recoverable stop — criteria unmet, budget spent, or a human is needed. Carries `note`. */
	| 'blocked'
	| 'done'
	| 'failed'
	| 'cancelled'

/** Legal transitions. Anything not listed is rejected by `TaskStore.update`. */
export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
	queued: ['running', 'cancelled'],
	running: ['verifying', 'waiting_approval', 'blocked', 'failed', 'cancelled'],
	verifying: ['done', 'blocked', 'failed', 'cancelled'],
	waiting_approval: ['running', 'blocked', 'cancelled'],
	// Recovery paths — a blocked task is the normal thing a human unblocks.
	blocked: ['queued', 'running', 'cancelled'],
	// Terminal. Redoing finished work means a new task, so its history stays readable.
	done: [],
	// Retryable: a failure is usually environmental (network, a flaky build).
	failed: ['queued'],
	cancelled: [],
}

export const TERMINAL_TASK_STATES: readonly TaskState[] = ['done', 'failed', 'cancelled']

export interface TaskBudget {
	/** Loop iterations across all runs of this task. Exhaustion blocks, never silently truncates. */
	maxIterations?: number
	/** Epoch ms. Past deadline blocks. */
	deadline?: number | null
}

export interface ProjectTask {
	id: string
	projectId: string
	goal: string
	/** Checked in the `verifying` state. Empty means the agent's own judgement is the bar. */
	doneCriteria: string[]
	budget?: TaskBudget
	state: TaskState
	/** Higher runs first. Ties break oldest-first so a queue drains in order. */
	priority: number
	/** Why it is blocked / what happened. Surfaced to the human. */
	note?: string | null
	/** Paths (workspace-relative or absolute) this task produced. */
	artifacts?: string[]
	/** Iterations consumed so far, against `budget.maxIterations`. */
	iterationsUsed?: number
	createdAt: number
	updatedAt: number
}

/** What the loop puts on `context.metadata.project` for the system prompt. */
export interface ProjectContextInfo {
	id: string
	name: string
	kind: ProjectKind
	/** Absolute external root, or undefined for a self-contained project. */
	root?: string
	/** Absolute path of the project's own folder in the workspace. */
	dir: string
	/** Narrows tool access for the duration of this task. Never rendered into the prompt. */
	toolProfile?: { allow?: string[]; deny?: string[] }
	/** CONTEXT.md verbatim (already capped by the store). */
	context?: string
	task?: { id: string; goal: string; doneCriteria: string[] }
}

/** Thrown when a project root is missing, not a directory, or outside the sandbox. */
export class ProjectRootError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ProjectRootError'
	}
}

/** Thrown for illegal state transitions and malformed input. */
export class ProjectError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ProjectError'
	}
}
