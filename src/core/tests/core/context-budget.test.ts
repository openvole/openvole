import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '../../src/context/types.js'
import { ContextBudgetManager } from '../../src/core/context-budget.js'

function msg(
	role: AgentMessage['role'],
	content: string,
	extra?: Partial<AgentMessage>,
): AgentMessage {
	return { role, content, timestamp: Date.now(), ...extra }
}

describe('ContextBudgetManager', () => {
	describe('estimateTokens', () => {
		it('estimates text at ~4 chars/token', () => {
			const bm = new ContextBudgetManager(128000)
			// 100 chars of text → ~25 tokens
			expect(bm.estimateTokens('a'.repeat(100))).toBe(25)
		})

		it('estimates JSON at ~2 chars/token', () => {
			const bm = new ContextBudgetManager(128000)
			// 100 chars of JSON → 50 tokens
			expect(bm.estimateTokens('{"key":"' + 'x'.repeat(90) + '"}')).toBe(50)
		})

		it('estimates array JSON at ~2 chars/token', () => {
			const bm = new ContextBudgetManager(128000)
			expect(bm.estimateTokens('[{"a":1}]')).toBe(5)
		})

		it('returns 0 for empty string', () => {
			const bm = new ContextBudgetManager(128000)
			expect(bm.estimateTokens('')).toBe(0)
		})

		it('handles whitespace-prefixed JSON', () => {
			const bm = new ContextBudgetManager(128000)
			const tokens = bm.estimateTokens('  {"key": "value"}')
			// Should detect as JSON despite leading spaces
			expect(tokens).toBe(9) // 18 chars / 2
		})
	})

	describe('calculateBudget', () => {
		it('calculates correct budget breakdown', () => {
			const bm = new ContextBudgetManager(128000, 4000)
			const budget = bm.calculateBudget(3000, 8000, 1500, 4000)

			expect(budget.systemPrompt).toBe(3000)
			expect(budget.tools).toBe(8000)
			expect(budget.sessionHistory).toBe(1500)
			expect(budget.taskMessages).toBe(4000)
			expect(budget.responseReserve).toBe(4000)
			expect(budget.total).toBe(20500)
			expect(budget.maxTokens).toBe(128000)
			expect(budget.free).toBe(107500)
		})

		it('shows negative free when over budget', () => {
			const bm = new ContextBudgetManager(10000, 4000)
			const budget = bm.calculateBudget(3000, 3000, 1000, 5000)

			expect(budget.total).toBe(16000)
			expect(budget.free).toBe(-6000)
		})
	})

	describe('shouldCompact', () => {
		it('returns false when under 75%', () => {
			const bm = new ContextBudgetManager(100000, 4000)
			const budget = bm.calculateBudget(3000, 8000, 1000, 2000)
			// total = 18000 / 100000 = 18%
			expect(bm.shouldCompact(budget)).toBe(false)
		})

		it('returns true when over 75%', () => {
			const bm = new ContextBudgetManager(100000, 4000)
			const budget = bm.calculateBudget(30000, 20000, 10000, 20000)
			// total = 84000 / 100000 = 84%
			expect(bm.shouldCompact(budget)).toBe(true)
		})
	})

	describe('trimMessages', () => {
		it('returns messages unchanged when under budget', () => {
			const bm = new ContextBudgetManager(128000, 4000)
			const messages = [msg('user', 'hello'), msg('brain', 'hi there')]
			const result = bm.trimMessages(messages, 10000, 0)
			expect(result).toHaveLength(2)
		})

		it('summarizes old tool results first', () => {
			const bm = new ContextBudgetManager(128000, 4000)
			const longResult = 'x'.repeat(4000)
			const messages = [
				msg('user', 'do something'),
				msg('tool_result', longResult, {
					seenAtIteration: 0,
					toolCall: { name: 'web_fetch', params: {} },
				}),
				msg('brain', 'done'),
				msg('user', 'do more'),
				msg('brain', 'ok'),
			]
			const result = bm.trimMessages(messages, 100, 5)
			// Tool result should be summarized (not full 4000 chars)
			const toolMsg = result.find((m) => m.role === 'tool_result')
			expect(toolMsg).toBeDefined()
			expect(toolMsg!.content.length).toBeLessThan(200)
			expect(toolMsg!.content).toContain('web_fetch')
		})

		it('never trims first user message', () => {
			const bm = new ContextBudgetManager(128000, 4000)
			const messages = [
				msg('user', 'important task input'),
				msg('brain', 'a'.repeat(1000)),
				msg('tool_result', 'b'.repeat(1000)),
				msg('brain', 'c'.repeat(1000)),
				msg('user', 'follow up'),
				msg('brain', 'latest response'),
			]
			const result = bm.trimMessages(messages, 50, 10)
			expect(result[0].role).toBe('user')
			expect(result[0].content).toBe('important task input')
		})

		it('never trims last 2 brain messages', () => {
			const bm = new ContextBudgetManager(128000, 4000)
			const messages = [
				msg('user', 'hello'),
				msg('brain', 'old response 1'),
				msg('brain', 'old response 2'),
				msg('brain', 'second to last'),
				msg('brain', 'latest response'),
			]
			const result = bm.trimMessages(messages, 50, 10)
			const brainMessages = result.filter((m) => m.role === 'brain')
			expect(brainMessages[brainMessages.length - 1].content).toBe('latest response')
			expect(brainMessages[brainMessages.length - 2].content).toBe('second to last')
		})

		it('removes old error messages', () => {
			const bm = new ContextBudgetManager(128000, 4000)
			const messages: AgentMessage[] = []
			messages.push(msg('user', 'task'))
			for (let i = 0; i < 10; i++) {
				messages.push(msg('error', `error ${i}`))
			}
			messages.push(msg('brain', 'final'))

			const result = bm.trimMessages(messages, 50, 10)
			const errors = result.filter((m) => m.role === 'error')
			// Old errors (>5 back) should be removed
			expect(errors.length).toBeLessThan(10)
		})
	})

	describe('formatBudget', () => {
		it('formats with K suffix for large numbers', () => {
			const bm = new ContextBudgetManager(128000, 4000)
			const budget = bm.calculateBudget(3200, 8100, 1500, 4300)
			const formatted = bm.formatBudget(budget)

			expect(formatted).toContain('System: 3.2K')
			expect(formatted).toContain('Tools: 8.1K')
			expect(formatted).toContain('Session: 1.5K')
			expect(formatted).toContain('Messages: 4.3K')
			expect(formatted).toContain('Reserve: 4.0K')
			expect(formatted).toContain('128.0K')
		})

		it('formats small numbers without K', () => {
			const bm = new ContextBudgetManager(8000, 500)
			const budget = bm.calculateBudget(500, 200, 100, 50)
			const formatted = bm.formatBudget(budget)

			expect(formatted).toContain('System: 500')
			expect(formatted).toContain('Tools: 200')
		})
	})

	describe('estimateMessagesTokens', () => {
		it('sums message tokens plus overhead', () => {
			const bm = new ContextBudgetManager(128000)
			const messages = [
				msg('user', 'a'.repeat(40)), // 10 tokens + 4 overhead
				msg('brain', 'b'.repeat(80)), // 20 tokens + 4 overhead
			]
			expect(bm.estimateMessagesTokens(messages)).toBe(38)
		})
	})
})
