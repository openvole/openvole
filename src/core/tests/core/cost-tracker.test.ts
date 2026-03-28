import { describe, it, expect } from 'vitest'
import { CostTracker } from '../../src/core/cost-tracker.js'

describe('CostTracker', () => {
	describe('record', () => {
		it('calculates cost from known model pricing', () => {
			const tracker = new CostTracker()
			const entry = tracker.record(1_000_000, 1_000_000, 'gpt-4o')
			// gpt-4o: $2.5/M input, $10/M output
			expect(entry.inputCost).toBeCloseTo(2.5, 4)
			expect(entry.outputCost).toBeCloseTo(10, 4)
			expect(entry.totalCost).toBeCloseTo(12.5, 4)
		})

		it('uses default pricing for unknown models', () => {
			const tracker = new CostTracker()
			const entry = tracker.record(1_000_000, 1_000_000, 'unknown-model-xyz')
			// default: $2/M input, $8/M output
			expect(entry.inputCost).toBeCloseTo(2.0, 4)
			expect(entry.outputCost).toBeCloseTo(8.0, 4)
		})

		it('matches model by prefix', () => {
			const tracker = new CostTracker()
			// "claude-sonnet-4" should match "claude-sonnet-4-20250514"
			const entry = tracker.record(1_000_000, 0, 'claude-sonnet-4-20250514')
			expect(entry.inputCost).toBeCloseTo(3.0, 4)
		})

		it('handles string token values gracefully', () => {
			const tracker = new CostTracker()
			const entry = tracker.record('unknown', '?', 'gpt-4o')
			expect(entry.inputTokens).toBe(0)
			expect(entry.outputTokens).toBe(0)
			expect(entry.totalCost).toBe(0)
		})

		it('handles undefined token values', () => {
			const tracker = new CostTracker()
			const entry = tracker.record(undefined, undefined, 'gpt-4o')
			expect(entry.inputTokens).toBe(0)
			expect(entry.outputTokens).toBe(0)
		})
	})

	describe('local/cloud detection (auto mode)', () => {
		it('treats ollama local models as free', () => {
			const tracker = new CostTracker(undefined, 'auto')
			const entry = tracker.record(10000, 500, 'qwen3:latest', 'ollama')
			expect(entry.totalCost).toBe(0)
		})

		it('treats ollama :cloud models as paid', () => {
			const tracker = new CostTracker(undefined, 'auto')
			const entry = tracker.record(10000, 500, 'kimi-k2.5:cloud', 'ollama')
			expect(entry.totalCost).toBeGreaterThan(0)
		})

		it('treats cloud providers as paid', () => {
			const tracker = new CostTracker(undefined, 'auto')
			const entry = tracker.record(10000, 500, 'gpt-4o', 'openai')
			expect(entry.totalCost).toBeGreaterThan(0)
		})
	})

	describe('enabled mode', () => {
		it('tracks cost for all providers including local ollama', () => {
			const tracker = new CostTracker(undefined, 'enabled')
			const entry = tracker.record(1_000_000, 0, 'qwen3:latest', 'ollama')
			// Should use default pricing, not free
			expect(entry.totalCost).toBeGreaterThan(0)
		})
	})

	describe('disabled mode', () => {
		it('returns zero cost for everything', () => {
			const tracker = new CostTracker(undefined, 'disabled')
			const entry = tracker.record(1_000_000, 1_000_000, 'gpt-4o', 'openai')
			expect(entry.totalCost).toBe(0)
			expect(entry.inputTokens).toBe(0)
		})
	})

	describe('getSummary', () => {
		it('aggregates multiple calls', () => {
			const tracker = new CostTracker()
			tracker.record(1000, 200, 'gpt-4o')
			tracker.record(2000, 300, 'gpt-4o')
			tracker.record(500, 100, 'gpt-4o')

			const summary = tracker.getSummary()
			expect(summary.llmCalls).toBe(3)
			expect(summary.totalInputTokens).toBe(3500)
			expect(summary.totalOutputTokens).toBe(600)
			expect(summary.totalCost).toBeGreaterThan(0)
			expect(summary.entries).toHaveLength(3)
		})

		it('returns empty summary when no calls recorded', () => {
			const tracker = new CostTracker()
			const summary = tracker.getSummary()
			expect(summary.llmCalls).toBe(0)
			expect(summary.totalInputTokens).toBe(0)
			expect(summary.totalOutputTokens).toBe(0)
			expect(summary.totalCost).toBe(0)
		})
	})

	describe('getTotalCost', () => {
		it('sums all entries', () => {
			const tracker = new CostTracker()
			tracker.record(1_000_000, 0, 'gemini-2.5-flash') // $0.15
			tracker.record(0, 1_000_000, 'gemini-2.5-flash') // $0.60
			expect(tracker.getTotalCost()).toBeCloseTo(0.75, 4)
		})
	})

	describe('cost alert', () => {
		it('does not throw when threshold is not set', () => {
			const tracker = new CostTracker()
			expect(() => {
				tracker.record(10_000_000, 10_000_000, 'gpt-4o')
			}).not.toThrow()
		})

		it('records entry even when above threshold', () => {
			const tracker = new CostTracker(0.001)
			tracker.record(1_000_000, 1_000_000, 'gpt-4o')
			expect(tracker.getSummary().llmCalls).toBe(1)
		})
	})

	describe('pricing table coverage', () => {
		const models = [
			['claude-sonnet-4-20250514', 3.0, 15.0],
			['claude-opus-4-20250514', 15.0, 75.0],
			['gpt-4o', 2.5, 10.0],
			['gpt-4o-mini', 0.15, 0.6],
			['gemini-2.5-flash', 0.15, 0.6],
			['gemini-2.5-pro', 1.25, 10.0],
			['grok-3', 3.0, 15.0],
		] as const

		for (const [model, expectedInput, expectedOutput] of models) {
			it(`prices ${model} correctly`, () => {
				const tracker = new CostTracker()
				const entry = tracker.record(1_000_000, 1_000_000, model)
				expect(entry.inputCost).toBeCloseTo(expectedInput, 2)
				expect(entry.outputCost).toBeCloseTo(expectedOutput, 2)
			})
		}
	})
})
