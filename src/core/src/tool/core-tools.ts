import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execa } from 'execa'
import { z } from 'zod'
import type { SchedulerStore } from '../core/scheduler.js'
import type { TaskQueue } from '../core/task.js'
import type { Vault } from '../core/vault.js'
import type { SkillRegistry } from '../skill/registry.js'
import type { ToolRegistry } from './registry.js'
import type { ToolDefinition } from './types.js'

/** Interpreter candidates per script extension (first available on PATH wins). */
const SCRIPT_INTERPRETERS: Record<string, string[]> = {
	'.js': ['node'],
	'.mjs': ['node'],
	'.cjs': ['node'],
	'.py': ['python3', 'python'],
	'.sh': ['bash', 'sh'],
	'.bash': ['bash'],
}
const SCRIPT_TIMEOUT_DEFAULT_MS = 120_000
const SCRIPT_TIMEOUT_MAX_MS = 600_000
const MAX_SCRIPT_OUTPUT = 20_000
const SCRIPT_MAX_BUFFER = 1_000_000
/** Env vars always safe to forward to a skill script (the interpreter needs PATH, etc.). */
const SCRIPT_ENV_BASELINE = [
	'PATH',
	'HOME',
	'LANG',
	'LC_ALL',
	'TMPDIR',
	'TEMP',
	'TMP',
	'SystemRoot',
	'PATHEXT',
]

