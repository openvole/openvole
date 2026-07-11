import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOrchestrateTools } from '../../src/tool/orchestrate-tools.js'
import type { ToolDefinition } from '../../src/tool/types.js'

const ALL_TOOLS = [
	'agent_list',
	'agent_state',
	'agent_task_status',
	'agent_submit',
	'agent_read_config',
	'agent_write_config',
	'agent_read_identity',
	'agent_write_identity',
	'agent_restart',
	'agent_start',
	'agent_stop',
	'agent_create',
]

describe('createOrchestrateTools', () => {
	let callParent: ReturnType<typeof vi.fn>
	let tools: ToolDefinition[]

	beforeEach(() => {
		callParent = vi.fn(async (method: string, params?: Record<string, unknown>) => ({
			ok: true,
			method,
			params,
		}))
		tools = createOrchestrateTools(callParent, 'boss')
	})

	function findTool(name: string): ToolDefinition {
		const tool = tools.find((t) => t.name === name)
		if (!tool) throw new Error(`Tool "${name}" not found`)
		return tool
	}

	it('returns all 12 agent tools, fully shaped', () => {
		expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOLS].sort())
		for (const t of tools) {
			expect(t.description.length).toBeGreaterThan(20)
			expect(t.parameters).toBeDefined()
			expect(typeof t.execute).toBe('function')
		}
	})

	it('agent_list forwards to list and wraps array results', async () => {
		callParent.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
		const r = (await findTool('agent_list').execute({})) as Record<string, unknown>
		expect(callParent).toHaveBeenCalledWith('list', undefined)
		expect(r.ok).toBe(true)
		expect(r.agents).toHaveLength(2)
	})

	it('agent_submit forwards target, input, and sessionId', async () => {
		await findTool('agent_submit').execute({
			target: 'worker',
			input: 'do the thing',
			sessionId: 'proj-1',
		})
		expect(callParent).toHaveBeenCalledWith('submit', {
			target: 'worker',
			input: 'do the thing',
			sessionId: 'proj-1',
		})
	})

	it('agent_task_status forwards target and taskId', async () => {
		await findTool('agent_task_status').execute({ target: 'worker', taskId: 't-42' })
		expect(callParent).toHaveBeenCalledWith('task_status', { target: 'worker', taskId: 't-42' })
	})

	it('agent_write_config passes the config object through untouched', async () => {
		const config = { brain: '@openvole/paw-brain', loop: { maxIterations: 5 } }
		await findTool('agent_write_config').execute({ target: 'worker', config })
		expect(callParent).toHaveBeenCalledWith('write_config', { target: 'worker', config })
	})

	it('agent_write_identity forwards filename and content', async () => {
		await findTool('agent_write_identity').execute({
			target: 'worker',
			filename: 'AGENT.md',
			content: '# Role',
		})
		expect(callParent).toHaveBeenCalledWith('write_identity', {
			target: 'worker',
			filename: 'AGENT.md',
			content: '# Role',
		})
	})

	it('maps a rejected parent call to { ok:false, error } without throwing', async () => {
		callParent.mockRejectedValueOnce(new Error('nope'))
		const r = (await findTool('agent_state').execute({ target: 'worker' })) as Record<
			string,
			unknown
		>
		expect(r).toEqual({ ok: false, error: 'nope' })
	})

	it.each(['agent_stop', 'agent_restart', 'agent_start'])(
		'%s refuses to target the own agent without calling the parent',
		async (name) => {
			const r = (await findTool(name).execute({ target: 'boss' })) as Record<string, unknown>
			expect(r.ok).toBe(false)
			expect(String(r.error)).toContain('own agent')
			expect(callParent).not.toHaveBeenCalled()
		},
	)

	it('non-lifecycle tools may target the own agent (parent stays authoritative)', async () => {
		await findTool('agent_state').execute({ target: 'boss' })
		expect(callParent).toHaveBeenCalledWith('state', { target: 'boss' })
	})

	it('agent_create forwards the name', async () => {
		await findTool('agent_create').execute({ name: 'New Worker' })
		expect(callParent).toHaveBeenCalledWith('create', { name: 'New Worker' })
	})
})
