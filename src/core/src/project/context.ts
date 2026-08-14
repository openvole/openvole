/**
 * Resolving a task's project scope into what the system prompt needs.
 *
 * Scope arrives *with the task* — set by the scheduler for a scoped schedule, by the dashboard for
 * a scoped chat, or by the agent when it picks up work — and never from ambient state. Tasks
 * interleave (a heartbeat can fire mid-chat), so a global "current project" would hand one task
 * another's context; that is the bug shape that once filed brain replies under the wrong session.
 */

import { createLogger } from '../core/logger.js'
import type { ProjectStore } from './store.js'
import type { TaskStore } from './tasks.js'
import type { ProjectContextInfo } from './types.js'

const logger = createLogger('project-context')

/** Task metadata keys that carry project scope. */
export interface ProjectScope {
	projectId?: unknown
	projectTaskId?: unknown
}

/**
 * Build the prompt-facing view of a task's project, or null when the task has no project — in
 * which case the prompt is byte-identical to the pre-projects behaviour.
 *
 * Never throws for missing data: an unknown project id or a deleted work item degrades to running
 * unscoped, because losing project context must not lose the task.
 */
/** One line per project for the prompt's roster. */
export interface ProjectRosterEntry {
	id: string
	name: string
	kind: string
	openTasks: number
}

/**
 * Every active project with its open-task count.
 *
 * Without this an agent only learns its projects exist by calling project_list, which it has no
 * reason to do mid-conversation — so "carry on with the openvole work" would find an agent that
 * cannot see the openvole project. Cheap enough to build per task: a directory read plus one file
 * per project.
 */
export async function listProjectRoster(
	projects: ProjectStore,
	tasks: TaskStore,
): Promise<ProjectRosterEntry[]> {
	const active = await projects.list({ status: 'active' })
	const roster: ProjectRosterEntry[] = []
	for (const project of active) {
		const open = await tasks.list({ projectId: project.id })
		roster.push({
			id: project.id,
			name: project.name,
			kind: project.kind,
			openTasks: open.length,
		})
	}
	return roster
}

export interface ResolveOptions {
	/**
	 * When the scope names a project but no specific work item, pull the project's highest-priority
	 * queued task. This is what closes the scheduler loop — a scoped schedule fires and the agent
	 * arrives already knowing the goal and its done-criteria, instead of waking with no objective.
	 *
	 * Only for self-initiated runs (schedule, heartbeat). A chat turn must NOT pull work: the
	 * human's message is the instruction, and attaching an unrelated task's done-criteria to it
	 * would have the agent answer against the wrong bar.
	 *
	 * Selection does not claim the task — no state transition happens from a timer, so a crashed
	 * run can never strand a task in `running`. The agent moves it with the task tools.
	 */
	autoSelectTask?: boolean
}

export async function resolveProjectContext(
	projects: ProjectStore,
	tasks: TaskStore,
	scope: ProjectScope | undefined,
	opts: ResolveOptions = {},
): Promise<ProjectContextInfo | null> {
	const projectId = scope?.projectId
	if (typeof projectId !== 'string' || !projectId) return null

	const manifest = await projects.get(projectId)
	if (!manifest) {
		logger.warn(`unknown project "${projectId}" — running unscoped`)
		return null
	}

	const info: ProjectContextInfo = {
		id: manifest.id,
		name: manifest.name,
		kind: manifest.kind,
		...(manifest.root ? { root: manifest.root } : {}),
		dir: projects.dirFor(manifest.id),
		...(manifest.toolProfile ? { toolProfile: manifest.toolProfile } : {}),
	}

	const context = await projects.readContext(manifest.id)
	if (context) info.context = context

	const projectTaskId = scope?.projectTaskId
	if (typeof projectTaskId === 'string' && projectTaskId) {
		const work = await tasks.get(manifest.id, projectTaskId)
		if (work) {
			info.task = { id: work.id, goal: work.goal, doneCriteria: work.doneCriteria }
		} else {
			logger.warn(`unknown task "${projectTaskId}" in project "${manifest.id}"`)
		}
	} else if (opts.autoSelectTask) {
		const work = await tasks.next(manifest.id)
		if (work) {
			info.task = { id: work.id, goal: work.goal, doneCriteria: work.doneCriteria }
			logger.info(`pulled queued task "${work.id}" for project "${manifest.id}": ${work.goal}`)
		}
	}

	return info
}

/**
 * Combine a project's tool profile with whatever restriction the task already carries.
 *
 * Narrowing only, in both directions: denies union (anything either side forbids stays
 * forbidden) and allows intersect (a tool must clear both lists). A project therefore cannot
 * hand its agent a capability the agent did not already have — which is what makes it safe for
 * the *agent* to write project manifests. Sub-agent profiles keep their restrictions too.
 */
export function narrowToolAccess(
	current: { allow?: string[]; deny?: string[] },
	project: { allow?: string[]; deny?: string[] } | undefined,
): { allow?: string[]; deny?: string[] } {
	if (!project) return current

	const deny = [...new Set([...(current.deny ?? []), ...(project.deny ?? [])])]

	let allow: string[] | undefined
	if (current.allow?.length && project.allow?.length) {
		const permitted = new Set(current.allow)
		allow = project.allow.filter((tool) => permitted.has(tool))
	} else if (current.allow?.length) {
		allow = current.allow
	} else if (project.allow?.length) {
		allow = project.allow
	}

	return {
		...(allow ? { allow } : {}),
		...(deny.length ? { deny } : {}),
	}
}
