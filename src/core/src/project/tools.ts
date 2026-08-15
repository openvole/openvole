/**
 * The project and task tools — how an agent sets up its own work.
 *
 * The point of this file is that a human should never have to hand-edit AGENT.md to change what an
 * agent is working on. "Work on the openvole repo" becomes: scan the root, draft a CONTEXT.md from
 * what was actually found, propose a project and some opening tasks, and create them once the human
 * agrees. The agent writes its own setup; the human reviews it.
 *
 * These are core tools rather than a paw because projects scope the system prompt, the tool
 * profile, and the scheduler — all core-owned. A subprocess paw can register tools but cannot
 * rescope the prompt.
 */

import { z } from 'zod'
import type { ToolDefinition } from '../tool/types.js'
import { scanProjectRoot } from './scan.js'
import type { ProjectStore } from './store.js'
import type { TaskStore } from './tasks.js'
import { ProjectError, ProjectRootError, TASK_TRANSITIONS, type TaskState } from './types.js'

const KIND = z.enum(['code', 'writing', 'media', 'research', 'general'])

const TASK_STATES = [
	'queued',
	'running',
	'verifying',
	'waiting_approval',
	'blocked',
	'done',
	'failed',
	'cancelled',
] as const

/** Rendered into task_update's description so the brain sees the machine it has to satisfy. */
const LEGAL_MOVES = Object.entries(TASK_TRANSITIONS)
	.filter(([, to]) => to.length > 0)
	.map(([from, to]) => `${from} → ${to.join('|')}`)
	.join('; ')

