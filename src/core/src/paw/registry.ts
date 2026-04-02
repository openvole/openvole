import type { AgentContext } from '../context/types.js'
import type { MessageBus } from '../core/bus.js'
import type { ActionResult } from '../core/errors.js'
import type { IpcTransport } from '../core/ipc.js'
import type { ToolRegistry } from '../tool/registry.js'
import { loadInProcessPaw, loadSubprocessPaw, shutdownPaw } from './loader.js'
import { readPawManifest, resolvePawPath } from './manifest.js'
import { validatePermissions } from './sandbox.js'
import type { PawConfig, PawInstance } from './types.js'
import type { AgentPlan } from './types.js'

import { createLogger } from '../core/logger.js'

const logger = createLogger('paw-registry')

/** Perceive hook config for ordering */
export interface PerceiveHookEntry {
	pawName: string
	order: number
	pipeline: boolean
	/** If true, this Paw has tools — its perceive runs lazily before tool execution, not every iteration */
	hasTools: boolean
}

/** Interface for queryable registries (avoids circular imports) */
export interface QueryableSkillRegistry {
	list(): Array<{
		name: string
		active: boolean
		missingTools: string[]
		definition: { description: string }
	}>
}

export interface QueryableTaskQueue {
	list(): Array<{ id: string; source: string; input: string; status: string; createdAt: number }>
	enqueue(
		input: string,
		source?: 'user' | 'schedule' | 'paw',
		options?: { sessionId?: string; metadata?: Record<string, unknown> },
	): { id: string }
}

export interface QueryableScheduler {
	list(): Array<{ id: string; input: string; cron: string; nextRun?: string; createdAt: number }>
}

/** Manages loaded Paws and their lifecycle */
export class PawRegistry {
	private paws = new Map<string, PawInstance>()
	private transports = new Map<string, IpcTransport>()
	private perceiveHooks: PerceiveHookEntry[] = []
	private observeHookPaws: string[] = []
	private bootstrapPaws: string[] = []
	private compactPaws: string[] = []
	private brainPawName: string | undefined
	/** Maps config path → manifest name (e.g. "./paws/paw-ollama" → "@openvole/paw-ollama") */
	private configToManifest = new Map<string, string>()
	private skillRegistry?: QueryableSkillRegistry
	private taskQueue?: QueryableTaskQueue
	private scheduler?: QueryableScheduler
	private security?: import('../config/index.js').SecurityConfig

	constructor(
		private bus: MessageBus,
		private toolRegistry: ToolRegistry,
		private projectRoot: string,
	) {
		// Handle Paw crash events
		this.bus.on('paw:crashed', ({ pawName }) => {
			const instance = this.paws.get(pawName)
			if (instance) {
				instance.healthy = false
				this.toolRegistry.unregister(pawName)
			}
		})
	}

	/** Inject queryable registries (called after construction to avoid circular deps) */
	setQuerySources(
		skills: QueryableSkillRegistry,
		tasks: QueryableTaskQueue,
		scheduler?: QueryableScheduler,
	): void {
		this.skillRegistry = skills
		this.taskQueue = tasks
		this.scheduler = scheduler
	}

	/** Set security config for filesystem sandboxing */
	setSecurity(security?: import('../config/index.js').SecurityConfig): void {
		this.security = security
	}

