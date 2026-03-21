import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition } from './types.js'
import type { SchedulerStore } from '../core/scheduler.js'
import type { TaskQueue } from '../core/task.js'
import type { SkillRegistry } from '../skill/registry.js'
import type { Vault } from '../core/vault.js'

/** Create the built-in core tools that are always available to the Brain */
export function createCoreTools(
	scheduler: SchedulerStore,
	taskQueue: TaskQueue,
	projectRoot: string,
	skillRegistry: SkillRegistry,
	vault: Vault,
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
			description: 'Create a recurring scheduled task using a cron expression. Examples: "0 13 * * *" = daily at 1 PM UTC, "*/30 * * * *" = every 30 minutes, "0 9 * * 1" = every Monday at 9 AM UTC.',
			parameters: z.object({
				id: z.string().describe('Unique schedule ID (for cancellation)'),
				input: z.string().describe('The task input to enqueue each time'),
				cron: z.string().describe('Cron expression in UTC (minute hour day month weekday). Examples: "0 13 * * *" for daily 1 PM, "*/30 * * * *" for every 30 min'),
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
					return { ok: false, error: `Invalid cron expression: ${err instanceof Error ? err.message : err}` }
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
			description: 'Read the full SKILL.md instructions for a skill by name. Use this when a skill is relevant to the current task.',
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
					const content = await fs.readFile(
						path.join(skill.path, 'SKILL.md'),
						'utf-8',
					)
					return { ok: true, name, content }
				} catch {
					return { ok: false, error: `Failed to read SKILL.md for "${name}"` }
				}
			},
		},
		{
			name: 'skill_read_reference',
			description: 'Read a reference file from a skill\'s references/ directory. Use this for API docs, schemas, or detailed guides.',
			parameters: z.object({
				name: z.string().describe('Skill name'),
				file: z.string().describe('File path relative to the skill\'s references/ directory'),
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
			description: 'List all files in a skill\'s directory including scripts, references, and assets.',
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
			description: 'Write a file to the workspace scratch space (.openvole/workspace/). Creates parent directories automatically.',
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
			description: 'List files and directories in the workspace scratch space (.openvole/workspace/). Returns recursive listing with file sizes.',
			parameters: z.object({
				path: z.string().optional().describe('Subdirectory to list (relative to workspace root). Defaults to root.'),
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
			description: 'Delete a file or directory from the workspace scratch space (.openvole/workspace/).',
			parameters: z.object({
				path: z.string().optional().describe('File or directory path relative to the workspace directory'),
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
			description: 'Store a key-value pair in the secure vault with context metadata. Write-once: fails if key already exists (delete first to update).',
			parameters: z.object({
				key: z.string().describe('Key name for the stored value'),
				value: z.string().describe('Value to store (will be encrypted if VOLE_VAULT_KEY is set)'),
				source: z.enum(['user', 'tool', 'brain']).optional().describe('Who stored this value. Defaults to brain.'),
				meta: z.record(z.string()).optional().describe('Context metadata — e.g. { "service": "vibegigs", "handle": "bumblebee", "url": "https://vibegigs.com" }'),
			}),
			async execute(params) {
				const { key, value, source, meta } = params as { key: string; value: string; source?: string; meta?: Record<string, string> }
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
			description: 'List all keys in the vault with their sources and creation dates. Never returns values.',
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

		// === Web tools ===
		{
			name: 'web_fetch',
			description: 'Fetch a URL and return its content as text. Use for APIs, web pages, JSON endpoints, or downloading text content. Much lighter than browser_navigate — use this when you just need the content, not browser interaction.',
			parameters: z.object({
				url: z.string().describe('The URL to fetch'),
				method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().describe('HTTP method. Defaults to GET.'),
				headers: z.record(z.string()).optional().describe('Request headers (e.g. { "Authorization": "Bearer ..." })'),
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
					const content = text.length > maxLen
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
	]
}

/** Recursively list files relative to a directory */
async function listFilesRecursive(dir: string, prefix = ''): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true })
	const files: string[] = []
	for (const entry of entries) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.isDirectory()) {
			files.push(...await listFilesRecursive(path.join(dir, entry.name), rel))
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
