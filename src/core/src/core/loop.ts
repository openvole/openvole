import type { AgentContext } from '../context/types.js'
import { createAgentContext } from '../context/types.js'
import type { ToolRegistry } from '../tool/registry.js'
import type { PawRegistry } from '../paw/registry.js'
import type { SkillRegistry } from '../skill/registry.js'
import type { VoleIO } from '../io/types.js'
import type { LoopConfig } from '../config/index.js'
import type { RateLimiter } from './rate-limiter.js'
import type { AgentTask } from './task.js'
import type { MessageBus } from './bus.js'
import type { AgentPlan, PlannedAction } from '../paw/types.js'
import {
	createActionError,
	failureResult,
	successResult,
	type ActionResult,
} from './errors.js'
import { buildActiveSkills } from '../skill/resolver.js'
import { PHASE_ORDER } from './hooks.js'
import { buildSystemPrompt, type SystemPromptContent } from './system-prompt.js'
import { ContextBudgetManager } from './context-budget.js'
import { CostTracker } from './cost-tracker.js'

import { createLogger } from './logger.js'

const logger = createLogger('loop')

/** Maximum consecutive Brain failures before halting */
const MAX_BRAIN_FAILURES = 3

export interface LoopDependencies {
	bus: MessageBus
	toolRegistry: ToolRegistry
	pawRegistry: PawRegistry
	skillRegistry: SkillRegistry
	io: VoleIO
	config: LoopConfig
	toolProfiles?: Record<string, import('../config/index.js').ToolProfile>
	rateLimiter?: RateLimiter
	/** Cached system prompt content (loaded on engine start) */
	systemPromptContent?: SystemPromptContent
}

/**
 * Run the agent loop for a single task.
 * Perceive → Think → Act → Observe → loop
 */
