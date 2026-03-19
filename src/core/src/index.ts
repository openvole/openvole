// === Public API Surface ===

// Config
export {
	defineConfig,
	loadConfig,
	readLockFile,
	writeLockFile,
	addPawToLock,
	removePawFromLock,
	addSkillToLock,
	removeSkillFromLock,
} from './config/index.js'
export type { VoleConfig, LoopConfig, HeartbeatConfig, VoleLock, RateLimits } from './config/index.js'

// Core
export { createMessageBus } from './core/bus.js'
export type { MessageBus, BusEvents } from './core/bus.js'
export { runAgentLoop } from './core/loop.js'
export type { LoopDependencies } from './core/loop.js'
export { TaskQueue } from './core/task.js'
export type { AgentTask, TaskStatus } from './core/task.js'
export { SchedulerStore } from './core/scheduler.js'
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

import * as path from 'node:path'
import { createMessageBus } from './core/bus.js'
import { ToolRegistry } from './tool/registry.js'
import { PawRegistry } from './paw/registry.js'
import { SkillRegistry } from './skill/registry.js'
import { TaskQueue } from './core/task.js'
import { runAgentLoop } from './core/loop.js'
import { createTtyIO } from './io/tty.js'
import { loadConfig, normalizePawConfig, type VoleConfig } from './config/index.js'
import type { VoleIO } from './io/types.js'
import * as fs from 'node:fs/promises'
import { SchedulerStore } from './core/scheduler.js'
import { createCoreTools } from './tool/core-tools.js'
import { RateLimiter } from './core/rate-limiter.js'

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
	run(input: string, source?: 'user' | 'schedule' | 'heartbeat' | 'paw', sessionId?: string): void
	/** Graceful shutdown */
	shutdown(): Promise<void>
}

const engineLogger = {
	info: (msg: string, ...args: unknown[]) =>
		console.info(`[openvole] ${msg}`, ...args),
	error: (msg: string, ...args: unknown[]) =>
		console.error(`[openvole] ${msg}`, ...args),
}

/** Create and initialize the OpenVole engine */
export async function createEngine(
	projectRoot: string,
	options?: { io?: VoleIO; configPath?: string },
): Promise<VoleEngine> {
	const configPath =
		options?.configPath ?? path.resolve(projectRoot, 'vole.config.ts')
	const config = await loadConfig(configPath)

	const bus = createMessageBus()
	const toolRegistry = new ToolRegistry(bus)
	const pawRegistry = new PawRegistry(bus, toolRegistry, projectRoot)
	const skillRegistry = new SkillRegistry(bus, toolRegistry, projectRoot)
	const io = options?.io ?? createTtyIO()
	const rateLimiter = new RateLimiter()
	const taskQueue = new TaskQueue(bus, config.loop.taskConcurrency, rateLimiter, config.loop.rateLimits)
	const scheduler = new SchedulerStore()

	// Register built-in core tools
	const coreTools = createCoreTools(scheduler, taskQueue, projectRoot, skillRegistry)
	toolRegistry.register('__core__', coreTools, true)

	// Wire up query sources so Paws can query skills and tasks
	pawRegistry.setQuerySources(skillRegistry, taskQueue, scheduler)

	// Wire up the task runner
	taskQueue.setRunner(async (task) => {
		await runAgentLoop(task, {
			bus,
			toolRegistry,
			pawRegistry,
			skillRegistry,
			io,
			config: config.loop,
			toolProfiles: config.toolProfiles,
			rateLimiter,
		})
	})

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

			// Set Brain (setBrain resolves config path → manifest name after load)
			if (config.brain) {
				// setBrain is called after brain paw loads (below) so the mapping exists
			} else {
				engineLogger.info('No Brain Paw configured — Think step will be a no-op')
			}

			// Load Paws (Brain first, then others, in-process last)
			const pawConfigs = config.paws.map(normalizePawConfig)
			const brainConfig = pawConfigs.find((p) => p.name === config.brain)
			const subprocessPaws = pawConfigs.filter(
				(p) => p.name !== config.brain,
			)

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

			// Load other Paws
			for (const pawConfig of subprocessPaws) {
				await pawRegistry.load(pawConfig)
			}

			// Load Skills
			for (const skillName of config.skills) {
				await skillRegistry.load(skillName)
			}

			// Final resolver pass
			skillRegistry.resolve()

			// Start heartbeat via scheduler (shows up in Schedules panel)
			if (config.heartbeat.enabled) {
				const heartbeatMdPath = path.resolve(projectRoot, 'HEARTBEAT.md')
				scheduler.add(
					'__heartbeat__',
					'Heartbeat wake-up',
					config.heartbeat.intervalMinutes,
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
				)
				engineLogger.info(`Heartbeat enabled — interval: ${config.heartbeat.intervalMinutes}m`)
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
			engineLogger.info('Shutting down...')
			scheduler.clearAll()
			for (const paw of pawRegistry.list()) {
				await pawRegistry.unload(paw.name)
			}
			toolRegistry.clear()
			engineLogger.info('Shutdown complete')
		},
	}

	return engine
}
