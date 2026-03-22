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
import { Vault } from './core/vault.js'
import { closeLogger } from './core/logger.js'

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
	options?: { io?: VoleIO; configPath?: string; headless?: boolean },
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
	const coreTools = createCoreTools(scheduler, taskQueue, projectRoot, skillRegistry, vault)
	toolRegistry.register('__core__', coreTools, true)

	// Wire up query sources so Paws can query skills and tasks
	pawRegistry.setQuerySources(skillRegistry, taskQueue, scheduler)
	pawRegistry.setSecurity(config.security)

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
			const headlessSkipPatterns = ['paw-dashboard', 'paw-telegram', 'paw-slack', 'paw-discord', 'paw-whatsapp']

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
				engineLogger.info(`Heartbeat enabled — cron: ${heartbeatCron}${config.heartbeat.runOnStart ? ', running now' : ''}`)
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
			scheduler.clearAll()
			taskQueue.cancelAll()
			for (const paw of pawRegistry.list()) {
				await pawRegistry.unload(paw.name)
			}
			toolRegistry.clear()
			engineLogger.info('Shutdown complete')
			closeLogger()
		},
	}

	return engine
}