export async function runAgentLoop(
	task: AgentTask,
	deps: LoopDependencies,
): Promise<void> {
	const { bus, toolRegistry, pawRegistry, skillRegistry, io, config, toolProfiles, rateLimiter, systemPromptContent } = deps
	const rateLimits = config.rateLimits
	const maxContextTokens = config.maxContextTokens || 128000
	const responseReserve = config.responseReserve || 4000
	const budgetManager = new ContextBudgetManager(maxContextTokens, responseReserve)
	let toolExecutionCount = 0
	const toolCallSignatures = new Map<string, number>()
	const costTracker = new CostTracker(config.costAlertThreshold)
	logger.info(`Agent loop started for task ${task.id}: "${task.input}"`)

	const logCostSummary = () => {
		const summary = costTracker.getSummary()
		if (summary.llmCalls > 0) {
			logger.info(
				`Task cost summary — ${summary.llmCalls} LLM calls, ${summary.totalInputTokens} input + ${summary.totalOutputTokens} output tokens, $${summary.totalCost.toFixed(6)} total`,
			)
			task.metadata = task.metadata ?? {}
			task.metadata.cost = summary
		}
	}

	// Reset tool horizon for each new task
	toolRegistry.resetHorizon()

	// Sub-agent tasks can override maxIterations via metadata
	const effectiveMaxIterations =
		task.source === 'agent' && typeof task.metadata?.maxIterations === 'number'
			? task.metadata.maxIterations
			: config.maxIterations
	let context = createAgentContext(task.id, effectiveMaxIterations)

	// Set task source in metadata so Paws (e.g. paw-memory) can scope by source
	context.metadata.taskSource = task.source
	context.metadata.sessionId = task.sessionId
	if (task.metadata) {
		Object.assign(context.metadata, task.metadata)
	}
	if (config.maxContextTokens) {
		context.metadata.maxContextTokens = config.maxContextTokens
	}
	if (task.source === 'heartbeat') {
		context.metadata.heartbeat = true
	}

	// Seed with user input
	context.messages.push({
		role: 'user',
		content: task.input,
		timestamp: Date.now(),
	})

	// === BOOTSTRAP — runs once at task start ===
	logger.debug('Phase: bootstrap')
	context = await pawRegistry.runBootstrapHooks(context)

	let consecutiveBrainFailures = 0
	let consecutiveNoResponse = 0
	let idleIterations = 0

	for (
		context.iteration = 0;
		idleIterations < effectiveMaxIterations;
		context.iteration++
	) {
		// Check cancellation
		if (task.status === 'cancelled') {
			logger.info(`Task ${task.id} cancelled at iteration ${context.iteration}`)
			return
		}

		idleIterations++
		logger.info(
			`Loop running — iteration ${context.iteration + 1} (idle: ${idleIterations}/${effectiveMaxIterations})`,
		)

		// === PERCEIVE (global only — lazy perceive runs in Act) ===
		const contextBuildStart = Date.now()
		logger.debug(`Phase: ${PHASE_ORDER[0]}`)
		const enrichedContext = await runPerceive(context, pawRegistry, toolRegistry, skillRegistry)

		// === BUILD SYSTEM PROMPT (core-managed) ===
		if (systemPromptContent) {
			enrichedContext.systemPrompt = buildSystemPrompt(
				systemPromptContent,
				enrichedContext.activeSkills,
				enrichedContext.availableTools,
				enrichedContext.metadata,
			)
		}

		// === CONTEXT BUDGET — calculate, compact, trim ===
		const systemPromptTokens = budgetManager.estimateTokens(enrichedContext.systemPrompt ?? '')
		const toolTokens = budgetManager.estimateTokens(JSON.stringify(enrichedContext.availableTools))
		const sessionTokens = budgetManager.estimateTokens(
			typeof enrichedContext.metadata.sessionHistory === 'string' ? enrichedContext.metadata.sessionHistory : '',
		)

		// Block if fixed costs alone exceed budget (no room for messages — LLM call would be wasted)
		const fixedCosts = systemPromptTokens + toolTokens + responseReserve
		if (fixedCosts > maxContextTokens) {
			const msg = `maxContextTokens (${maxContextTokens}) is too low — system prompt (${systemPromptTokens}) + tools (${toolTokens}) + reserve (${responseReserve}) = ${fixedCosts}. Increase maxContextTokens to at least ${fixedCosts + 2000}.`
			logger.error(msg)
			task.result = `Configuration error: ${msg}`
			task.error = msg
			if (task.source === 'user') io.notify(task.result)
			return
		}

		// --- LOG 1: Before compaction (full breakdown) ---
		const msgBreakdown = budgetManager.messageBreakdown(enrichedContext.messages)
		const messageTokens = msgBreakdown.total
		const budget = budgetManager.calculateBudget(systemPromptTokens, toolTokens, sessionTokens, messageTokens)
		logger.info(
			`BUDGET PRE-COMPACT — systemPrompt: ${systemPromptTokens} | tools: ${toolTokens} | session: ${sessionTokens} | reserve: ${responseReserve} | userMsgs: ${msgBreakdown.user} | brainMsgs: ${msgBreakdown.brain} | toolResults: ${msgBreakdown.toolResult} | errors: ${msgBreakdown.error} | total: ${budget.total}/${maxContextTokens}`,
		)

		// Token-based compaction trigger (75% of max)
		if (budgetManager.shouldCompact(budget)) {
			logger.info(`Context at ${Math.round((budget.total / budget.maxTokens) * 100)}% — running compact`)
			const compacted = await pawRegistry.runCompactHooks(enrichedContext)
			enrichedContext.messages = compacted.messages
		}
		// Also support legacy message-count compaction trigger
		else if (config.compactThreshold > 0 && enrichedContext.messages.length > config.compactThreshold) {
			logger.info(`Context has ${enrichedContext.messages.length} messages (threshold: ${config.compactThreshold}), running compact`)
			const compacted = await pawRegistry.runCompactHooks(enrichedContext)
			enrichedContext.messages = compacted.messages
		}

		// Priority-based trimming if over budget after compaction
		const postCompactMsgTokens = budgetManager.estimateMessagesTokens(enrichedContext.messages)
		const postCompactBudget = budgetManager.calculateBudget(systemPromptTokens, toolTokens, sessionTokens, postCompactMsgTokens)
		if (postCompactBudget.free < 0) {
			const availableForMessages = maxContextTokens - systemPromptTokens - toolTokens - sessionTokens - responseReserve
			logger.warn(`Context over budget by ${Math.abs(postCompactBudget.free)} tokens — trimming messages`)
			enrichedContext.messages = budgetManager.trimMessages(
				enrichedContext.messages,
				availableForMessages,
				context.iteration,
			)
		}

		// --- LOG 2: After compaction + trimming (final state before LLM) ---
		const finalBreakdown = budgetManager.messageBreakdown(enrichedContext.messages)
		const finalTotal = systemPromptTokens + toolTokens + sessionTokens + finalBreakdown.total + responseReserve
		logger.info(
			`BUDGET FINAL — systemPrompt: ${systemPromptTokens} | tools: ${toolTokens} | session: ${sessionTokens} | reserve: ${responseReserve} | userMsgs: ${finalBreakdown.user} | brainMsgs: ${finalBreakdown.brain} | toolResults: ${finalBreakdown.toolResult} | errors: ${finalBreakdown.error} | total: ${finalTotal}/${maxContextTokens} (${finalTotal > maxContextTokens ? 'OVER' : 'OK'})`,
		)

		// If still over budget after all trimming, warn but proceed — LLM may truncate or error
		if (finalTotal > maxContextTokens) {
			logger.warn(`Context still over budget by ${finalTotal - maxContextTokens} tokens after compaction + trimming. LLM call may fail or truncate.`)
		}

		// === RATE LIMIT CHECK (before Think) ===
		if (rateLimiter && rateLimits) {
			if (rateLimits.llmCallsPerMinute != null) {
				if (!rateLimiter.tryConsume('llm:per-minute', rateLimits.llmCallsPerMinute, 60_000)) {
					logger.warn(`Rate limit hit: llmCallsPerMinute (${rateLimits.llmCallsPerMinute})`)
					bus.emit('rate:limited', { bucket: 'llm:per-minute', source: task.source })
					enrichedContext.messages.push({
						role: 'error',
						content: `Rate limit exceeded: LLM calls per minute (limit: ${rateLimits.llmCallsPerMinute}). Retrying next iteration.`,
						timestamp: Date.now(),
					})
					continue
				}
			}
			if (rateLimits.llmCallsPerHour != null) {
				if (!rateLimiter.tryConsume('llm:per-hour', rateLimits.llmCallsPerHour, 3_600_000)) {
					logger.warn(`Rate limit hit: llmCallsPerHour (${rateLimits.llmCallsPerHour})`)
					bus.emit('rate:limited', { bucket: 'llm:per-hour', source: task.source })
					enrichedContext.messages.push({
						role: 'error',
						content: `Rate limit exceeded: LLM calls per hour (limit: ${rateLimits.llmCallsPerHour}). Retrying next iteration.`,
						timestamp: Date.now(),
					})
					continue
				}
			}
		}

		// === THINK ===
		const contextBuildMs = Date.now() - contextBuildStart
		const taskToContextMs = Date.now() - task.createdAt
		logger.info(`Context built in ${contextBuildMs}ms (${taskToContextMs}ms since task created)`)

		logger.debug(`Phase: ${PHASE_ORDER[1]}`)
		const llmStart = Date.now()
		const plan = await runThink(enrichedContext, pawRegistry)
		const llmMs = Date.now() - llmStart
		logger.info(`LLM round-trip: ${llmMs}ms`)

		// Record cost from Brain's usage report
		if (plan && plan !== 'BRAIN_ERROR' && plan.usage) {
			costTracker.record(
				plan.usage.inputTokens,
				plan.usage.outputTokens,
				plan.usage.model ?? 'unknown',
				plan.usage.provider,
			)
		}

		// Mark tool results as "seen" by the Brain for lifecycle management
		for (const msg of enrichedContext.messages) {
			if (msg.role === 'tool_result' && msg.seenAtIteration === undefined) {
				msg.seenAtIteration = context.iteration
			}
		}

		if (plan && plan !== 'BRAIN_ERROR') {
			logger.info(`Brain plan: done=${plan.done}, actions=${plan.actions.length}, response=${plan.response ? plan.response.substring(0, 100) + '...' : 'none'}`)
		}

		if (!plan) {
			// No Brain Paw configured — no-op Think
			logger.debug('Think phase returned null (no Brain Paw)')
			break
		}

		// Handle Brain errors
		if (plan === 'BRAIN_ERROR') {
			consecutiveBrainFailures++
			if (consecutiveBrainFailures >= MAX_BRAIN_FAILURES) {
				io.notify(
					`Brain Paw failed ${MAX_BRAIN_FAILURES} consecutive times. Halting task.`,
				)
				task.error = `Brain failed ${MAX_BRAIN_FAILURES} consecutive times`
				return
			}
			continue
		}

		consecutiveBrainFailures = 0
		consecutiveNoResponse = 0

		// Check if the Brain says we're done
		if (plan.done) {
			// Detect if the Brain narrated tool calls instead of executing them
			if (plan.response && plan.actions.length === 0 && plan.response.startsWith('Calling tools:')) {
				logger.warn('Brain narrated tool calls instead of executing them — forcing retry')
				enrichedContext.messages.push({
					role: 'error',
					content: 'You described tool calls as text instead of executing them. Use function calling to invoke tools — do not write tool calls as text. Try again.',
					timestamp: Date.now(),
				})
				plan.done = false
				continue
			}

			// Enforce response — if done with no response, force retry (max 3 times)
			if (!plan.response && plan.actions.length === 0) {
				consecutiveNoResponse++
				if (consecutiveNoResponse >= 3) {
					// Brain can't produce a response — build one from what it did
					const toolCalls = enrichedContext.messages
						.filter((m) => m.role === 'brain' && m.toolCall)
						.map((m) => m.toolCall!.name)
						.filter((name) => name !== 'multiple')
					const fallback = toolCalls.length > 0
						? `Done. I used ${[...new Set(toolCalls)].join(', ')} to complete your request.`
						: 'Done.'
					task.result = fallback
					if (task.source === 'user') io.notify(fallback)
					logger.warn(`Brain returned no response ${consecutiveNoResponse} times — generated fallback from context`)
					return
				}
				logger.warn('Brain completed with no response — forcing retry')
				if (consecutiveNoResponse === 1) {
					// Only push the hint once — don't spam the context
					enrichedContext.messages.push({
						role: 'error',
						content: 'You completed the task but did not include a response. Always provide a summary of what you did or what happened.',
						timestamp: Date.now(),
					})
				}
				plan.done = false
				continue
			}

			if (plan.response) {
				task.result = plan.response
				if (task.source === 'user') io.notify(plan.response)
				enrichedContext.messages.push({
					role: 'brain',
					content: plan.response,
					timestamp: Date.now(),
				})
			}
			logCostSummary()
			logger.info(`Task ${task.id} completed by Brain at iteration ${context.iteration + 1}`)
			return
		}

		// If Brain has a response but also actions, show the response (user tasks only)
		if (plan.response) {
			if (task.source === 'user') io.notify(plan.response)
			enrichedContext.messages.push({
				role: 'brain',
				content: plan.response,
				timestamp: Date.now(),
			})
		}

		// === ACT ===
		logger.debug(`Phase: ${PHASE_ORDER[2]}`)
		if (plan.actions.length > 0) {
			// Record the Brain's tool call intent in context so it sees its own reasoning on next iteration
			const toolCallSummary = plan.actions.map((a) => `${a.tool}(${JSON.stringify(a.params)})`).join(', ')
			enrichedContext.messages.push({
				role: 'brain',
				content: plan.response || `Calling tools: ${toolCallSummary}`,
				toolCall: plan.actions.length === 1
					? { name: plan.actions[0].tool, params: plan.actions[0].params }
					: { name: 'multiple', params: plan.actions.map((a) => ({ tool: a.tool, params: a.params })) },
				timestamp: Date.now(),
			})
			// Check tool execution rate limit
			if (rateLimiter && rateLimits?.toolExecutionsPerTask != null) {
				const incoming = plan.actions.length
				if (toolExecutionCount + incoming > rateLimits.toolExecutionsPerTask) {
					logger.warn(
						`Rate limit hit: toolExecutionsPerTask (${toolExecutionCount + incoming}/${rateLimits.toolExecutionsPerTask})`,
					)
					bus.emit('rate:limited', { bucket: 'tools:per-task', source: task.source })
					enrichedContext.messages.push({
						role: 'error',
						content: `Rate limit exceeded: tool executions per task (limit: ${rateLimits.toolExecutionsPerTask}, used: ${toolExecutionCount}). Stopping task.`,
						timestamp: Date.now(),
					})
					break
				}
			}
			// Filter actions by tool profile for this task source
			const profile = toolProfiles?.[task.source]
			if (profile) {
				const blocked: string[] = []
				plan.actions = plan.actions.filter((a) => {
					if (profile.allow && !profile.allow.includes(a.tool)) {
						blocked.push(a.tool)
						return false
					}
					if (profile.deny?.includes(a.tool)) {
						blocked.push(a.tool)
						return false
					}
					return true
				})
				if (blocked.length > 0) {
					logger.warn(`Blocked tools for source "${task.source}": ${blocked.join(', ')}`)
					enrichedContext.messages.push({
						role: 'error',
						content: `Tools blocked by security profile for "${task.source}" source: ${blocked.join(', ')}`,
						timestamp: Date.now(),
					})
				}
				if (plan.actions.length === 0) continue
			}

			// Log tool calls + stuck loop detection
			for (const action of plan.actions) {
				logger.info(`Tool call: ${action.tool}(${JSON.stringify(action.params)})`)

				// Track repeated identical calls
				const sig = `${action.tool}:${JSON.stringify(action.params)}`
				const count = (toolCallSignatures.get(sig) ?? 0) + 1
				toolCallSignatures.set(sig, count)

				if (count >= 15) {
					// Circuit breaker — force stop
					const msg = `Stuck loop detected: ${action.tool} called ${count} times with identical parameters. Stopping.`
					logger.error(msg)
					task.result = msg
					task.error = msg
					if (task.source === 'user') io.notify(msg)
					return
				} else if (count >= 10) {
					// Dampen — strong error message
					logger.warn(`Stuck loop: ${action.tool} called ${count} times with same params — dampening`)
					enrichedContext.messages.push({
						role: 'error',
						content: `ERROR: You have called ${action.tool} with identical parameters ${count} times. You MUST try a completely different approach or respond to the user explaining what you tried.`,
						timestamp: Date.now(),
					})
				} else if (count >= 5) {
					// Warning
					logger.warn(`Stuck loop warning: ${action.tool} called ${count} times with same params`)
					if (count === 5) {
						enrichedContext.messages.push({
							role: 'error',
							content: `Warning: You have called ${action.tool} with the same parameters ${count} times. Try a different approach.`,
							timestamp: Date.now(),
						})
					}
				}
			}

			// Confirm before acting if configured
			if (config.confirmBeforeAct) {
				const toolNames = plan.actions.map((a) => a.tool).join(', ')
				const confirmed = await io.confirm(
					`Execute tools: ${toolNames}?`,
				)
				if (!confirmed) {
					enrichedContext.messages.push({
						role: 'error',
						content: 'User declined to execute planned actions',
						timestamp: Date.now(),
					})
					continue
				}
			}

			const results = await runAct(
				plan.actions,
				plan.execution ?? 'sequential',
				enrichedContext,
				toolRegistry,
				pawRegistry,
			)

			// Track tool executions for rate limiting
			toolExecutionCount += results.length

			// Reset idle counter — progress was made
			const hasSuccess = results.some((r) => r.success)
			if (hasSuccess) {
				idleIterations = 0
			}

			// === OBSERVE ===
			logger.debug(`Phase: ${PHASE_ORDER[3]}`)
			for (const result of results) {
				// Append to context — truncate large results to prevent context blowup
				if (result.success) {
					let content = typeof result.output === 'string'
						? result.output
						: JSON.stringify(result.output)

					// Extract base64 images for proper image handling by brain paws
					let imageBase64: string | undefined
					let imageMimeType: string | undefined

					if (content.includes('image_base64') || content.includes('base64')) {
						try {
							const parsed = JSON.parse(content)
							if (parsed.image_base64) {
								imageBase64 = parsed.image_base64
								imageMimeType = 'image/png'
								// Remove image from text content — brain paw sends it as image block
								parsed.image_base64 = '[image attached separately]'
								content = JSON.stringify(parsed)
							}
						} catch {
							// Not JSON — check for raw base64
						}
					}

					// Truncate large non-image outputs
					if (content.length > 10000) {
						content = content.substring(0, 5000) + '... [truncated, ' + content.length + ' chars total]'
					}

					enrichedContext.messages.push({
						role: 'tool_result',
						content,
						toolCall: {
							name: result.toolName,
							params: null,
						},
						imageBase64,
						imageMimeType,
						timestamp: Date.now(),
					})
				} else {
					enrichedContext.messages.push({
						role: 'error',
						content: result.error?.message ?? 'Unknown tool error',
						toolCall: {
							name: result.toolName,
							params: null,
						},
						timestamp: Date.now(),
					})
				}

				// Fire observe hooks
				pawRegistry.runObserveHooks(result)
			}
		}

		// Update context for next iteration
		Object.assign(context, enrichedContext)
	}

	logCostSummary()

	if (idleIterations >= effectiveMaxIterations) {
		const msg = 'Sorry, I was unable to complete this task. Please try again with a simpler request.'
		logger.warn(
			`Task ${task.id} reached max idle iterations (${effectiveMaxIterations}) after ${context.iteration + 1} total iterations`,
		)
		task.result = msg
		if (task.source === 'user') io.notify(msg)
	}
}