/** Create the built-in core tools that are always available to the Brain */
export function createCoreTools(
	scheduler: SchedulerStore,
	taskQueue: TaskQueue,
	projectRoot: string,
	skillRegistry: SkillRegistry,
	vault: Vault,
	toolRegistry?: ToolRegistry,
): ToolDefinition[] {
	const heartbeatPath = path.resolve(projectRoot, '.openvole', 'HEARTBEAT.md')
	const workspaceDir = path.resolve(projectRoot, '.openvole', 'workspace')

	/** Validate that a resolved path stays inside the workspace directory */
	function resolveWorkspacePath(relativePath: string): string | null {
		const resolved = path.resolve(workspaceDir, relativePath)
		if (!resolved.startsWith(workspaceDir + path.sep) && resolved !== workspaceDir) {
			return null
		}
		return resolved
	}

	return [
		// === Scheduling tools ===
		{
			name: 'schedule_task',
			description:
				'Create a recurring scheduled task using a cron expression. Examples: "0 13 * * *" = daily at 1 PM UTC, "*/30 * * * *" = every 30 minutes, "0 9 * * 1" = every Monday at 9 AM UTC.',
			parameters: z.object({
				id: z.string().describe('Unique schedule ID (for cancellation)'),
				input: z.string().describe('The task input to enqueue each time'),
				cron: z
					.string()
					.describe(
						'Cron expression in UTC (minute hour day month weekday). Examples: "0 13 * * *" for daily 1 PM, "*/30 * * * *" for every 30 min',
					),
			}),
			async execute(params) {
				const { id, input, cron } = params as {
					id: string
					input: string
					cron: string
				}
				try {
					scheduler.add(id, input, cron, () => {
						taskQueue.enqueue(input, 'schedule')
					})
					const schedules = scheduler.list()
					const entry = schedules.find((s) => s.id === id)
					return { ok: true, id, cron, nextRun: entry?.nextRun }
				} catch (err) {
					return {
						ok: false,
						error: `Invalid cron expression: ${err instanceof Error ? err.message : err}`,
					}
				}
			},
		},
		{
			name: 'cancel_schedule',
			description: 'Cancel a previously created scheduled task',
			parameters: z.object({
				id: z.string().describe('Schedule ID to cancel'),
			}),
			async execute(params) {
				const { id } = params as { id: string }
				const cancelled = scheduler.cancel(id)
				return { ok: cancelled, id }
			},
		},
		{
			name: 'list_schedules',
			description: 'List all active scheduled tasks with cron expression and next run time',
			parameters: z.object({}),
			async execute() {
				return scheduler.list()
			},
		},

		// === Heartbeat tools ===
		{
			name: 'heartbeat_read',
			description: 'Read the HEARTBEAT.md file containing recurring job definitions',
			parameters: z.object({}),
			async execute() {
				try {
					const content = await fs.readFile(heartbeatPath, 'utf-8')
					return { ok: true, content }
				} catch {
					return { ok: true, content: '' }
				}
			},
		},
		{
			name: 'heartbeat_write',
			description: 'Update the HEARTBEAT.md file with new recurring job definitions',
			parameters: z.object({
				content: z.string().describe('The full content to write to HEARTBEAT.md'),
			}),
			async execute(params) {
				const { content } = params as { content: string }
				await fs.writeFile(heartbeatPath, content, 'utf-8')
				return { ok: true }
			},
		},

		// === Skill tools (on-demand loading) ===
		{
			name: 'skill_read',
			description:
				'Read the full SKILL.md instructions for a skill by name. Use this when a skill is relevant to the current task.',
			parameters: z.object({
				name: z.string().describe('Skill name to read'),
			}),
			async execute(params) {
				const { name } = params as { name: string }
				const skill = skillRegistry.get(name)
				if (!skill) {
					return { ok: false, error: `Skill "${name}" not found` }
				}
				try {
					const content = await fs.readFile(path.join(skill.path, 'SKILL.md'), 'utf-8')
					// basePath lets the Brain resolve/execute bundled files the SKILL.md references.
					return { ok: true, name, basePath: skill.path, content }
				} catch {
					return { ok: false, error: `Failed to read SKILL.md for "${name}"` }
				}
			},
		},
		{
			name: 'skill_read_reference',
			description:
				"Read a reference file from a skill's references/ directory. Use this for API docs, schemas, or detailed guides.",
			parameters: z.object({
				name: z.string().describe('Skill name'),
				file: z.string().describe("File path relative to the skill's references/ directory"),
			}),
			async execute(params) {
				const { name, file } = params as { name: string; file: string }
				const skill = skillRegistry.get(name)
				if (!skill) {
					return { ok: false, error: `Skill "${name}" not found` }
				}
				// Prevent path traversal — append the separator so a sibling dir like
				// "references-private/" can't satisfy the prefix check.
				const refDir = path.resolve(skill.path, 'references')
				const resolved = path.resolve(refDir, file)
				if (resolved !== refDir && !resolved.startsWith(refDir + path.sep)) {
					return { ok: false, error: 'Invalid file path' }
				}
				try {
					const content = await fs.readFile(resolved, 'utf-8')
					return { ok: true, name, basePath: skill.path, file, content }
				} catch {
					return { ok: false, error: `File not found: references/${file}` }
				}
			},
		},
		{
			name: 'skill_list_files',
			description:
				"List all files in a skill's directory (scripts, references, assets). Paths are relative to the skill's basePath (also returned); run bundled scripts with skill_run_script.",
			parameters: z.object({
				name: z.string().describe('Skill name'),
			}),
			async execute(params) {
				const { name } = params as { name: string }
				const skill = skillRegistry.get(name)
				if (!skill) {
					return { ok: false, error: `Skill "${name}" not found` }
				}
				try {
					const files = await listFilesRecursive(skill.path)
					return { ok: true, name, basePath: skill.path, files }
				} catch {
					return { ok: false, error: `Failed to list files for "${name}"` }
				}
			},
		},
		{
			name: 'skill_run_script',
			description:
				"Execute a script bundled inside a skill (e.g. 'scripts/run.js'), confined to the skill's own directory. Runs with the skill's declared environment (requires.env) plus a PATH/HOME baseline — NOT the engine's full env. Interpreter by extension: .js/.mjs/.cjs → node, .py → python3/python, .sh/.bash → bash (an interpreter the skill declares in requires.bins/anyBins is preferred). Default timeout 120s (override with timeoutMs, capped at 600s). Returns exitCode, signal, and stdout/stderr (clipped to ~20k chars, head+tail).",
			parameters: z.object({
				name: z.string().describe('Skill name'),
				script: z
					.string()
					.describe("Script path relative to the skill directory, e.g. 'scripts/run.js'"),
				args: z.array(z.string()).optional().describe('Command-line arguments for the script'),
				input: z.string().optional().describe('Data written to the script on stdin'),
				timeoutMs: z
					.number()
					.int()
					.positive()
					.optional()
					.describe(
						`Max run time in ms (default ${SCRIPT_TIMEOUT_DEFAULT_MS}, capped at ${SCRIPT_TIMEOUT_MAX_MS})`,
					),
			}),
			async execute(params) {
				const { name, script, args, input, timeoutMs } = params as {
					name: string
					script: string
					args?: string[]
					input?: string
					timeoutMs?: number
				}
				const skill = skillRegistry.get(name)
				if (!skill) {
					return { ok: false, error: `Skill "${name}" not found` }
				}
				// Only run scripts for skills whose declared requirements are met — the same gate the
				// resolver uses to activate a skill. An inactive skill may be missing required env/bins.
				if (!skill.active) {
					const missing = skill.missingTools.join(', ') || 'unmet requirements'
					return {
						ok: false,
						error: `Skill "${name}" is inactive (${missing}); its scripts are not runnable.`,
					}
				}

				// Confine execution to the skill's directory: a lexical check (catches ../ traversal
				// even for non-existent targets), then realpath so an in-dir symlink can't point the
				// interpreter at a file outside the skill tree.
				const skillDir = await fs.realpath(skill.path).catch(() => path.resolve(skill.path))
				const requested = path.resolve(skillDir, script)
				if (requested !== skillDir && !requested.startsWith(skillDir + path.sep)) {
					return { ok: false, error: 'Invalid script path (must be inside the skill directory)' }
				}
				let resolved: string
				try {
					resolved = await fs.realpath(requested)
				} catch {
					return { ok: false, error: `Script not found: ${script}` }
				}
				if (resolved !== skillDir && !resolved.startsWith(skillDir + path.sep)) {
					return { ok: false, error: 'Invalid script path (symlink escapes the skill directory)' }
				}
				try {
					if (!(await fs.stat(resolved)).isFile()) {
						return { ok: false, error: `Not a file: ${script}` }
					}
				} catch {
					return { ok: false, error: `Script not found: ${script}` }
				}

				const ext = path.extname(resolved).toLowerCase()
				const extCandidates = SCRIPT_INTERPRETERS[ext]
				if (!extCandidates) {
					return {
						ok: false,
						error: `Unsupported script type "${ext || '(none)'}". Supported: ${Object.keys(SCRIPT_INTERPRETERS).join(', ')}`,
					}
				}
				// Prefer an interpreter the skill itself declares (requires.bins/anyBins) when it can
				// run this extension; otherwise fall back to the extension defaults.
				const declared = [
					...(skill.definition.requires?.bins ?? []),
					...(skill.definition.requires?.anyBins ?? []),
				].filter((b) => extCandidates.includes(b))
				const candidates = [...new Set([...declared, ...extCandidates])]
				const interpreter = await firstAvailableBinary(candidates)
				if (!interpreter) {
					return {
						ok: false,
						error: `No interpreter on PATH for ${ext} (tried ${candidates.join(', ')}).`,
					}
				}

				const timeout = Math.min(
					Math.max(1, timeoutMs ?? SCRIPT_TIMEOUT_DEFAULT_MS),
					SCRIPT_TIMEOUT_MAX_MS,
				)
				try {
					const res = await execa(interpreter, [resolved, ...(args ?? [])], {
						cwd: skillDir,
						timeout,
						maxBuffer: SCRIPT_MAX_BUFFER,
						reject: false,
						// Scope the environment — never hand a skill script the engine's full env
						// (vault key, unrelated API keys, …); only its declared vars + a safe baseline.
						env: buildScriptEnv(skill.definition.requires?.env ?? []),
						extendEnv: false,
						// Give the child an empty stdin (EOF) when no input is supplied, so a script
						// that reads stdin doesn't block until the timeout.
						...(input === undefined ? { stdin: 'ignore' as const } : { input }),
					})
					const ok = res.exitCode === 0 && !res.failed
					return {
						ok,
						script,
						interpreter,
						exitCode: res.exitCode ?? null,
						stdout: clipOutput(res.stdout ?? ''),
						stderr: clipOutput(res.stderr ?? ''),
						...(res.signal ? { signal: res.signal } : {}),
						...(res.timedOut ? { timedOut: true } : {}),
						...(res.isMaxBuffer ? { truncatedBuffer: true } : {}),
						...(!ok && res.exitCode === undefined
							? {
									error:
										res.shortMessage || `script terminated${res.signal ? ` by ${res.signal}` : ''}`,
								}
							: {}),
					}
				} catch (err) {
					return { ok: false, error: err instanceof Error ? err.message : String(err) }
				}
			},
		},

		// === Workspace tools ===
		{
			name: 'workspace_write',
			description:
				'Write a file to the workspace scratch space (.openvole/workspace/). Creates parent directories automatically.',
			parameters: z.object({
				path: z.string().optional().describe('File path relative to the workspace directory'),
				file: z.string().optional().describe('Alias for path'),
				content: z.string().describe('Content to write to the file'),
			}),
			async execute(params) {
				const p = params as { path?: string; file?: string; content: string }
				const relPath = p.path ?? p.file
				const content = p.content
				if (!relPath) return { ok: false, error: 'Missing path or file parameter' }
				const resolved = resolveWorkspacePath(relPath)
				if (!resolved) {
					return { ok: false, error: 'Invalid path — must stay inside workspace directory' }
				}
				await fs.mkdir(path.dirname(resolved), { recursive: true })
				await fs.writeFile(resolved, content, 'utf-8')
				return { ok: true, path: relPath }
			},
		},
		{
			name: 'workspace_read',
			description: 'Read a file from the workspace scratch space (.openvole/workspace/).',
			parameters: z.object({
				path: z.string().optional().describe('File path relative to the workspace directory'),
				file: z.string().optional().describe('Alias for path'),
			}),
			async execute(params) {
				const p = params as { path?: string; file?: string }
				const relPath = p.path ?? p.file
				if (!relPath) return { ok: false, error: 'Missing path or file parameter' }
				const resolved = resolveWorkspacePath(relPath)
				if (!resolved) {
					return { ok: false, error: 'Invalid path — must stay inside workspace directory' }
				}
				try {
					const content = await fs.readFile(resolved, 'utf-8')
					return { ok: true, content }
				} catch {
					return { ok: false, error: `File not found: ${relPath}` }
				}
			},
		},
		{
			name: 'workspace_list',
			description:
				'List files and directories in the workspace scratch space (.openvole/workspace/). Returns recursive listing with file sizes.',
			parameters: z.object({
				path: z
					.string()
					.optional()
					.describe('Subdirectory to list (relative to workspace root). Defaults to root.'),
			}),
			async execute(params) {
				const { path: relPath } = params as { path?: string }
				const resolved = relPath ? resolveWorkspacePath(relPath) : workspaceDir
				if (!resolved) {
					return { ok: false, error: 'Invalid path — must stay inside workspace directory' }
				}
				try {
					const files = await listFilesWithSizes(resolved)
					return { ok: true, files }
				} catch {
					return { ok: true, files: [] }
				}
			},
		},
		{
			name: 'workspace_delete',
			description:
				'Delete a file or directory from the workspace scratch space (.openvole/workspace/).',
			parameters: z.object({
				path: z
					.string()
					.optional()
					.describe('File or directory path relative to the workspace directory'),
				file: z.string().optional().describe('Alias for path'),
			}),
			async execute(params) {
				const p = params as { path?: string; file?: string }
				const relPath = p.path ?? p.file
				if (!relPath) return { ok: false, error: 'Missing path or file parameter' }
				const resolved = resolveWorkspacePath(relPath)
				if (!resolved) {
					return { ok: false, error: 'Invalid path — must stay inside workspace directory' }
				}
				try {
					await fs.rm(resolved, { recursive: true })
					return { ok: true }
				} catch {
					return { ok: false, error: `Not found: ${relPath}` }
				}
			},
		},

		// === Vault tools ===
		{
			name: 'vault_store',
			description:
				'Store a key-value pair in the secure vault with context metadata. Write-once: fails if key already exists (delete first to update).',
			parameters: z.object({
				key: z.string().describe('Key name for the stored value'),
				value: z.string().describe('Value to store (will be encrypted if VOLE_VAULT_KEY is set)'),
				source: z
					.enum(['user', 'tool', 'brain'])
					.optional()
					.describe('Who stored this value. Defaults to brain.'),
				meta: z
					.record(z.string())
					.optional()
					.describe(
						'Context metadata — e.g. { "service": "vibegigs", "handle": "bumblebee", "url": "https://vibegigs.com" }',
					),
			}),
			async execute(params) {
				const { key, value, source, meta } = params as {
					key: string
					value: string
					source?: string
					meta?: Record<string, string>
				}
				const ok = await vault.store(key, value, source ?? 'brain', meta)
				if (!ok) {
					return { ok: false, error: 'Key already exists' }
				}
				return { ok: true, key }
			},
		},
		{
			name: 'vault_get',
			description: 'Retrieve a value from the secure vault by key.',
			parameters: z.object({
				key: z.string().describe('Key name to retrieve'),
			}),
			async execute(params) {
				const { key } = params as { key: string }
				const value = await vault.get(key)
				if (value === null) {
					return { ok: false, error: `Key not found: ${key}` }
				}
				return { ok: true, value }
			},
		},
		{
			name: 'vault_list',
			description:
				'List all keys in the vault with their sources and creation dates. Never returns values.',
			parameters: z.object({}),
			async execute() {
				const entries = await vault.list()
				return { ok: true, entries }
			},
		},
		{
			name: 'vault_delete',
			description: 'Delete a key from the secure vault.',
			parameters: z.object({
				key: z.string().describe('Key name to delete'),
			}),
			async execute(params) {
				const { key } = params as { key: string }
				const ok = await vault.delete(key)
				if (!ok) {
					return { ok: false, error: `Key not found: ${key}` }
				}
				return { ok: true }
			},
		},

		// === Sub-agent tools ===
		{
			name: 'spawn_agent',
			description:
				'Spawn a sub-agent to handle a sub-task independently. Returns a task ID. Supports named agent profiles (defined in vole.config.json "agents" section) with role-based tool restrictions. Sub-agents can spawn one level of sub-sub-agents (max depth 2).',
			parameters: z.object({
				task: z.string().describe('The task description for the sub-agent'),
				agent: z
					.string()
					.optional()
					.describe(
						'Named agent profile from config (e.g. "researcher", "writer"). If not set, uses default with all tools.',
					),
				max_iterations: z
					.number()
					.optional()
					.describe('Iteration limit for the sub-agent. Defaults to profile setting or 10.'),
				context: z
					.string()
					.optional()
					.describe(
						'Additional context to pass to the sub-agent (e.g. key facts, constraints). Injected as a system message before the task.',
					),
				priority: z
					.enum(['urgent', 'normal', 'low'])
					.optional()
					.describe('Task priority. Default: normal.'),
			}),
			async execute(params) {
				const {
					task: taskInput,
					agent: agentName,
					max_iterations,
					context: parentContext,
					priority,
				} = params as {
					task: string
					agent?: string
					max_iterations?: number
					context?: string
					priority?: 'urgent' | 'normal' | 'low'
				}

				// Depth check: allow 2 levels (parent → child → grandchild)
				const runningTasks = taskQueue.getRunning()
				const callerTask = runningTasks[0]
				const callerDepth = (callerTask?.metadata?.agentDepth as number) ?? 0
				const MAX_SPAWN_DEPTH = 2

				if (callerDepth >= MAX_SPAWN_DEPTH) {
					return {
						ok: false,
						error: `Max agent spawn depth (${MAX_SPAWN_DEPTH}) reached. Handle this sub-task directly.`,
					}
				}

				// Resolve agent profile from config
				const config = callerTask?.metadata?.voleConfig as Record<string, unknown> | undefined
				const agents = config?.agents as
					| Record<string, import('../config/index.js').AgentProfile>
					| undefined
				const profile = agentName && agents ? agents[agentName] : undefined

				if (agentName && !profile) {
					return {
						ok: false,
						error: `Agent profile "${agentName}" not found. Available: ${agents ? Object.keys(agents).join(', ') : 'none configured'}`,
					}
				}

				const iterations = max_iterations ?? profile?.maxIterations ?? 10

				// Build metadata for the child task
				const metadata: Record<string, unknown> = {
					maxIterations: iterations,
					agentDepth: callerDepth + 1,
					voleConfig: config,
				}

				// Pass tool restrictions from profile
				if (profile?.allowTools) metadata.allowTools = profile.allowTools
				if (profile?.denyTools) metadata.denyTools = profile.denyTools

				// Pass context and instructions
				if (parentContext) metadata.parentContext = parentContext
				if (profile?.instructions) metadata.agentInstructions = profile.instructions
				if (profile?.role) metadata.agentRole = profile.role

				const parentTaskId = callerTask?.id

				const agentTask = taskQueue.enqueue(taskInput, 'agent', {
					parentTaskId,
					metadata,
					priority: priority as import('../core/task.js').TaskPriority | undefined,
				})

				return {
					ok: true,
					task_id: agentTask.id,
					status: 'queued',
					agent: agentName ?? 'default',
					depth: callerDepth + 1,
				}
			},
		},
		{
			name: 'get_agent_result',
			description:
				'Check the status and result of a spawned sub-agent task. Returns status, result, and cost metrics when available.',
			parameters: z.object({
				task_id: z.string().describe('The task ID returned by spawn_agent'),
			}),
			async execute(params) {
				const { task_id } = params as { task_id: string }
				const agentTask = taskQueue.get(task_id)

				if (!agentTask) {
					return { ok: false, error: 'Task not found' }
				}

				const base = {
					ok: true,
					status: agentTask.status,
					task_id: agentTask.id,
				}

				if (agentTask.status === 'queued' || agentTask.status === 'running') {
					return base
				}

				if (agentTask.status === 'completed') {
					const cost = agentTask.metadata?.cost as Record<string, unknown> | undefined
					return {
						...base,
						result: agentTask.result ?? null,
						duration_ms:
							agentTask.completedAt && agentTask.startedAt
								? agentTask.completedAt - agentTask.startedAt
								: undefined,
						cost: cost
							? {
									llm_calls: cost.llmCalls,
									total_tokens:
										((cost.totalInputTokens as number) ?? 0) +
										((cost.totalOutputTokens as number) ?? 0),
									total_cost: cost.totalCost,
								}
							: undefined,
					}
				}

				if (agentTask.status === 'failed') {
					return { ...base, error: agentTask.error ?? 'Unknown error' }
				}

				return base
			},
		},
		{
			name: 'wait_for_agents',
			description:
				'Wait for one or more spawned sub-agent tasks to complete. Returns all results once all are done (or any fails/times out).',
			parameters: z.object({
				task_ids: z.array(z.string()).describe('Array of task IDs from spawn_agent'),
				timeout_ms: z
					.number()
					.optional()
					.default(120000)
					.describe('Maximum wait time in milliseconds. Default: 120000 (2 minutes).'),
			}),
			async execute(params) {
				const { task_ids, timeout_ms } = params as { task_ids: string[]; timeout_ms: number }
				const startTime = Date.now()

				// Poll until all complete or timeout
				while (Date.now() - startTime < timeout_ms) {
					const results = task_ids.map((id) => {
						const task = taskQueue.get(id)
						if (!task) return { task_id: id, status: 'not_found' as const }
						return {
							task_id: id,
							status: task.status,
							result: task.status === 'completed' ? (task.result ?? null) : undefined,
							error: task.status === 'failed' ? (task.error ?? 'Unknown error') : undefined,
						}
					})

					const allDone = results.every(
						(r) =>
							r.status === 'completed' ||
							r.status === 'failed' ||
							r.status === 'cancelled' ||
							r.status === 'not_found',
					)

					if (allDone) {
						return { ok: true, results }
					}

					// Wait 500ms before checking again
					await new Promise((resolve) => setTimeout(resolve, 500))
				}

				// Timeout — return current state
				const finalResults = task_ids.map((id) => {
					const task = taskQueue.get(id)
					return {
						task_id: id,
						status: task?.status ?? 'not_found',
						result: task?.status === 'completed' ? (task.result ?? null) : undefined,
						error: task?.status === 'failed' ? (task.error ?? null) : undefined,
					}
				})

				return {
					ok: false,
					error: `Timeout after ${timeout_ms}ms`,
					results: finalResults,
				}
			},
		},

		// === VoleNet tools ===
		{
			name: 'list_instances',
			description:
				'List all connected VoleNet peer instances with their capabilities, roles, and status. Only available when VoleNet is enabled.',
			parameters: z.object({}),
			async execute() {
				const voleNet = (globalThis as any).__volenet__
				if (!voleNet?.isActive()) {
					return {
						ok: false,
						error: 'VoleNet is not enabled. Set net.enabled: true in vole.config.json',
					}
				}
				const instances = voleNet.getInstances()
				const remoteTools = voleNet.getRemoteTools()
				return {
					ok: true,
					instances: instances.map((i: any) => ({
						id: i.id.substring(0, 8),
						name: i.name,
						role: i.role,
						capabilities: i.capabilities,
						lastSeen: i.lastSeen,
					})),
					remoteToolCount: remoteTools.length,
				}
			},
		},
		{
			name: 'spawn_remote_agent',
			description:
				'Delegate a task to a remote VoleNet peer. The remote instance runs the task independently and returns the result. Use list_instances to see available peers.',
			parameters: z.object({
				task: z.string().describe('Task description for the remote agent'),
				instance: z
					.string()
					.optional()
					.describe('Target instance name or ID. If omitted, auto-selects best peer.'),
				max_iterations: z.number().optional().describe('Max iterations on remote (default: 10)'),
				timeout_ms: z.number().optional().describe('Timeout in ms (default: 300000 = 5 minutes)'),
			}),
			async execute(params) {
				const {
					task: taskInput,
					instance,
					max_iterations,
					timeout_ms,
				} = params as {
					task: string
					instance?: string
					max_iterations?: number
					timeout_ms?: number
				}
				const voleNet = (globalThis as any).__volenet__
				if (!voleNet?.isActive()) {
					return { ok: false, error: 'VoleNet is not enabled' }
				}

				const remoteTaskMgr = voleNet.getRemoteTaskManager()
				if (!remoteTaskMgr) {
					return { ok: false, error: 'Remote task manager not initialized' }
				}

				// Resolve target instance
				let targetId: string | null = null
				if (instance) {
					const instances = voleNet.getInstances()
					const target = instances.find(
						(i: any) => i.name === instance || i.id.startsWith(instance),
					)
					targetId = target?.id ?? null
				} else {
					// Auto-select: pick peer with lowest load
					const instances = voleNet.getInstances()
					if (instances.length > 0) {
						targetId = instances.sort((a: any, b: any) => a.load - b.load)[0].id
					}
				}

				if (!targetId) {
					return {
						ok: false,
						error: `No peer found${instance ? `: "${instance}"` : ''}. Use list_instances to see available peers.`,
					}
				}

				const result = await remoteTaskMgr.delegateTask(
					targetId,
					{
						taskId: '',
						input: taskInput,
						maxIterations: max_iterations,
					},
					timeout_ms ?? 300_000,
				)

				return { ok: true, ...result }
			},
		},
		{
			name: 'net_message',
			description:
				"Send a chat message to another VoleNet node and get its agent's reply. Conversational — the peer's agent sees it as a message from you. Use list_instances to find peers. (Uses the peer's brain, so the peer must allow brain access for you.)",
			parameters: z.object({
				to: z.string().describe('Target instance name or ID (see list_instances)'),
				text: z.string().describe('The message to send'),
				timeout_ms: z.number().optional().describe('Reply timeout in ms (default 120000)'),
			}),
			async execute(params) {
				const { to, text, timeout_ms } = params as {
					to: string
					text: string
					timeout_ms?: number
				}
				const voleNet = (globalThis as any).__volenet__
				if (!voleNet?.isActive()) {
					return { ok: false, error: 'VoleNet is not enabled' }
				}
				const remoteTaskMgr = voleNet.getRemoteTaskManager()
				if (!remoteTaskMgr) {
					return { ok: false, error: 'Remote task manager not initialized' }
				}
				const instances = voleNet.getInstances()
				const target = instances.find((i: any) => i.name === to || i.id.startsWith(to))
				if (!target) {
					return { ok: false, error: `No peer found: "${to}". Use list_instances to see peers.` }
				}
				const result = await remoteTaskMgr.delegateTask(
					target.id,
					{ taskId: '', input: text, fromName: voleNet.getInstanceName() },
					timeout_ms ?? 120_000,
				)
				if (result.status === 'completed') {
					return { ok: true, from: target.name, reply: result.result }
				}
				return { ok: false, from: target.name, status: result.status, error: result.error }
			},
		},
		{
			name: 'get_remote_result',
			description: 'Check the status of a remote VoleNet task.',
			parameters: z.object({
				task_id: z.string().describe('Remote task ID from spawn_remote_agent'),
			}),
			async execute(_params) {
				// Remote results are returned inline by spawn_remote_agent (it waits)
				// This tool exists for future async delegation
				return {
					ok: false,
					error: 'spawn_remote_agent returns results directly. Use it instead.',
				}
			},
		},

		// === Web tools ===
		{
			name: 'web_fetch',
			description:
				'Fetch a URL and return its content as text. Use for APIs, web pages, JSON endpoints, or downloading text content. Much lighter than browser_navigate — use this when you just need the content, not browser interaction.',
			parameters: z.object({
				url: z.string().describe('The URL to fetch'),
				method: z
					.enum(['GET', 'POST', 'PUT', 'DELETE'])
					.optional()
					.describe('HTTP method. Defaults to GET.'),
				headers: z
					.record(z.string())
					.optional()
					.describe('Request headers (e.g. { "Authorization": "Bearer ..." })'),
				body: z.string().optional().describe('Request body for POST/PUT'),
			}),
			async execute(params) {
				const { url, method, headers, body } = params as {
					url: string
					method?: string
					headers?: Record<string, string>
					body?: string
				}
				try {
					const response = await fetch(url, {
						method: method ?? 'GET',
						headers,
						body,
					})

					const contentType = response.headers.get('content-type') ?? ''
					const text = await response.text()

					// Truncate very large responses
					const maxLen = 50_000
					const content =
						text.length > maxLen
							? `${text.substring(0, maxLen)}\n\n[Truncated — ${text.length} chars total]`
							: text

					return {
						ok: response.ok,
						status: response.status,
						contentType,
						content,
					}
				} catch (err) {
					return {
						ok: false,
						error: err instanceof Error ? err.message : String(err),
					}
				}
			},
		},
		// === Tool Horizon ===
		...(toolRegistry
			? [
					{
						name: 'discover_tools',
						description:
							'Discover tools by intent. Searches all registered tools by description and returns matching ones. Discovered tools become available for use in subsequent iterations. Use when you need a tool that is not currently visible.',
						parameters: z.object({
							intent: z
								.string()
								.optional()
								.describe(
									'What you want to do (e.g. "send an email", "browse a website", "take a screenshot")',
								),
							paw: z
								.string()
								.optional()
								.describe(
									'Load all tools from a specific paw (e.g. "paw-browser", "@openvole/paw-email")',
								),
							all: z
								.boolean()
								.optional()
								.describe('Load ALL tools into the horizon (use as fallback)'),
						}),
						async execute(params) {
							const { intent, paw, all } = params as {
								intent?: string
								paw?: string
								all?: boolean
							}

							if (all) {
								const allTools = toolRegistry.list().map((t) => t.name)
								toolRegistry.addToHorizon(allTools)
								return {
									ok: true,
									discovered: allTools.length,
									message: 'All tools are now visible.',
								}
							}

							if (paw) {
								const pawName = paw.startsWith('@openvole/') ? paw : `@openvole/${paw}`
								const pawTools = toolRegistry.toolsForPaw(pawName)
								if (pawTools.length === 0) {
									return {
										ok: false,
										error: `No tools found for paw "${pawName}"`,
									}
								}
								toolRegistry.addToHorizon(pawTools)
								return {
									ok: true,
									discovered: pawTools.length,
									tools: pawTools,
								}
							}

							if (intent) {
								// BM25 search + skill matching
								const results = toolRegistry.searchTools(intent, 15)

								// Also check skills for matching required tools
								const activeSkills = skillRegistry.active()
								for (const skill of activeSkills) {
									const desc = `${skill.name} ${skill.definition.description}`.toLowerCase()
									const intentLower = intent.toLowerCase()
									if (intentLower.split(/\s+/).some((word) => desc.includes(word))) {
										for (const toolName of skill.definition.requiredTools) {
											if (toolRegistry.has(toolName) && !results.find((r) => r.name === toolName)) {
												results.push({
													name: toolName,
													description: toolRegistry.get(toolName)?.description ?? '',
													pawName: toolRegistry.get(toolName)?.pawName ?? '',
													score: 0.5,
												})
											}
										}
									}
								}

								if (results.length === 0) {
									return {
										ok: true,
										discovered: 0,
										message:
											'No matching tools found. Try a different intent or use discover_tools({ all: true }).',
									}
								}

								// Pull in ALL tools from matching paws — if you need one tool from a paw,
								// you likely need the others (e.g. computer_click → all computer_* tools)
								const matchedPaws = new Set(results.map((r) => r.pawName))
								const toolNames: string[] = []
								for (const pawName of matchedPaws) {
									toolNames.push(...toolRegistry.toolsForPaw(pawName))
								}
								// Also add any direct BM25 matches not covered by paw expansion
								for (const r of results) {
									if (!toolNames.includes(r.name)) toolNames.push(r.name)
								}
								toolRegistry.addToHorizon(toolNames)
								return {
									ok: true,
									discovered: toolNames.length,
									tools: results.map((r) => ({
										name: r.name,
										description: r.description,
										paw: r.pawName,
										score: Math.round(r.score * 100) / 100,
									})),
								}
							}

							return {
								ok: false,
								error: 'Provide intent, paw, or all parameter.',
							}
						},
					} as ToolDefinition,
				]
			: []),
	]
}

