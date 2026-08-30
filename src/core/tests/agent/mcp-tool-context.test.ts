import { describe, expect, it } from 'vitest'
import { mcpToolContext } from '../../src/agent/control-adapter.js'
import type { AgentTask } from '../../src/core/task.js'
import type { VoleEngine } from '../../src/index.js'

/**
 * A brain that exposes its tools to a CLI calls them over MCP, which is stateless: for a long
 * time that path reached `execute()` with no context at all, so a message never knew who was
 * waiting for the answer and the hop count restarted from zero on every exchange. Neither
 * failure was visible — the tools ran, they just quietly lost everything the context carried.
 */
const engineWith = (running: Partial<AgentTask>[]) =>
	({ taskQueue: { getRunning: () => running as AgentTask[] } }) as unknown as VoleEngine

const task = (over: Record<string, unknown> = {}): Partial<AgentTask> => ({
	id: 't1',
	sessionId: 'sess-human',
	metadata: {},
	...over,
})

describe('mcpToolContext', () => {
	it('carries the running task’s reply address', () => {
		expect(mcpToolContext(engineWith([task()]))?.replyTo).toBe('sess-human')
	})

	it('carries hops so the agent-to-agent budget can actually run down', () => {
		const ctx = mcpToolContext(engineWith([task({ metadata: { hops: 3 } })]))
		expect(ctx?.hops).toBe(3)
	})

	it('carries the person waiting behind an agent-to-agent exchange', () => {
		const ctx = mcpToolContext(
			engineWith([task({ sessionId: 'agent:orchestrator', metadata: { relayTo: 'sess-human' } })]),
		)
		expect(ctx?.relayTo).toBe('sess-human')
	})

	it('ignores a relayTo that is not a string', () => {
		const ctx = mcpToolContext(engineWith([task({ metadata: { relayTo: { evil: 1 } } })]))
		expect(ctx?.relayTo).toBeUndefined()
	})

	// Concurrency above one makes a stateless call ambiguous. Guessing "whichever ran last" is
	// how replies end up filed under somebody else's conversation, so we carry nothing instead.
	it('declines to guess when several tasks are running', () => {
		expect(mcpToolContext(engineWith([task(), task({ id: 't2' })]))).toBeUndefined()
	})

	it('returns nothing when no task is running', () => {
		expect(mcpToolContext(engineWith([]))).toBeUndefined()
	})
})
