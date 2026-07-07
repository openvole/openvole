import { z } from 'zod'
import type { ToolDefinition } from './types.js'

/**
 * Orchestrator tools: let a space flagged `orchestrator` in the spaces registry supervise
 * its siblings through the ControlPlane parent (reverse-RPC over the IPC channel). Only
 * registered when the daemon runs under `vole serve` with VOLE_ORCHESTRATOR=1; the parent
 * re-checks the registry flag on every request, so these fail cleanly if authority is revoked.
 */

/** Identity files an orchestrator may write. BRAIN.md is deliberately excluded (brain-owned). */
const IDENTITY_TARGETS = ['SOUL.md', 'USER.md', 'AGENT.md', 'HEARTBEAT.md'] as const

export function createOrchestrateTools(
	callParent: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
	selfSpaceId: string,
): ToolDefinition[] {
	// Tools never throw — parent/transport errors come back as { ok:false, error }.
	const run = async (
		method: string,
		params?: Record<string, unknown>,
	): Promise<Record<string, unknown>> => {
		try {
			const r = await callParent(method, params)
			return typeof r === 'object' && r !== null
				? (r as Record<string, unknown>)
				: { ok: true, result: r }
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) }
		}
	}

	// Fast-fail UX guard; the parent's check (against resolved ids) stays authoritative.
	const guardSelf = (target: string, op: string): Record<string, unknown> | undefined =>
		target === selfSpaceId
			? { ok: false, error: `Refusing to ${op} your own space ("${selfSpaceId}")` }
			: undefined

	return [
		{
			name: 'space_list',
			description:
				'List all sibling spaces in this vole server: id, name, running/stopped state, and whether each is an orchestrator. Start here before any other space_* call.',
			parameters: z.object({}),
			async execute() {
				const r = await run('list')
				return Array.isArray(r) ? { ok: true, spaces: r } : r
			},
		},
		{
			name: 'space_state',
			description:
				'Summarized live state of a running sibling space: paw health, active/inactive skills, recent tasks (with status), queue counts, and schedules. Use space_task_status to read a specific task result.',
			parameters: z.object({
				target: z.string().describe('Space id or name'),
			}),
			async execute(params) {
				const { target } = params as { target: string }
				return run('state', { target })
			},
		},
		{
			name: 'space_task_status',
			description:
				'Status and result of a task previously submitted to a sibling space with space_submit. Poll this (e.g. on your heartbeat) instead of busy-looping; the result text is clipped to ~8k chars.',
			parameters: z.object({
				target: z.string().describe('Space id or name'),
				taskId: z.string().describe('The taskId returned by space_submit'),
			}),
			async execute(params) {
				const { target, taskId } = params as { target: string; taskId: string }
				return run('task_status', { target, taskId })
			},
		},
		{
			name: 'space_submit',
			description:
				'Submit a task (a prompt) to a running sibling space. Write a self-contained brief — the sibling has none of your context. Returns a taskId to poll with space_task_status. Reuse one stable sessionId per ongoing project so the sibling keeps continuity.',
			parameters: z.object({
				target: z.string().describe('Space id or name'),
				input: z.string().describe('The task brief — self-contained, with all needed context'),
				sessionId: z
					.string()
					.optional()
					.describe('Stable session key for conversational continuity (e.g. a project slug)'),
			}),
			async execute(params) {
				const { target, input, sessionId } = params as {
					target: string
					input: string
					sessionId?: string
				}
				return run('submit', { target, input, sessionId })
			},
		},
		{
			name: 'space_read_config',
			description: "Read a running sibling space's vole.config.json.",
			parameters: z.object({
				target: z.string().describe('Space id or name'),
			}),
			async execute(params) {
				const { target } = params as { target: string }
				const r = await run('read_config', { target })
				return 'ok' in r || 'error' in r ? r : { ok: true, config: r }
			},
		},
		{
			name: 'space_write_config',
			description:
				"Replace a running sibling space's vole.config.json. Pass the FULL config (read it first, modify, write back). Weakening the sandbox (security.sandboxFilesystem / allowedPaths) is refused. Changes apply after space_restart.",
			parameters: z.object({
				target: z.string().describe('Space id or name'),
				config: z.record(z.any()).describe('The complete new vole.config.json contents'),
			}),
			async execute(params) {
				const { target, config } = params as { target: string; config: Record<string, unknown> }
				return run('write_config', { target, config })
			},
		},
		{
			name: 'space_read_identity',
			description:
				"Read a running sibling space's identity files (SOUL.md, USER.md, AGENT.md, HEARTBEAT.md, BRAIN.md) — its role, temperament, and recurring duties.",
			parameters: z.object({
				target: z.string().describe('Space id or name'),
			}),
			async execute(params) {
				const { target } = params as { target: string }
				const r = await run('read_identity', { target })
				return 'ok' in r || 'error' in r ? r : { ok: true, files: r }
			},
		},
		{
			name: 'space_write_identity',
			description:
				"Write one identity file of a running sibling space — this is how you define or update its project brief: AGENT.md (role/duties), SOUL.md (temperament), USER.md (who it serves), HEARTBEAT.md (recurring jobs). Read first, write the FULL file back. Takes effect on the sibling's next task.",
			parameters: z.object({
				target: z.string().describe('Space id or name'),
				filename: z.enum(IDENTITY_TARGETS).describe('Which identity file to write'),
				content: z.string().describe('The complete new file contents'),
			}),
			async execute(params) {
				const { target, filename, content } = params as {
					target: string
					filename: string
					content: string
				}
				return run('write_identity', { target, filename, content })
			},
		},
		{
			name: 'space_restart',
			description:
				"Restart a sibling space's engine in place so it rereads vole.config.json and identity files. Check space_state for running tasks first. Cannot target your own space.",
			parameters: z.object({
				target: z.string().describe('Space id or name'),
			}),
			async execute(params) {
				const { target } = params as { target: string }
				return guardSelf(target, 'restart') ?? run('restart', { target })
			},
		},
		{
			name: 'space_start',
			description: 'Start a stopped sibling space (no-op if already running).',
			parameters: z.object({
				target: z.string().describe('Space id or name'),
			}),
			async execute(params) {
				const { target } = params as { target: string }
				return guardSelf(target, 'start') ?? run('start', { target })
			},
		},
		{
			name: 'space_stop',
			description:
				'Stop a running sibling space. Check space_state for running tasks first — stopping kills them. Cannot target your own space.',
			parameters: z.object({
				target: z.string().describe('Space id or name'),
			}),
			async execute(params) {
				const { target } = params as { target: string }
				return guardSelf(target, 'stop') ?? run('stop', { target })
			},
		},
		{
			name: 'space_create',
			description:
				'Create a new sibling space (scaffolded from the server template if one exists). It starts stopped and WITHOUT orchestrator authority; call space_start next, then define it with space_write_identity.',
			parameters: z.object({
				name: z.string().describe('Human-friendly space name (id becomes its slug)'),
			}),
			async execute(params) {
				const { name } = params as { name: string }
				return run('create', { name })
			},
		},
	]
}