/** Run the Perceive phase — only global hooks (Paws without tools) */
async function runPerceive(
	context: AgentContext,
	pawRegistry: PawRegistry,
	toolRegistry: ToolRegistry,
	skillRegistry: SkillRegistry,
): Promise<AgentContext> {
	// Set available tools and active skills
	const enriched = { ...context }
	enriched.availableTools = toolRegistry.summaries()
	enriched.activeSkills = buildActiveSkills(
		skillRegistry.list(),
		toolRegistry,
	)

	// Only run global perceive hooks (Paws without tools — context enrichers)
	// Paws with tools use lazy perceive, called just before their tool executes
	return pawRegistry.runGlobalPerceiveHooks(enriched)
}

/** Run the Think phase — ask the Brain for a plan */
async function runThink(
	context: AgentContext,
	pawRegistry: PawRegistry,
): Promise<AgentPlan | null | 'BRAIN_ERROR'> {
	try {
		return await pawRegistry.think(context)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		logger.error(`Brain error: ${message}`)

		// Add error to context for next iteration
		context.messages.push({
			role: 'error',
			content: `Brain error: ${message}`,
			timestamp: Date.now(),
		})

		return 'BRAIN_ERROR'
	}
}

/** Run the Act phase — execute tool calls with lazy perceive */
async function runAct(
	actions: PlannedAction[],
	execution: 'parallel' | 'sequential',
	context: AgentContext,
	toolRegistry: ToolRegistry,
	pawRegistry: PawRegistry,
): Promise<ActionResult[]> {
	// Collect unique Paw names from planned actions and run their lazy perceive
	const pawNames = new Set<string>()
	for (const action of actions) {
		const tool = toolRegistry.get(action.tool)
		if (tool) pawNames.add(tool.pawName)
	}

	// Run lazy perceive for each involved Paw (before any tools execute)
	for (const pawName of pawNames) {
		await pawRegistry.runLazyPerceive(pawName, context)
	}

	if (execution === 'parallel') {
		return Promise.all(
			actions.map((action) =>
				executeSingleAction(action, toolRegistry, pawRegistry),
			),
		)
	}

	// Sequential execution
	const results: ActionResult[] = []
	for (const action of actions) {
		const result = await executeSingleAction(action, toolRegistry, pawRegistry)
		results.push(result)
	}
	return results
}