	/** Load and register a Paw */
	async load(config: PawConfig): Promise<boolean> {
		const pawPath = resolvePawPath(config.name, this.projectRoot)
		const manifest = await readPawManifest(pawPath)

		if (!manifest) {
			logger.error(`Failed to read manifest for "${config.name}"`)
			return false
		}

		// Use manifest name as identity, config name for resolution only
		const pawName = manifest.name

		if (this.paws.has(pawName)) {
			logger.warn(`Paw "${pawName}" is already loaded`)
			return false
		}

		// Track config path → manifest name mapping
		this.configToManifest.set(config.name, pawName)

		// Validate permissions
		validatePermissions(manifest, config)

		try {
			let instance: PawInstance

			if (manifest.inProcess) {
				instance = await loadInProcessPaw(pawPath, manifest, config)
				this.registerInProcessTools(instance)
			} else {
				const result = await loadSubprocessPaw(
					pawPath,
					manifest,
					config,
					this.projectRoot,
					this.security,
					(crashedPaw) => {
						this.bus.emit('paw:crashed', { pawName: crashedPaw })
					},
				)
				instance = result.instance
				this.transports.set(pawName, result.transport)
				this.setupTransportHandlers(pawName, result.transport)

				// Wait for the Paw to register itself
				await this.waitForRegistration(pawName, result.transport)
			}

			this.paws.set(pawName, instance)

			// Track hooks
			if (instance.definition?.hooks?.onPerceive) {
				const hookConfig = config.hooks?.perceive
				const hasTools = (instance.definition?.tools?.length ?? 0) > 0 || manifest.tools.length > 0
				this.perceiveHooks.push({
					pawName,
					order: hookConfig?.order ?? 100,
					pipeline: hookConfig?.pipeline ?? true,
					hasTools,
				})
				this.perceiveHooks.sort((a, b) => a.order - b.order)
			}

			if (instance.definition?.hooks?.onObserve) {
				this.observeHookPaws.push(pawName)
			}

			if (instance.definition?.hooks?.onBootstrap) {
				this.bootstrapPaws.push(pawName)
			}

			if (instance.definition?.hooks?.onCompact) {
				this.compactPaws.push(pawName)
			}

			logger.info(`Paw "${pawName}" loaded successfully`)
			this.bus.emit('paw:registered', { pawName })
			return true
		} catch (err) {
			logger.error(`Failed to load Paw "${pawName}": ${err}`)
			return false
		}
	}

	/** Unload a Paw (accepts config path or manifest name) */
	async unload(name: string): Promise<boolean> {
		// Resolve config path to manifest name if needed
		const pawName = this.configToManifest.get(name) ?? name
		const instance = this.paws.get(pawName)
		if (!instance) {
			logger.warn(`Paw "${pawName}" is not loaded`)
			return false
		}
		// Use resolved name from here
		name = pawName

		// Shutdown the Paw
		await shutdownPaw(instance)

		// Clean up transport
		const transport = this.transports.get(name)
		if (transport) {
			transport.dispose()
			this.transports.delete(name)
		}

		// Remove tools from registry
		this.toolRegistry.unregister(name)

		// Remove hooks
		this.perceiveHooks = this.perceiveHooks.filter((h) => h.pawName !== name)
		this.observeHookPaws = this.observeHookPaws.filter((n) => n !== name)
		this.bootstrapPaws = this.bootstrapPaws.filter((n) => n !== name)
		this.compactPaws = this.compactPaws.filter((n) => n !== name)

		this.paws.delete(name)
		// Clean up config→manifest mapping
		for (const [configName, manifestName] of this.configToManifest) {
			if (manifestName === name) {
				this.configToManifest.delete(configName)
				break
			}
		}
		logger.info(`Paw "${name}" unloaded`)
		this.bus.emit('paw:unregistered', { pawName: name })
		return true
	}

	/** Resolve a config name to its manifest name */
	resolveManifestName(configName: string): string {
		return this.configToManifest.get(configName) ?? configName
	}

	/** Set the Brain Paw name (accepts config path or manifest name) */
	setBrain(name: string): void {
		this.brainPawName = this.configToManifest.get(name) ?? name
	}

	/** Get the Brain Paw name */
	getBrainName(): string | undefined {
		return this.brainPawName
	}

	/** Get a Paw instance */
	get(name: string): PawInstance | undefined {
		return this.paws.get(name)
	}

	/** List all loaded Paws */
	list(): PawInstance[] {
		return Array.from(this.paws.values())
	}

	/** Check if a Paw is healthy */
	isHealthy(name: string): boolean {
		return this.paws.get(name)?.healthy ?? false
	}

	/**
	 * Run GLOBAL perceive hooks — only Paws without tools.
	 * Paws with tools use lazy perceive (called just before their tool executes).
	 */
	async runGlobalPerceiveHooks(context: AgentContext): Promise<AgentContext> {
		let chainedContext = { ...context }

		// Only run hooks from Paws that have NO tools (context-only Paws)
		const globalChained = this.perceiveHooks.filter((h) => h.pipeline && !h.hasTools)
		const globalUnchained = this.perceiveHooks.filter((h) => !h.pipeline && !h.hasTools)

		// Run chained hooks sequentially
		for (const hook of globalChained) {
			const instance = this.paws.get(hook.pawName)
			if (!instance?.healthy) continue

			try {
				chainedContext = await this.callPerceive(hook.pawName, chainedContext)
			} catch (err) {
				logger.error(`Perceive hook error from "${hook.pawName}": ${err}`)
			}
		}

		// Run unchained hooks in parallel on the original context
		if (globalUnchained.length > 0) {
			const results = await Promise.allSettled(
				globalUnchained.map(async (hook) => {
					const instance = this.paws.get(hook.pawName)
					if (!instance?.healthy) return null
					try {
						return await this.callPerceive(hook.pawName, context)
					} catch (err) {
						logger.error(`Unchained perceive error from "${hook.pawName}": ${err}`)
						return null
					}
				}),
			)

			for (const result of results) {
				if (result.status === 'fulfilled' && result.value) {
					Object.assign(chainedContext.metadata, result.value.metadata)
				}
			}
		}

		return chainedContext
	}