/** Recursively list files relative to a directory */
async function listFilesRecursive(dir: string, prefix = ''): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true })
	const files: string[] = []
	for (const entry of entries) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.isDirectory()) {
			files.push(...(await listFilesRecursive(path.join(dir, entry.name), rel)))
		} else {
			files.push(rel)
		}
	}
	return files
}

/** Async PATH probe (returns the first available binary) — doesn't block the event loop. */
async function firstAvailableBinary(candidates: string[]): Promise<string | undefined> {
	const probe = process.platform === 'win32' ? 'where' : 'which'
	for (const bin of candidates) {
		const res = await execa(probe, [bin], { reject: false, timeout: 2000, stdin: 'ignore' })
		if (res.exitCode === 0) return bin
	}
	return undefined
}

/** Build a scoped env for a skill script: a safe baseline plus the skill's declared vars only. */
function buildScriptEnv(declaredEnv: string[]): Record<string, string> {
	const env: Record<string, string> = {}
	for (const key of [...SCRIPT_ENV_BASELINE, ...declaredEnv]) {
		const value = process.env[key]
		if (value !== undefined) env[key] = value
	}
	return env
}

/** Clip long output to ~MAX_SCRIPT_OUTPUT chars, keeping head + tail, without splitting a surrogate pair. */
function clipOutput(s: string): string {
	if (s.length <= MAX_SCRIPT_OUTPUT) return s
	const head = Math.ceil(MAX_SCRIPT_OUTPUT * 0.6)
	const tail = MAX_SCRIPT_OUTPUT - head
	const dropped = s.length - MAX_SCRIPT_OUTPUT
	return `${safeSlice(s, 0, head)}\n… [${dropped} chars truncated] …\n${safeSlice(s, s.length - tail, s.length)}`
}