/** Execute a single tool call */
async function executeSingleAction(
	action: PlannedAction,
	toolRegistry: ToolRegistry,
	pawRegistry: PawRegistry,
): Promise<ActionResult> {
	const startTime = Date.now()
	const tool = toolRegistry.get(action.tool)

	if (!tool) {
		return failureResult(
			action.tool,
			'unknown',
			createActionError('TOOL_NOT_FOUND', `Tool "${action.tool}" not found`, {
				toolName: action.tool,
			}),
			Date.now() - startTime,
		)
	}

	// Check if the owning Paw is healthy
	if (!tool.inProcess && !pawRegistry.isHealthy(tool.pawName)) {
		return failureResult(
			action.tool,
			tool.pawName,
			createActionError('PAW_CRASHED', `Paw "${tool.pawName}" is not healthy`, {
				toolName: action.tool,
				pawName: tool.pawName,
			}),
			Date.now() - startTime,
		)
	}

	try {
		// Validate parameters if schema is a proper Zod schema
		if (tool.parameters && typeof tool.parameters.parse === 'function') {
			tool.parameters.parse(action.params)
		}

		const output = await tool.execute(action.params)
		return successResult(action.tool, tool.pawName, output, Date.now() - startTime)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)

		// Determine error code
		const isTimeout = message.toLowerCase().includes('timeout')
		const isPermission = message.toLowerCase().includes('permission')
		const code = isTimeout
			? 'TOOL_TIMEOUT'
			: isPermission
				? 'PERMISSION_DENIED'
				: 'TOOL_EXCEPTION'

		return failureResult(
			action.tool,
			tool.pawName,
			createActionError(code, message, {
				toolName: action.tool,
				pawName: tool.pawName,
				details: err instanceof Error ? err.stack : undefined,
			}),
			Date.now() - startTime,
		)
	}
}