	/**
	 * Run LAZY perceive for a specific Paw — called just before its tool executes.
	 * Only runs if the Paw has an onPerceive hook registered.
	 */
	async runLazyPerceive(pawName: string, context: AgentContext): Promise<AgentContext> {
		const hook = this.perceiveHooks.find((h) => h.pawName === pawName && h.hasTools)
		if (!hook) return context

		const instance = this.paws.get(pawName)
		if (!instance?.healthy) return context

		try {
			logger.debug(`Lazy perceive for "${pawName}" before tool execution`)
			return await this.callPerceive(pawName, context)
		} catch (err) {
			logger.error(`Lazy perceive error from "${pawName}": ${err}`)
			return context
		}
	}

	/** Run all Observe hooks concurrently (fire-and-forget) */
	runObserveHooks(result: ActionResult): void {
		for (const pawName of this.observeHookPaws) {
			const instance = this.paws.get(pawName)
			if (!instance?.healthy) continue

			this.callObserve(pawName, result).catch((err) => {
				logger.error(`Observe hook error from "${pawName}": ${err}`)
			})
		}
	}

	/** Run bootstrap hooks — called once at the start of a task */
	async runBootstrapHooks(context: AgentContext): Promise<AgentContext> {
		let ctx = { ...context }

		for (const pawName of this.bootstrapPaws) {
			const instance = this.paws.get(pawName)
			if (!instance?.healthy) continue

			try {
				if (instance.inProcess && instance.definition?.hooks?.onBootstrap) {
					ctx = await instance.definition.hooks.onBootstrap(ctx)
				} else {
					const transport = this.transports.get(pawName)
					if (transport) {
						ctx = (await transport.request('bootstrap', ctx)) as AgentContext
					}
				}
			} catch (err) {
				logger.error(`Bootstrap hook error from "${pawName}": ${err}`)
			}
		}

		return ctx
	}

	/**
	 * Run compact hooks — called when context exceeds size threshold.
	 * Paws can compress/summarize messages to free up context window space.
	 */
	async runCompactHooks(context: AgentContext): Promise<AgentContext> {
		let ctx = { ...context }

		for (const pawName of this.compactPaws) {
			const instance = this.paws.get(pawName)
			if (!instance?.healthy) continue

			try {
				if (instance.inProcess && instance.definition?.hooks?.onCompact) {
					ctx = await instance.definition.hooks.onCompact(ctx)
				} else {
					const transport = this.transports.get(pawName)
					if (transport) {
						ctx = (await transport.request('compact', ctx)) as AgentContext
					}
				}
				logger.info(
					`Compact hook from "${pawName}" reduced messages from ${context.messages.length} to ${ctx.messages.length}`,
				)
			} catch (err) {
				logger.error(`Compact hook error from "${pawName}": ${err}`)
			}
		}

		return ctx
	}

	/** Call the Brain Paw's think function */
	async think(context: AgentContext): Promise<AgentPlan | null> {
		if (!this.brainPawName) return null

		const instance = this.paws.get(this.brainPawName)
		if (!instance?.healthy) {
			logger.error(`Brain Paw "${this.brainPawName}" is not healthy`)
			return null
		}

		if (instance.inProcess && instance.definition?.think) {
			return instance.definition.think(context)
		}

		const transport = this.transports.get(this.brainPawName)
		if (!transport) {
			logger.error(`No transport for Brain Paw "${this.brainPawName}"`)
			return null
		}

		return (await transport.request('think', context)) as AgentPlan
	}

