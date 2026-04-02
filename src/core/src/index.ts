// === Public API Surface ===

// Config
export {
	defineConfig,
	loadConfig,
} from './config/index.js'
export type { VoleConfig, LoopConfig, HeartbeatConfig, RateLimits } from './config/index.js'

// Core
export { createMessageBus } from './core/bus.js'
export type { MessageBus, BusEvents } from './core/bus.js'
export { runAgentLoop } from './core/loop.js'
export type { LoopDependencies } from './core/loop.js'
export { TaskQueue } from './core/task.js'
export type { AgentTask, TaskStatus, TaskPriority } from './core/task.js'
export { SchedulerStore } from './core/scheduler.js'
export { ContextBudgetManager } from './core/context-budget.js'
export type { TokenBudget } from './core/context-budget.js'
export { CostTracker } from './core/cost-tracker.js'
export type { CostEntry, TaskCostSummary } from './core/cost-tracker.js'
export type { AgentProfile, DockerSandboxConfig } from './config/index.js'
export { DockerSandboxManager } from './paw/docker-sandbox.js'
export { VoleHubClient } from './skill/volehub.js'
export type { VoleHubSkill, VoleHubIndex } from './skill/volehub.js'
export { VoleNetManager } from './net/index.js'
export type { VoleNetConfig } from './net/index.js'
export { buildSystemPrompt, loadSystemPromptContent } from './core/system-prompt.js'
export type { SystemPromptContent } from './core/system-prompt.js'
export { Vault } from './core/vault.js'
export type { VaultEntry } from './core/vault.js'
export { PHASE_ORDER } from './core/hooks.js'
export type { LoopPhase } from './core/hooks.js'
export { RateLimiter } from './core/rate-limiter.js'

// Errors
export {
	createActionError,
	successResult,
	failureResult,
} from './core/errors.js'
export type { ActionError, ActionResult, ActionErrorCode } from './core/errors.js'

// Tool
export { ToolRegistry } from './tool/registry.js'
export type { ToolDefinition, ToolRegistryEntry } from './tool/types.js'

// Context
export { createAgentContext } from './context/types.js'
export type {
	AgentContext,
	AgentMessage,
	ToolSummary,
	ActiveSkill,
} from './context/types.js'

// Paw
export { PawRegistry } from './paw/registry.js'
export { readPawManifest, resolvePawPath } from './paw/manifest.js'
export {
	computeEffectivePermissions,
	validatePermissions,
} from './paw/sandbox.js'
export type {
	PawDefinition,
	PawManifest,
	PawConfig,
	PawInstance,
	AgentPlan,
	PlannedAction,
	BootstrapHook,
	PerceiveHook,
	ObserveHook,
	CompactHook,
	ScheduleHook,
	TransportType,
	EffectivePermissions,
} from './paw/types.js'

// Skill
export { SkillRegistry } from './skill/registry.js'
export { resolveSkills, buildActiveSkills } from './skill/resolver.js'
export type {
	SkillDefinition,
	SkillInstance,
} from './skill/types.js'

// IO
export { createTtyIO } from './io/tty.js'
export type { VoleIO } from './io/types.js'

// === Engine — the main orchestrator ===

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { type VoleConfig, loadConfig, normalizePawConfig } from './config/index.js'
import { createMessageBus } from './core/bus.js'
import { closeLogger } from './core/logger.js'
import { runAgentLoop } from './core/loop.js'
import { RateLimiter } from './core/rate-limiter.js'
import { SchedulerStore } from './core/scheduler.js'
import { type SystemPromptContent, loadSystemPromptContent } from './core/system-prompt.js'
import { TaskQueue } from './core/task.js'
import { Vault } from './core/vault.js'
import { createTtyIO } from './io/tty.js'
import type { VoleIO } from './io/types.js'
import { PawRegistry } from './paw/registry.js'
import { SkillRegistry } from './skill/registry.js'
import { createCoreTools } from './tool/core-tools.js'
import { ToolRegistry } from './tool/registry.js'

export interface VoleEngine {
	bus: ReturnType<typeof createMessageBus>
	toolRegistry: ToolRegistry
	pawRegistry: PawRegistry
	skillRegistry: SkillRegistry
	taskQueue: TaskQueue
	io: VoleIO
	config: VoleConfig

	/** Start the engine — load Paws and Skills */
	start(): Promise<void>
	/** Submit a task for execution */
	run(
		input: string,
		source?: 'user' | 'schedule' | 'heartbeat' | 'paw' | 'agent',
		sessionId?: string,
	): void
	/** Graceful shutdown */
	shutdown(): Promise<void>
}

