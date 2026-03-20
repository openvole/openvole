import { describe, it, expect } from 'vitest'
import { createAgentContext } from '../../src/context/types.js'

describe('createAgentContext', () => {
	it('returns correct structure', () => {
		const ctx = createAgentContext('task-123', 15)

		expect(ctx.taskId).toBe('task-123')
		expect(ctx.maxIterations).toBe(15)
		expect(ctx.iteration).toBe(0)
		expect(ctx.messages).toEqual([])
		expect(ctx.availableTools).toEqual([])
		expect(ctx.activeSkills).toEqual([])
		expect(ctx.metadata).toEqual({})
	})

	it('creates independent instances', () => {
		const ctx1 = createAgentContext('task-1', 10)
		const ctx2 = createAgentContext('task-2', 20)

		ctx1.messages.push({ role: 'user', content: 'hello', timestamp: Date.now() })
		expect(ctx2.messages).toHaveLength(0)

		expect(ctx1.taskId).toBe('task-1')
		expect(ctx2.taskId).toBe('task-2')
	})
})
