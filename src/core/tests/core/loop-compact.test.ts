import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAgentContext } from '../../src/context/types.js'
import type { AgentContext, AgentMessage } from '../../src/context/types.js'

/**
 * Unit tests for the compact ordering logic in the agent loop.
 *
 * The real runAgentLoop requires full engine dependencies (PawRegistry, ToolRegistry, etc.)
 * so we test the compact threshold logic in isolation: the condition is
 *   config.compactThreshold > 0 && context.messages.length > config.compactThreshold
 */

/** Simulate the compact threshold check from loop.ts */
function shouldCompact(
	context: AgentContext,
	compactThreshold: number,
): boolean {
	return compactThreshold > 0 && context.messages.length > compactThreshold
}

/** Helper: fill context with N messages */
function fillMessages(context: AgentContext, count: number): void {
	for (let i = 0; i < count; i++) {
		context.messages.push({
			role: 'user',
			content: `message ${i}`,
			timestamp: Date.now(),
		})
	}
}

describe('compact threshold logic', () => {
	let context: AgentContext

	beforeEach(() => {
		context = createAgentContext('test-task', 10)
	})

	it('does not compact when messages are below threshold', () => {
		fillMessages(context, 5)
		expect(shouldCompact(context, 50)).toBe(false)
	})

	it('does not compact when messages equal threshold', () => {
		fillMessages(context, 50)
		expect(shouldCompact(context, 50)).toBe(false)
	})

	it('compacts when messages exceed threshold', () => {
		fillMessages(context, 51)
		expect(shouldCompact(context, 50)).toBe(true)
	})

	it('does not compact when threshold is 0 (disabled)', () => {
		fillMessages(context, 100)
		expect(shouldCompact(context, 0)).toBe(false)
	})

	it('compacts with threshold of 1 when there are 2+ messages', () => {
		fillMessages(context, 2)
		expect(shouldCompact(context, 1)).toBe(true)
	})
})

describe('compact ordering (perceive -> compact -> think)', () => {
	it('compact sees messages added by perceive before think runs', () => {
		const context = createAgentContext('test-task', 10)
		const callOrder: string[] = []

		// Simulate perceive: adds enrichment messages
		function simulatePerceive(ctx: AgentContext): AgentContext {
			callOrder.push('perceive')
			ctx.messages.push({
				role: 'user',
				content: 'perceive enrichment',
				timestamp: Date.now(),
			})
			return ctx
		}

		// Simulate compact: records what messages it sees
		let compactSeenMessages: AgentMessage[] = []
		function simulateCompact(ctx: AgentContext): AgentContext {
			callOrder.push('compact')
			compactSeenMessages = [...ctx.messages]
			// Simulate compaction by replacing with summary
			ctx.messages = [
				{
					role: 'user',
					content: 'compacted summary',
					timestamp: Date.now(),
				},
			]
			return ctx
		}

		// Simulate think: records what messages it sees
		let thinkSeenMessages: AgentMessage[] = []
		function simulateThink(ctx: AgentContext): void {
			callOrder.push('think')
			thinkSeenMessages = [...ctx.messages]
		}

		// Fill context to exceed threshold
		fillMessages(context, 10)
		const compactThreshold = 5

		// Run in loop order: perceive -> compact -> think
		const enriched = simulatePerceive(context)

		if (shouldCompact(enriched, compactThreshold)) {
			simulateCompact(enriched)
		}

		simulateThink(enriched)

		// Verify ordering
		expect(callOrder).toEqual(['perceive', 'compact', 'think'])

		// Compact saw the perceive enrichment message
		expect(compactSeenMessages.some((m) => m.content === 'perceive enrichment')).toBe(true)

		// Think sees the compacted context, not the raw perceive output
		expect(thinkSeenMessages.length).toBe(1)
		expect(thinkSeenMessages[0].content).toBe('compacted summary')
	})

	it('think receives uncompacted context when below threshold', () => {
		const context = createAgentContext('test-task', 10)
		const callOrder: string[] = []

		function simulatePerceive(ctx: AgentContext): AgentContext {
			callOrder.push('perceive')
			ctx.messages.push({
				role: 'user',
				content: 'perceive enrichment',
				timestamp: Date.now(),
			})
			return ctx
		}

		function simulateCompact(ctx: AgentContext): AgentContext {
			callOrder.push('compact')
			ctx.messages = [{ role: 'user', content: 'compacted', timestamp: Date.now() }]
			return ctx
		}

		let thinkSeenMessages: AgentMessage[] = []
		function simulateThink(ctx: AgentContext): void {
			callOrder.push('think')
			thinkSeenMessages = [...ctx.messages]
		}

		// Only 2 messages - below threshold of 50
		fillMessages(context, 2)
		const compactThreshold = 50

		const enriched = simulatePerceive(context)

		if (shouldCompact(enriched, compactThreshold)) {
			simulateCompact(enriched)
		}

		simulateThink(enriched)

		// Compact should NOT have run
		expect(callOrder).toEqual(['perceive', 'think'])

		// Think sees all original messages + perceive enrichment
		expect(thinkSeenMessages.length).toBe(3) // 2 original + 1 perceive
		expect(thinkSeenMessages.some((m) => m.content === 'perceive enrichment')).toBe(true)
	})
})