/** Tool errors are results, not exceptions — the brain should read and recover, not crash the run. */
function fail(err: unknown): { ok: false; error: string } {
	if (err instanceof ProjectRootError || err instanceof ProjectError) {
		return { ok: false, error: err.message }
	}
	return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

export interface ProjectToolDeps {
	projects: ProjectStore
	tasks: TaskStore
}

export function createProjectTools(deps: ProjectToolDeps): ToolDefinition[] {
	const { projects, tasks } = deps

	return [
		{
			name: 'project_scan',
			description:
				'Inspect a directory before making it a project: detects the stack, suggests a kind and tools, and lists the docs worth reading. Read-only — writes nothing. Use this before project_create so the project is described from evidence rather than guessed.',
			parameters: z.object({
				root: z.string().describe('Absolute path to inspect (or ~/... )'),
			}),
			async execute(params) {
				const { root } = params as { root: string }
				try {
					// Same allowed set the store authorizes creation against — scanning must never
					// reach further than creating.
					return { ok: true, ...(await scanProjectRoot(root, projects.allowedRoots)) }
				} catch (err) {
					return fail(err)
				}
			},
		},
		{
			name: 'project_create',
			description:
				'Create a project in the workspace. Projects hold their own context, notes and task queue, and are how you switch what you are working on without editing AGENT.md. Set `root` when the files live elsewhere (a repo, a footage folder); leave it out for self-contained work such as drafts or research.',
			parameters: z.object({
				id: z
					.string()
					.describe(
						'Short id, also the folder name: lowercase letters, digits, dot, dash, underscore',
					),
				name: z.string().optional().describe('Human-readable name (defaults to the id)'),
				kind: KIND.optional().describe('What sort of work this is (default: general)'),
				root: z
					.string()
					.optional()
					.describe(
						'Absolute path to existing files this project works on. Must already be inside the agent’s allowed paths — this tool cannot grant access.',
					),
				context: z
					.string()
					.optional()
					.describe(
						'Initial CONTEXT.md — what this project is, how to work in it, anything a future run would need. Write it from what you actually found.',
					),
				stack: z.array(z.string()).optional().describe('Detected technologies (informational)'),
				tags: z.array(z.string()).optional(),
			}),
			async execute(params) {
				try {
					const manifest = await projects.create(params as Parameters<ProjectStore['create']>[0])
					return { ok: true, project: manifest, dir: projects.dirFor(manifest.id) }
				} catch (err) {
					return fail(err)
				}
			},
		},
		{
			name: 'project_list',
			description:
				'List projects in this workspace. Defaults to active ones; pass status to include paused or archived.',
			parameters: z.object({
				status: z
					.enum(['active', 'paused', 'archived', 'all'])
					.optional()
					.describe('Which projects to include (default: active)'),
			}),
			async execute(params) {
				const { status } = params as { status?: 'active' | 'paused' | 'archived' | 'all' }
				try {
					const list = await projects.list(status ? { status } : undefined)
					return {
						ok: true,
						count: list.length,
						projects: list.map((p) => ({
							id: p.id,
							name: p.name,
							kind: p.kind,
							status: p.status,
							root: p.root ?? null,
						})),
					}
				} catch (err) {
					return fail(err)
				}
			},
		},
		{
			name: 'project_open',
			description:
				'Read everything about one project: its manifest, its CONTEXT.md, and its open tasks. Use this when you start working on a project you did not set up in this run.',
			parameters: z.object({
				id: z.string().describe('Project id'),
			}),
			async execute(params) {
				const { id } = params as { id: string }
				try {
					const manifest = await projects.get(id)
					if (!manifest) return { ok: false, error: `no such project: "${id}"` }
					return {
						ok: true,
						project: manifest,
						dir: projects.dirFor(id),
						context: (await projects.readContext(id)) ?? null,
						tasks: await tasks.list({ projectId: id }),
					}
				} catch (err) {
					return fail(err)
				}
			},
		},
		{
			name: 'project_update',
			description:
				'Update a project: rename it, change its kind or status, repoint its root, or rewrite CONTEXT.md. Keep CONTEXT.md current — it is what a future run reads to understand this project, and a stale one silently misleads.',
			parameters: z.object({
				id: z.string().describe('Project id'),
				name: z.string().optional(),
				kind: KIND.optional(),
				status: z.enum(['active', 'paused', 'archived']).optional(),
				root: z
					.string()
					.optional()
					.describe('New root. Re-checked against allowed paths — this is not a way around them.'),
				stack: z.array(z.string()).optional(),
				tags: z.array(z.string()).optional(),
				context: z.string().optional().describe('Replaces CONTEXT.md entirely'),
			}),
			async execute(params) {
				const { id, context, ...patch } = params as {
					id: string
					context?: string
					[k: string]: unknown
				}
				try {
					const hasPatch = Object.values(patch).some((v) => v !== undefined)
					const manifest = hasPatch
						? await projects.update(id, patch as never)
						: await projects.get(id)
					if (!manifest) return { ok: false, error: `no such project: "${id}"` }
					if (context !== undefined) await projects.writeContext(id, context)
					return { ok: true, project: manifest }
				} catch (err) {
					return fail(err)
				}
			},
		},
		{
			name: 'project_archive',
			description:
				'Retire a project. Keeps every file and its task history — it only drops out of the default listing. Use this instead of deleting the folder.',
			parameters: z.object({
				id: z.string().describe('Project id'),
			}),
			async execute(params) {
				const { id } = params as { id: string }
				try {
					return { ok: true, project: await projects.archive(id) }
				} catch (err) {
					return fail(err)
				}
			},
		},
		{
			name: 'task_create',
			description:
				'Add a unit of work to a project. Give every task done-criteria you can actually check — you will be asked to verify them before the task may be marked done, and a task with vague criteria cannot be finished honestly.',
			parameters: z.object({
				projectId: z.string().describe('Which project this work belongs to'),
				goal: z.string().describe('What needs to be true when this is finished'),
				doneCriteria: z
					.array(z.string())
					.optional()
					.describe(
						'Checkable conditions, e.g. "pnpm test passes", "the draft is 2000+ words". Prefer things you can verify by running or reading something.',
					),
				priority: z.number().optional().describe('Higher runs first (default 0)'),
				maxIterations: z
					.number()
					.optional()
					.describe('Budget across all runs; exhausting it blocks the task rather than failing it'),
			}),
			async execute(params) {
				const { projectId, goal, doneCriteria, priority, maxIterations } = params as {
					projectId: string
					goal: string
					doneCriteria?: string[]
					priority?: number
					maxIterations?: number
				}
				try {
					const task = await tasks.create({
						projectId,
						goal,
						doneCriteria,
						priority,
						...(maxIterations ? { budget: { maxIterations } } : {}),
					})
					return { ok: true, task }
				} catch (err) {
					return fail(err)
				}
			},
		},
		{
			name: 'task_list',
			description:
				'List work items. Defaults to open tasks (queued, running, verifying, waiting approval, blocked) across all projects.',
			parameters: z.object({
				projectId: z.string().optional().describe('Restrict to one project'),
				state: z
					.enum([...TASK_STATES, 'open', 'all'])
					.optional()
					.describe('Filter by state (default: open)'),
			}),
			async execute(params) {
				const { projectId, state } = params as {
					projectId?: string
					state?: TaskState | 'open' | 'all'
				}
				try {
					const list = await tasks.list({ projectId, state })
					return { ok: true, count: list.length, tasks: list }
				} catch (err) {
					return fail(err)
				}
			},
		},
		{
			name: 'task_update',
			description: `Move a task through its lifecycle or record what happened. If you hand the work to another agent, delegating is NOT finishing: set assignee and delegatedTaskId, leave the task running, and when that agent reports back record its artifacts and outcome here before you verify and close it — otherwise the project has no record that any of it happened. The path to finishing is running → verifying → done: you must check the done-criteria in \`verifying\` and may only then set \`done\`. If a criterion does not hold, set \`blocked\` with a note saying which one and why — never report success you cannot back up. Legal moves: ${LEGAL_MOVES}`,
			parameters: z.object({
				projectId: z.string().describe('Project the task belongs to'),
				taskId: z.string().describe('Task id'),
				state: z.enum(TASK_STATES).optional().describe('New state'),
				note: z
					.string()
					.optional()
					.describe('Why it is blocked, or what happened. Shown to your human.'),
				artifacts: z.array(z.string()).optional().describe('Paths this task produced'),
				priority: z.number().optional(),
				goal: z.string().optional(),
				doneCriteria: z.array(z.string()).optional(),
			}),
			async execute(params) {
				const { projectId, taskId, ...patch } = params as {
					projectId: string
					taskId: string
					[k: string]: unknown
				}
				try {
					const defined = Object.fromEntries(
						Object.entries(patch).filter(([, v]) => v !== undefined),
					)
					return { ok: true, task: await tasks.update(projectId, taskId, defined as never) }
				} catch (err) {
					return fail(err)
				}
			},
		},
		{
			name: 'task_next',
			description:
				'Get the next queued task to work on — highest priority first, oldest first within a priority, active projects only. This does not claim the task: move it to `running` with task_update when you actually start.',
			parameters: z.object({
				projectId: z.string().optional().describe('Restrict to one project'),
			}),
			async execute(params) {
				const { projectId } = params as { projectId?: string }
				try {
					const task = await tasks.next(projectId)
					if (!task) return { ok: true, task: null, message: 'No queued tasks.' }
					const project = await projects.get(task.projectId)
					return {
						ok: true,
						task,
						project: project
							? { id: project.id, name: project.name, root: project.root ?? null }
							: null,
					}
				} catch (err) {
					return fail(err)
				}
			},
		},
	]
}
