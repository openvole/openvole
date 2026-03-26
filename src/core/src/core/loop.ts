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
}

/**
 * Run the agent loop for a single task.
 * Perceive → Think → Act → Observe → loop
 */
export async function runAgentLoop(
	task: AgentTask,
	deps: LoopDependencies,
): Promise<void> {
	const { bus, toolRegistry, pawRegistry, skillRegistry, io, config, toolProfiles, rateLimiter } = deps
	const rateLimits = config.rateLimits
	let toolExecutionCount = 0
	logger.info(`Agent loop started for task ${task.id}: "${task.input}"`)

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

	for (
		context.iteration = 0;
		context.iteration < effectiveMaxIterations;
		context.iteration++
	) {
		// Check cancellation
		if (task.status === 'cancelled') {
			logger.info(`Task ${task.id} cancelled at iteration ${context.iteration}`)
			return
		}

		logger.info(
			`Loop running — iteration ${context.iteration + 1}/${config.maxIterations}`,
		)

		// === PERCEIVE (global only — lazy perceive runs in Act) ===
		logger.debug(`Phase: ${PHASE_ORDER[0]}`)
		const enrichedContext = await runPerceive(context, pawRegistry, toolRegistry, skillRegistry)

		// === COMPACT — compress context if it exceeds threshold ===
		// Runs after perceive so compaction sees everything before the Brain does
		if (
			config.compactThreshold > 0 &&
			enrichedContext.messages.length > config.compactThreshold
		) {
			logger.info(
				`Context has ${enrichedContext.messages.length} messages (threshold: ${config.compactThreshold}), running compact`,
			)
			const compacted = await pawRegistry.runCompactHooks(enrichedContext)
			enrichedContext.messages = compacted.messages
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
		logger.debug(`Phase: ${PHASE_ORDER[1]}`)
		const plan = await runThink(enrichedContext, pawRegistry)
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
					`Brain Paw failed ${MAX_BRAIN_FAILURES} consecutive times. Halting task ${task.id}.`,
				)
				task.error = `Brain failed ${MAX_BRAIN_FAILURES} consecutive times`
				return
			}
			continue
		}

		consecutiveBrainFailures = 0

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

			if (plan.response) {
				task.result = plan.response
				if (task.source === 'user') io.notify(plan.response)
				enrichedContext.messages.push({
					role: 'brain',
					content: plan.response,
					timestamp: Date.now(),
				})
			}
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

			// Log tool calls
			for (const action of plan.actions) {
				logger.info(`Tool call: ${action.tool}(${JSON.stringify(action.params)})`)
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

			// === OBSERVE ===
			logger.debug(`Phase: ${PHASE_ORDER[3]}`)
			for (const result of results) {
				// Append to context
				if (result.success) {
					enrichedContext.messages.push({
						role: 'tool_result',
						content: typeof result.output === 'string'
							? result.output
							: JSON.stringify(result.output),
						toolCall: {
							name: result.toolName,
							params: null,
						},
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

	if (context.iteration >= effectiveMaxIterations) {
		logger.warn(
			`Task ${task.id} reached max iterations (${effectiveMaxIterations})`,
		)
		io.notify(
			`Task reached maximum iterations (${effectiveMaxIterations}). Stopping.`,
		)
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
