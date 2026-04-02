import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import type { SchedulerStore } from '../core/scheduler.js'
import type { TaskQueue } from '../core/task.js'
import type { Vault } from '../core/vault.js'
import type { SkillRegistry } from '../skill/registry.js'
import type { ToolRegistry } from './registry.js'
import type { ToolDefinition } from './types.js'

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
					return { ok: true, name, content }
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
				// Prevent path traversal
				const resolved = path.resolve(skill.path, 'references', file)
				if (!resolved.startsWith(path.resolve(skill.path, 'references'))) {
					return { ok: false, error: 'Invalid file path' }
				}
				try {
					const content = await fs.readFile(resolved, 'utf-8')
					return { ok: true, name, file, content }
				} catch {
					return { ok: false, error: `File not found: references/${file}` }
				}
			},
		},
		{
			name: 'skill_list_files',
			description:
				"List all files in a skill's directory including scripts, references, and assets.",
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
					return { ok: true, name, files }
				} catch {
					return { ok: false, error: `Failed to list files for "${name}"` }
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
			name: 'get_remote_result',
			description: 'Check the status of a remote VoleNet task.',
			parameters: z.object({
				task_id: z.string().describe('Remote task ID from spawn_remote_agent'),
			}),
			async execute(params) {
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
							? text.substring(0, maxLen) + `\n\n[Truncated — ${text.length} chars total]`
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