import { createLogger } from './core/logger.js'

const engineLogger = createLogger('openvole')

/** Create and initialize the OpenVole engine */
export async function createEngine(
	projectRoot: string,
	options?: { io?: VoleIO; configPath?: string; headless?: boolean },
): Promise<VoleEngine> {
	const configPath = options?.configPath ?? path.resolve(projectRoot, 'vole.config.ts')
	const config = await loadConfig(configPath)

	const bus = createMessageBus()
	const toolRegistry = new ToolRegistry(bus)
	const pawRegistry = new PawRegistry(bus, toolRegistry, projectRoot)
	const skillRegistry = new SkillRegistry(bus, toolRegistry, projectRoot)
	const io = options?.io ?? createTtyIO()
	const rateLimiter = new RateLimiter()
	const taskQueue = new TaskQueue(
		bus,
		config.loop.taskConcurrency,
		rateLimiter,
		config.loop.rateLimits,
	)
	const scheduler = new SchedulerStore()
	scheduler.setPersistence(path.resolve(projectRoot, '.openvole', 'schedules.json'))
	scheduler.setTickHandler((input) => {
		taskQueue.enqueue(input, 'schedule')
	})
	const vault = new Vault(
		path.resolve(projectRoot, '.openvole', 'vault.json'),
		process.env.VOLE_VAULT_KEY,
	)
	await vault.init()

	// Register built-in core tools
	const coreTools = createCoreTools(
		scheduler,
		taskQueue,
		projectRoot,
		skillRegistry,
		vault,
		toolRegistry,
	)
	toolRegistry.register('__core__', coreTools, true)

	// Enable Tool Horizon if configured
	if (config.loop.toolHorizon) {
		toolRegistry.setHorizon(true)
		// Memory, session, and compact paws are always visible (infrastructure)
		toolRegistry.addAlwaysVisiblePaw('@openvole/paw-memory')
		toolRegistry.addAlwaysVisiblePaw('@openvole/paw-session')
		toolRegistry.addAlwaysVisiblePaw('@openvole/paw-compact')
	}

	// Wire up query sources so Paws can query skills and tasks
	pawRegistry.setQuerySources(skillRegistry, taskQueue, scheduler)
	pawRegistry.setSecurity(config.security)

	// System prompt content — loaded on start(), used by the loop
	let promptContent: SystemPromptContent | undefined

	// Wire up the task runner
	taskQueue.setRunner(async (task) => {
		// Check if we should delegate to a remote brain
		const voleNet = (globalThis as any).__volenet__
		if (voleNet?.isActive()) {
			const targetBrain = voleNet.shouldDelegateBrain()
			if (targetBrain) {
				const remoteMgr = voleNet.getRemoteTaskManager()
				if (remoteMgr) {
					engineLogger.info(`Delegating task to remote brain: ${targetBrain.substring(0, 8)}`)
					const result = await remoteMgr.delegateTask(targetBrain, {
						taskId: task.id,
						input: task.input,
						maxIterations: config.loop.maxIterations,
					})
					task.result = result.result ?? result.error ?? 'Remote task completed'
					if (result.status === 'failed') task.error = result.error ?? 'Remote task failed'
					if (task.source === 'user') io.notify(task.result ?? 'Done')
					return
				}
			}
		}

		await runAgentLoop(task, {
			bus,
			toolRegistry,
			pawRegistry,
			skillRegistry,
			io,
			config: config.loop,
			toolProfiles: config.toolProfiles,
			rateLimiter,
			systemPromptContent: promptContent,
		})
	})

	let shuttingDown = false

	const engine: VoleEngine = {
		bus,
		toolRegistry,
		pawRegistry,
		skillRegistry,
		taskQueue,
		io,
		config,

		async start() {
			engineLogger.info('Starting OpenVole...')
			const headless = options?.headless ?? false

			// Set Brain (setBrain resolves config path → manifest name after load)
			if (config.brain) {
				// setBrain is called after brain paw loads (below) so the mapping exists
			} else {
				engineLogger.info('No Brain Paw configured — Think step will be a no-op')
			}

			// In headless mode, skip dashboard and channel paws (telegram, slack, discord, whatsapp)
			const headlessSkipPatterns = [
				'paw-dashboard',
				'paw-telegram',
				'paw-slack',
				'paw-discord',
				'paw-whatsapp',
			]

			// Load Paws (Brain first, then others, in-process last)
			const pawConfigs = config.paws.map(normalizePawConfig)
			const brainConfig = pawConfigs.find((p) => p.name === config.brain)
			const subprocessPaws = pawConfigs.filter((p) => p.name !== config.brain)

			// Load Brain Paw first
			if (brainConfig) {
				const ok = await pawRegistry.load(brainConfig)
				if (ok) {
					pawRegistry.setBrain(config.brain!)
					engineLogger.info(`Brain Paw: ${pawRegistry.resolveManifestName(config.brain!)}`)
				} else {
					engineLogger.error(
						`Brain Paw "${brainConfig.name}" failed to load — running in no-op Think mode`,
					)
					pawRegistry.setBrain('')
				}
			}

			// Load system prompt content (BRAIN.md + identity files)
			const brainManifestName = config.brain
				? pawRegistry.resolveManifestName(config.brain)
				: undefined
			promptContent = await loadSystemPromptContent(projectRoot, brainManifestName)

			// Load other Paws in parallel
			const pawsToLoad = headless
				? subprocessPaws.filter((p) => !headlessSkipPatterns.some((pat) => p.name.includes(pat)))
				: subprocessPaws
			await Promise.all(pawsToLoad.map((pawConfig) => pawRegistry.load(pawConfig)))

			// Load Skills
			for (const skillName of config.skills) {
				await skillRegistry.load(skillName)
			}

			// Final resolver pass
			skillRegistry.resolve()

			// Restore persisted schedules from disk (skip in headless — vole run shouldn't touch schedules)
			if (!headless) {
				await scheduler.restore()
			} else {
				// In headless mode, use loadFromDisk for read-only access (no persistence)
				await scheduler.loadFromDisk()
			}

			// Start heartbeat via scheduler (skip in headless mode)
			if (config.heartbeat.enabled && !headless) {
				const heartbeatMdPath = path.resolve(projectRoot, '.openvole', 'HEARTBEAT.md')
				// Convert intervalMinutes to cron expression (e.g. 30 → "*/30 * * * *")
				const heartbeatCron = `*/${config.heartbeat.intervalMinutes} * * * *`
				scheduler.add(
					'__heartbeat__',
					'Heartbeat wake-up',
					heartbeatCron,
					async () => {
						let heartbeatContent = ''
						try {
							heartbeatContent = await fs.readFile(heartbeatMdPath, 'utf-8')
						} catch {
							// No HEARTBEAT.md — use default prompt
						}

						const input = heartbeatContent
							? `Heartbeat wake-up. Review your HEARTBEAT.md jobs and act on what is needed:\n\n${heartbeatContent}`
							: 'Heartbeat wake-up. Check active skills and decide if any actions are needed.'

						taskQueue.enqueue(input, 'heartbeat')
					},
					undefined,
					config.heartbeat.runOnStart ?? false,
				)
				engineLogger.info(
					`Heartbeat enabled — cron: ${heartbeatCron}${config.heartbeat.runOnStart ? ', running now' : ''}`,
				)
			}

			// Start VoleNet if configured
			const netConfig = (config as any).net as import('./net/index.js').VoleNetConfig | undefined
			if (netConfig?.enabled) {
				;(globalThis as any).__volenet_taskqueue__ = taskQueue
				try {
					const { VoleNetManager } = await import('./net/index.js')
					const voleNet = new VoleNetManager(netConfig, projectRoot)
					await voleNet.start(toolRegistry, bus)
					;(engine as any).__volenet__ = voleNet
					engineLogger.info(`VoleNet active — ${voleNet.getInstances().length} peer(s) connected`)
				} catch (err) {
					engineLogger.error(
						`VoleNet failed to start: ${err instanceof Error ? err.message : String(err)}`,
					)
				}
			}

			engineLogger.info(
				`Ready — ${toolRegistry.list().length} tools, ` +
					`${pawRegistry.list().length} paws, ` +
					`${skillRegistry.active().length}/${skillRegistry.list().length} skills active`,
			)
		},

		run(input, source = 'user', sessionId?) {
			taskQueue.enqueue(input, source, sessionId ? { sessionId } : undefined)
		},

		async shutdown() {
			if (shuttingDown) return
			shuttingDown = true
			engineLogger.info('Shutting down...')
			// Stop VoleNet
			const voleNet = (engine as any).__volenet__
			if (voleNet) {
				await voleNet.stop()
			}
			scheduler.clearAll()
			taskQueue.cancelAll()
			await Promise.all(pawRegistry.list().map((paw) => pawRegistry.unload(paw.name)))
			toolRegistry.clear()
			engineLogger.info('Shutdown complete')
			closeLogger()
		},
	}

	return engine
}