	/** Execute a tool on a subprocess Paw */
	async executeRemoteTool(pawName: string, toolName: string, params: unknown): Promise<unknown> {
		const transport = this.transports.get(pawName)
		if (!transport) {
			throw new Error(`No transport for Paw "${pawName}"`)
		}

		return transport.request('execute_tool', { toolName, params })
	}

	private async callPerceive(pawName: string, context: AgentContext): Promise<AgentContext> {
		const instance = this.paws.get(pawName)!

		if (instance.inProcess && instance.definition?.hooks?.onPerceive) {
			return instance.definition.hooks.onPerceive(context)
		}

		const transport = this.transports.get(pawName)
		if (transport) {
			return (await transport.request('perceive', context)) as AgentContext
		}

		return context
	}

	private async callObserve(pawName: string, result: ActionResult): Promise<void> {
		const instance = this.paws.get(pawName)!

		if (instance.inProcess && instance.definition?.hooks?.onObserve) {
			await instance.definition.hooks.onObserve(result)
			return
		}

		const transport = this.transports.get(pawName)
		if (transport) {
			await transport.request('observe', result)
		}
	}

	private registerInProcessTools(instance: PawInstance): void {
		if (instance.definition?.tools) {
			this.toolRegistry.register(instance.name, instance.definition.tools, true)
		}
	}

	private setupTransportHandlers(pawName: string, transport: IpcTransport): void {
		// Handle Paw → Core: log
		transport.onRequest('log', async (params) => {
			const { level, message } = params as { level: string; message: string }
			const prefix = `[${pawName}]`
			switch (level) {
				case 'error':
					console.error(prefix, message)
					break
				case 'warn':
					console.warn(prefix, message)
					break
				case 'info':
					console.info(prefix, message)
					break
				default:
					console.debug(prefix, message)
			}
			return { ok: true }
		})

		// Handle Paw → Core: emit
		transport.onRequest('emit', async (params) => {
			const { event } = params as { event: string; data: unknown }
			logger.info(`Paw "${pawName}" emitted event: ${event}`)
			return { ok: true }
		})

		// Handle Paw → Core: subscribe to bus events
		transport.onRequest('subscribe', async (params) => {
			const { events } = params as { events: string[] }
			const instance = this.paws.get(pawName)
			if (instance) {
				instance.subscriptions = events
				this.setupBusForwarding(pawName, events, transport)
				logger.info(`Paw "${pawName}" subscribed to events: ${events.join(', ')}`)
			}
			return { ok: true }
		})

		// Handle Paw → Core: query state
		transport.onRequest('query', async (params) => {
			const { type } = params as { type: 'tools' | 'paws' | 'skills' | 'tasks' }
			return this.handleQuery(type)
		})

		// Handle Paw → Core: late tool registration (e.g. MCP tools discovered after initial registration)
		transport.onRequest('register_tools', async (params) => {
			const { tools } = params as { tools: Array<{ name: string; description: string }> }
			if (tools && tools.length > 0) {
				const toolDefs = tools.map((t) => ({
					name: t.name,
					description: t.description,
					parameters: {} as import('zod').ZodSchema,
					execute: async (toolParams: unknown) =>
						this.executeRemoteTool(pawName, t.name, toolParams),
				}))
				this.toolRegistry.register(pawName, toolDefs, false)
				logger.info(`Paw "${pawName}" late-registered ${tools.length} tool(s)`)
			}
			return { ok: true }
		})

		// Handle Paw → Core: create a task (for channel Paws that receive inbound messages)
		transport.onRequest('create_task', async (params) => {
			const { input, source, sessionId, metadata } = params as {
				input: string
				source?: 'paw' | 'schedule'
				sessionId?: string
				metadata?: Record<string, unknown>
			}
			if (!this.taskQueue) {
				return { error: 'Task queue not available' }
			}
			const task = this.taskQueue.enqueue(input, source ?? 'paw', { sessionId, metadata })
			logger.info(`Paw "${pawName}" created task ${task.id}: "${input.substring(0, 50)}"`)
			return { taskId: task.id }
		})
	}

	/** Forward bus events to a Paw that subscribed */
	private setupBusForwarding(pawName: string, events: string[], transport: IpcTransport): void {
		for (const eventName of events) {
			// Use the bus wildcard or specific events
			this.bus.on(eventName as keyof import('../core/bus.js').BusEvents, (data) => {
				const instance = this.paws.get(pawName)
				if (!instance?.healthy) return

				transport.notify('bus_event', { event: eventName, data })
			})
		}
	}

