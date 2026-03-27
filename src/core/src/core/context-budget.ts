import type { AgentMessage } from '../context/types.js'

export interface TokenBudget {
	systemPrompt: number
	tools: number
	sessionHistory: number
	taskMessages: number
	responseReserve: number
	total: number
	maxTokens: number
	free: number
}

/**
 * Manages context token budgets — estimation, budget calculation,
 * priority-based trimming, and compaction triggers.
 *
 * Lives in core. The loop uses it before calling think() so brain paws
 * receive pre-trimmed context and just call the API.
 */
export class ContextBudgetManager {
	constructor(
		private maxTokens: number,
		private responseReserve: number = 4000,
	) {}

	/**
	 * Estimate tokens for a string.
	 * JSON/code uses ~2 chars per token (denser).
	 * Natural text uses ~4 chars per token.
	 * Matches OpenClaw's heuristic (~90% accuracy).
	 */
	estimateTokens(text: string): number {
		if (!text) return 0
		const trimmed = text.trimStart()
		const isJson = trimmed.startsWith('{') || trimmed.startsWith('[')
		const charsPerToken = isJson ? 2 : 4
		return Math.ceil(text.length / charsPerToken)
	}

	/**
	 * Estimate tokens for an array of messages.
	 * Each message has ~4 tokens overhead (role, formatting).
	 */
	estimateMessagesTokens(messages: AgentMessage[]): number {
		return messages.reduce(
			(sum, m) => sum + this.estimateTokens(m.content) + 4,
			0,
		)
	}

	/**
	 * Calculate full budget breakdown.
	 */
	calculateBudget(
		systemPromptTokens: number,
		toolTokens: number,
		sessionHistoryTokens: number,
		messagesTokens: number,
	): TokenBudget {
		const total =
			systemPromptTokens +
			toolTokens +
			sessionHistoryTokens +
			messagesTokens +
			this.responseReserve
		return {
			systemPrompt: systemPromptTokens,
			tools: toolTokens,
			sessionHistory: sessionHistoryTokens,
			taskMessages: messagesTokens,
			responseReserve: this.responseReserve,
			total,
			maxTokens: this.maxTokens,
			free: this.maxTokens - total,
		}
	}

	/**
	 * Should compaction trigger? Returns true when >75% of budget is used.
	 */
	shouldCompact(budget: TokenBudget): boolean {
		return budget.total > this.maxTokens * 0.75
	}

	/**
	 * Priority-based message trimming to fit within available token budget.
	 *
	 * Trimming order (lowest priority first):
	 * 1. Old tool results (seenAtIteration set and >2 iterations ago) → summarize
	 * 2. Old error messages (>5 messages back) → remove
	 * 3. Old brain messages (>8 messages back, not last 2) → truncate
	 * 4. Old user messages (>8 messages back, not first or last) → truncate
	 * 5. Session history messages → remove oldest
	 *
	 * Never trimmed: first user message, last 2 brain messages, last user message
	 */
	trimMessages(
		messages: AgentMessage[],
		availableTokens: number,
		currentIteration: number,
	): AgentMessage[] {
		let trimmed = [...messages]
		let currentTokens = this.estimateMessagesTokens(trimmed)

		if (currentTokens <= availableTokens) return trimmed

		// Identify protected indices
		const firstUserIdx = trimmed.findIndex((m) => m.role === 'user')
		const lastUserIdx = this.findLastIndex(trimmed, (m) => m.role === 'user')
		const lastBrainIndices = this.findLastNIndices(trimmed, (m) => m.role === 'brain', 2)
		const protectedIndices = new Set<number>([
			firstUserIdx,
			lastUserIdx,
			...lastBrainIndices,
		].filter((i) => i >= 0))

		// Pass 1: Summarize old tool results
		for (let i = 0; i < trimmed.length && currentTokens > availableTokens; i++) {
			if (protectedIndices.has(i)) continue
			const msg = trimmed[i]
			if (msg.role !== 'tool_result') continue
			if (msg.seenAtIteration !== undefined && currentIteration - msg.seenAtIteration > 2) {
				const toolName = msg.toolCall?.name ?? 'tool'
				const preview = msg.content.substring(0, 100)
				const oldTokens = this.estimateTokens(msg.content)
				msg.content = `[${toolName}: ${preview}...]`
				currentTokens -= oldTokens - this.estimateTokens(msg.content)
			}
		}

		if (currentTokens <= availableTokens) return trimmed

		// Pass 2: Remove old error messages
		const totalMessages = trimmed.length
		trimmed = trimmed.filter((msg, i) => {
			if (protectedIndices.has(i)) return true
			if (msg.role !== 'error') return true
			if (totalMessages - i > 5) {
				currentTokens -= this.estimateTokens(msg.content) + 4
				return false
			}
			return true
		})

		if (currentTokens <= availableTokens) return trimmed

		// Pass 3: Truncate old brain messages
		for (let i = 0; i < trimmed.length && currentTokens > availableTokens; i++) {
			if (protectedIndices.has(i)) continue
			const msg = trimmed[i]
			if (msg.role !== 'brain') continue
			if (trimmed.length - i > 8 && msg.content.length > 200) {
				const oldTokens = this.estimateTokens(msg.content)
				msg.content = msg.content.substring(0, 200) + '...'
				currentTokens -= oldTokens - this.estimateTokens(msg.content)
			}
		}

		if (currentTokens <= availableTokens) return trimmed

		// Pass 4: Truncate old user messages
		for (let i = 0; i < trimmed.length && currentTokens > availableTokens; i++) {
			if (protectedIndices.has(i)) continue
			const msg = trimmed[i]
			if (msg.role !== 'user') continue
			if (trimmed.length - i > 8 && msg.content.length > 200) {
				const oldTokens = this.estimateTokens(msg.content)
				msg.content = msg.content.substring(0, 200) + '...'
				currentTokens -= oldTokens - this.estimateTokens(msg.content)
			}
		}

		if (currentTokens <= availableTokens) return trimmed

		// Pass 5: Remove oldest messages (except protected)
		const toRemove: number[] = []
		for (let i = 0; i < trimmed.length && currentTokens > availableTokens; i++) {
			if (protectedIndices.has(i)) continue
			currentTokens -= this.estimateTokens(trimmed[i].content) + 4
			toRemove.push(i)
		}
		if (toRemove.length > 0) {
			const removeSet = new Set(toRemove)
			trimmed = trimmed.filter((_, i) => !removeSet.has(i))
		}

		return trimmed
	}

	/**
	 * Format budget breakdown for logging.
	 */
	formatBudget(budget: TokenBudget): string {
		const fmt = (n: number) => {
			if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
			return String(n)
		}
		return `System: ${fmt(budget.systemPrompt)} | Tools: ${fmt(budget.tools)} | Session: ${fmt(budget.sessionHistory)} | Messages: ${fmt(budget.taskMessages)} | Reserve: ${fmt(budget.responseReserve)} | Free: ${fmt(budget.free)} / ${fmt(budget.maxTokens)}`
	}

	// --- Helpers ---

	private findLastIndex(arr: AgentMessage[], predicate: (m: AgentMessage) => boolean): number {
		for (let i = arr.length - 1; i >= 0; i--) {
			if (predicate(arr[i])) return i
		}
		return -1
	}

	private findLastNIndices(arr: AgentMessage[], predicate: (m: AgentMessage) => boolean, n: number): number[] {
		const indices: number[] = []
		for (let i = arr.length - 1; i >= 0 && indices.length < n; i--) {
			if (predicate(arr[i])) indices.push(i)
		}
		return indices
	}
}
