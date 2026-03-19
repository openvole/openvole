import type { PawDefinition, AgentContext, ActionResult } from './types.js'
import { createIpcTransport } from './transport.js'

/**
 * definePaw — the primary export for Paw developers.
 *
 * For in-process Paws, this simply returns the definition (loaded directly by core).
 * For subprocess Paws, this sets up the IPC transport and registers handlers.
 */
export function definePaw(definition: PawDefinition): PawDefinition {
	// If this module is being imported by the core (in-process), just return the definition
	if (definition.inProcess || !isSubprocess()) {
		return definition
	}

	// Running as a subprocess — wire up IPC transport
	setupSubprocessPaw(definition)
	return definition
}

/** Check if we're running as a subprocess (have IPC channel) */
function isSubprocess(): boolean {
	return typeof process.send === 'function'
}

/** Set up IPC handlers for a subprocess Paw */
function setupSubprocessPaw(definition: PawDefinition): void {
	const transport = createIpcTransport()

	// Register with the core
	transport.send('register', {
		name: definition.name,
		version: definition.version,
		brain: definition.brain ?? false,
		tools: (definition.tools ?? []).map((t) => ({
			name: t.name,
			description: t.description,
		})),
		hooks: {
			bootstrap: !!definition.hooks?.onBootstrap,
			perceive: !!definition.hooks?.onPerceive,
			observe: !!definition.hooks?.onObserve,
			compact: !!definition.hooks?.onCompact,
			schedule: (definition.hooks?.onSchedule ?? []).map((s) => s.cron),
		},
	})

	// Handle bootstrap — called once at task start
	if (definition.hooks?.onBootstrap) {
		transport.onRequest('bootstrap', async (params) => {
			return definition.hooks!.onBootstrap!(params as AgentContext)
		})
	}

	// Handle perceive
	if (definition.hooks?.onPerceive) {
		transport.onRequest('perceive', async (params) => {
			return definition.hooks!.onPerceive!(params as AgentContext)
		})
	}

	// Handle think (Brain Paw)
	if (definition.think) {
		transport.onRequest('think', async (params) => {
			return definition.think!(params as AgentContext)
		})
	}

	// Handle tool execution
	if (definition.tools && definition.tools.length > 0) {
		const toolMap = new Map(definition.tools.map((t) => [t.name, t]))

		transport.onRequest('execute_tool', async (params) => {
			const { toolName, params: toolParams } = params as {
				toolName: string
				params: unknown
			}

			const tool = toolMap.get(toolName)
			if (!tool) {
				throw new Error(`Tool "${toolName}" not found in this Paw`)
			}

			// Validate parameters
			const validated = tool.parameters.parse(toolParams)
			return tool.execute(validated)
		})
	}

	// Handle observe
	if (definition.hooks?.onObserve) {
		transport.onRequest('observe', async (params) => {
			await definition.hooks!.onObserve!(params as ActionResult)
			return { ok: true }
		})
	}

	// Handle compact — called when context exceeds threshold
	if (definition.hooks?.onCompact) {
		transport.onRequest('compact', async (params) => {
			return definition.hooks!.onCompact!(params as AgentContext)
		})
	}

	// Handle shutdown
	transport.onRequest('shutdown', async () => {
		if (definition.onUnload) {
			await definition.onUnload()
		}
		process.exit(0)
	})

	// Run onLoad
	if (definition.onLoad) {
		definition.onLoad({}).catch((err) => {
			console.error(`[${definition.name}] onLoad failed:`, err)
			process.exit(1)
		})
	}
}