	/** Handle state queries from Paws */
	private handleQuery(type: string): unknown {
		switch (type) {
			case 'tools':
				return this.toolRegistry.list().map((t) => ({
					name: t.name,
					description: t.description,
					pawName: t.pawName,
					inProcess: t.inProcess,
				}))
			case 'paws':
				return Array.from(this.paws.values()).map((p) => ({
					name: p.name,
					healthy: p.healthy,
					inProcess: p.inProcess,
					transport: p.transport,
					category: p.manifest?.category ?? 'tool',
					toolCount: this.toolRegistry.toolsForPaw(p.name).length,
				}))
			case 'skills':
				return (
					this.skillRegistry?.list().map((s) => ({
						name: s.name,
						active: s.active,
						missingTools: s.missingTools,
						description: s.definition.description,
					})) ?? []
				)
			case 'tasks':
				return (
					this.taskQueue?.list().map((t) => {
						const task = t as Record<string, unknown>
						return {
							id: t.id,
							source: t.source,
							input: t.input,
							status: t.status,
							createdAt: t.createdAt,
							startedAt: task.startedAt,
							completedAt: task.completedAt,
							priority: task.priority,
							metadata: task.metadata
								? { cost: (task.metadata as Record<string, unknown>).cost }
								: undefined,
						}
					}) ?? []
				)
			case 'schedules':
				return this.scheduler?.list() ?? []
			case 'volenet': {
				const voleNet = (globalThis as any).__volenet__
				if (!voleNet?.isActive()) {
					return { enabled: false }
				}
				const instances = voleNet.getInstances()
				const remoteTools = voleNet.getRemoteTools()
				const leader = voleNet.getLeader()
				const keyPair = voleNet.getKeyPair()
				return {
					enabled: true,
					instanceId: keyPair?.instanceId?.substring(0, 8) ?? 'unknown',
					instanceName: voleNet.config?.instanceName ?? 'vole',
					isLeader: voleNet.isLeader(),
					leaderState: leader?.getState() ?? null,
					peers: instances.map((i: any) => ({
						id: i.id.substring(0, 8),
						name: i.name,
						role: i.role,
						capabilities: i.capabilities?.length ?? 0,
						lastSeen: i.lastSeen,
					})),
					remoteTools: remoteTools.length,
				}
			}
			default:
				return { error: `Unknown query type: ${type}` }
		}
	}

	private async waitForRegistration(pawName: string, transport: IpcTransport): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Paw "${pawName}" did not register within 10 seconds`))
			}, 10_000)

			transport.onRequest('register', async (params) => {
				clearTimeout(timeout)
				const registration = params as {
					tools?: Array<{ name: string; description: string }>
					hooks?: {
						bootstrap?: boolean
						perceive?: boolean
						observe?: boolean
						compact?: boolean
						schedule?: string[]
					}
				}

				// Register tools from subprocess Paw using manifest tool descriptions
				// The actual execute calls are routed through IPC
				if (registration.tools) {
					const toolDefs = registration.tools.map((t) => ({
						name: t.name,
						description: t.description,
						parameters: {} as import('zod').ZodSchema, // Schema validated on Paw side
						execute: async (toolParams: unknown) =>
							this.executeRemoteTool(pawName, t.name, toolParams),
					}))
					this.toolRegistry.register(pawName, toolDefs, false)
				}

				// Track hooks for subprocess Paws
				if (registration.hooks?.bootstrap) {
					this.bootstrapPaws.push(pawName)
				}
				if (registration.hooks?.perceive) {
					const config = this.paws.get(pawName)?.config
					const hookConfig = config?.hooks?.perceive
					const hasTools = (registration.tools?.length ?? 0) > 0
					this.perceiveHooks.push({
						pawName,
						order: hookConfig?.order ?? 100,
						pipeline: hookConfig?.pipeline ?? true,
						hasTools,
					})
					this.perceiveHooks.sort((a, b) => a.order - b.order)
				}
				if (registration.hooks?.observe) {
					this.observeHookPaws.push(pawName)
				}
				if (registration.hooks?.compact) {
					this.compactPaws.push(pawName)
				}

				logger.info(`Paw "${pawName}" registered with ${registration.tools?.length ?? 0} tools`)
				resolve()
				return { ok: true }
			})
		})
	}
}
