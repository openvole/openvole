import { createLogger } from './logger.js'

const logger = createLogger('cost-tracker')

/** Pricing per 1M tokens (USD) — approximate, updated March 2026 */
const PRICING: Record<string, { input: number; output: number }> = {
	// Anthropic
	'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
	'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
	'claude-haiku-4-20250514': { input: 0.8, output: 4.0 },
	// OpenAI
	'gpt-4o': { input: 2.5, output: 10.0 },
	'gpt-4o-mini': { input: 0.15, output: 0.6 },
	'gpt-4.1': { input: 2.0, output: 8.0 },
	'gpt-4.1-mini': { input: 0.4, output: 1.6 },
	'gpt-4.1-nano': { input: 0.1, output: 0.4 },
	o3: { input: 10.0, output: 40.0 },
	'o3-mini': { input: 1.1, output: 4.4 },
	'o4-mini': { input: 1.1, output: 4.4 },
	// Google
	'gemini-2.5-flash': { input: 0.15, output: 0.6 },
	'gemini-2.5-pro': { input: 1.25, output: 10.0 },
	'gemini-2.0-flash': { input: 0.1, output: 0.4 },
	// xAI
	'grok-3': { input: 3.0, output: 15.0 },
	'grok-3-mini': { input: 0.3, output: 0.5 },
}

/** Fallback pricing for unknown models */
const DEFAULT_PRICING = { input: 2.0, output: 8.0 }

export interface CostEntry {
	inputTokens: number
	outputTokens: number
	inputCost: number
	outputCost: number
	totalCost: number
	model: string
}

export interface TaskCostSummary {
	llmCalls: number
	totalInputTokens: number
	totalOutputTokens: number
	totalCost: number
	entries: CostEntry[]
}

export type CostTrackingMode = 'auto' | 'enabled' | 'disabled'

export class CostTracker {
	private entries: CostEntry[] = []
	private alertThreshold: number | undefined
	private mode: CostTrackingMode

	constructor(alertThreshold?: number, mode: CostTrackingMode = 'auto') {
		this.alertThreshold = alertThreshold
		this.mode = mode
	}

	/**
	 * Check if a provider is local (free) based on mode and provider/model info.
	 * In "auto" mode, Ollama is free unless the model name contains ":cloud" (Ollama cloud).
	 * In "enabled" mode, everything is tracked.
	 */
	private isLocalFree(provider?: string, model?: string): boolean {
		if (this.mode === 'enabled') return false
		if (this.mode === 'disabled') return true
		// auto mode: Ollama is free unless model has :cloud suffix
		if (provider === 'ollama') {
			if (model && model.includes(':cloud')) return false
			return true
		}
		return false
	}

	/**
	 * Record an LLM call's cost.
	 * Accepts token counts and model name, estimates USD cost.
	 */
	record(
		inputTokens: number | string | undefined,
		outputTokens: number | string | undefined,
		model: string,
		provider?: string,
	): CostEntry {
		if (this.mode === 'disabled') {
			return { inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: 0, totalCost: 0, model }
		}

		const input = typeof inputTokens === 'number' ? inputTokens : 0
		const output = typeof outputTokens === 'number' ? outputTokens : 0

		const isFree = this.isLocalFree(provider, model)
		const pricing = isFree ? { input: 0, output: 0 } : this.getPricing(model, provider)
		const inputCost = (input / 1_000_000) * pricing.input
		const outputCost = (output / 1_000_000) * pricing.output
		const totalCost = inputCost + outputCost

		const entry: CostEntry = {
			inputTokens: input,
			outputTokens: output,
			inputCost,
			outputCost,
			totalCost,
			model,
		}

		this.entries.push(entry)

		logger.info(
			`LLM cost: $${totalCost.toFixed(6)} (in: ${input} × $${pricing.input}/M = $${inputCost.toFixed(6)}, out: ${output} × $${pricing.output}/M = $${outputCost.toFixed(6)}) [${model}]`,
		)

		// Check alert threshold
		if (this.alertThreshold !== undefined) {
			const total = this.getTotalCost()
			if (total >= this.alertThreshold) {
				logger.warn(
					`Cost alert: task cost $${total.toFixed(4)} has reached the threshold of $${this.alertThreshold}`,
				)
			}
		}

		return entry
	}

	getTotalCost(): number {
		return this.entries.reduce((sum, e) => sum + e.totalCost, 0)
	}

	getSummary(): TaskCostSummary {
		return {
			llmCalls: this.entries.length,
			totalInputTokens: this.entries.reduce((s, e) => s + e.inputTokens, 0),
			totalOutputTokens: this.entries.reduce((s, e) => s + e.outputTokens, 0),
			totalCost: this.getTotalCost(),
			entries: [...this.entries],
		}
	}

	private getPricing(model: string, _provider?: string): { input: number; output: number } {
		// Check exact model match
		if (PRICING[model]) return PRICING[model]

		// Check model prefix (e.g. "claude-sonnet-4" matches "claude-sonnet-4-20250514")
		for (const [key, pricing] of Object.entries(PRICING)) {
			if (model.startsWith(key) || key.startsWith(model)) return pricing
		}

		// Unknown model — use default
		logger.debug(
			`No pricing for model "${model}", using default ($${DEFAULT_PRICING.input}/$${DEFAULT_PRICING.output} per 1M tokens)`,
		)
		return DEFAULT_PRICING
	}
}
