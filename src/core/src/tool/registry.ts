import type { ToolDefinition, ToolRegistryEntry } from './types.js'
import type { ToolSummary } from '../context/types.js'
import type { MessageBus } from '../core/bus.js'
import { createLogger } from '../core/logger.js'

const logger = createLogger('tool-registry')

export class ToolRegistry {
	private tools = new Map<string, ToolRegistryEntry>()

	constructor(private bus: MessageBus) {}

	/** Register tools from a Paw. Skips tools with conflicting names. */
	register(pawName: string, tools: ToolDefinition[], inProcess: boolean): void {
		for (const tool of tools) {
			if (this.tools.has(tool.name)) {
				const existing = this.tools.get(tool.name)!
				logger.warn(
					`Tool name conflict: "${tool.name}" already registered by "${existing.pawName}", ` +
						`ignoring registration from "${pawName}"`,
				)
				continue
			}

			this.tools.set(tool.name, {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
				pawName,
				inProcess,
				execute: tool.execute,
			})

			logger.debug(`Registered tool "${tool.name}" from "${pawName}"`)
			this.bus.emit('tool:registered', { toolName: tool.name, pawName })
		}
	}

	/** Remove all tools owned by a specific Paw */
	unregister(pawName: string): void {
		const toRemove: string[] = []
		for (const [name, entry] of this.tools) {
			if (entry.pawName === pawName) {
				toRemove.push(name)
			}
		}

		for (const name of toRemove) {
			this.tools.delete(name)
			logger.info(`Unregistered tool "${name}" from "${pawName}"`)
			this.bus.emit('tool:unregistered', { toolName: name, pawName })
		}
	}

	/** Get a tool entry by name */
	get(toolName: string): ToolRegistryEntry | undefined {
		return this.tools.get(toolName)
	}

	/** List all registered tools */
	list(): ToolRegistryEntry[] {
		return Array.from(this.tools.values())
	}

	/** Check if a tool exists */
	has(toolName: string): boolean {
		return this.tools.has(toolName)
	}

	/** Get tool summaries for AgentContext */
	summaries(): ToolSummary[] {
		return this.list().map((t) => ({
			name: t.name,
			description: t.description,
			pawName: t.pawName,
			parameters: t.parameters,
		}))
	}

	/** Get all tool names owned by a specific Paw */
	toolsForPaw(pawName: string): string[] {
		return this.list()
			.filter((t) => t.pawName === pawName)
			.map((t) => t.name)
	}

	/** Clear all tools (for shutdown) */
	clear(): void {
		this.tools.clear()
	}
}