/** Slice by UTF-16 units but never leave a lone surrogate at either cut edge. */
function safeSlice(s: string, start: number, end: number): string {
	let a = start
	let b = end
	// A low surrogate at the start would be orphaned from its high surrogate.
	if (a > 0 && a < s.length && s.charCodeAt(a) >= 0xdc00 && s.charCodeAt(a) <= 0xdfff) a++
	// A high surrogate just before the end would be orphaned from its low surrogate.
	if (b > 0 && b < s.length && s.charCodeAt(b - 1) >= 0xd800 && s.charCodeAt(b - 1) <= 0xdbff) b--
	return s.slice(a, b)
}

/** Recursively list files with sizes relative to a directory */
async function listFilesWithSizes(
	dir: string,
	prefix = '',
): Promise<Array<{ path: string; size: number; type: 'file' | 'directory' }>> {
	const entries = await fs.readdir(dir, { withFileTypes: true })
	const results: Array<{ path: string; size: number; type: 'file' | 'directory' }> = []
	for (const entry of entries) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name
		const fullPath = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			results.push({ path: rel, size: 0, type: 'directory' })
			results.push(...(await listFilesWithSizes(fullPath, rel)))
		} else {
			const stat = await fs.stat(fullPath)
			results.push({ path: rel, size: stat.size, type: 'file' })
		}
	}
	return results
}
