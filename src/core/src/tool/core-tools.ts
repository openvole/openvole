import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition } from './types.js'
import type { SchedulerStore } from '../core/scheduler.js'
import type { TaskQueue } from '../core/task.js'
import type { SkillRegistry } from '../skill/registry.js'

/** Create the built-in core tools that are always available to the Brain */
export function createCoreTools(
	scheduler: SchedulerStore,
	taskQueue: TaskQueue,
	projectRoot: string,
	skillRegistry: SkillRegistry,
): ToolDefinition[] {
	const heartbeatPath = path.resolve(projectRoot, 'HEARTBEAT.md')

	return [
		// === Scheduling tools ===
		{
			name: 'schedule_task',
			description: 'Create a recurring scheduled task that runs at a fixed interval',
			parameters: z.object({
				id: z.string().describe('Unique schedule ID (for cancellation)'),
				input: z.string().describe('The task input to enqueue each time'),
				intervalMinutes: z.number().describe('How often to run (in minutes)'),
			}),
			async execute(params) {
				const { id, input, intervalMinutes } = params as {
					id: string
					input: string
					intervalMinutes: number
				}
				scheduler.add(id, input, intervalMinutes, () => {
					taskQueue.enqueue(input, 'schedule')
				})
				return { ok: true, id, intervalMinutes }
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
			description: 'List all active scheduled tasks',
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
