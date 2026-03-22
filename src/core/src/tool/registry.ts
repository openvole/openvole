import type { ToolDefinition, ToolRegistryEntry } from './types.js'
import type { ToolSummary } from '../context/types.js'
import type { MessageBus } from '../core/bus.js'
import { createLogger } from '../core/logger.js'

const logger = createLogger('tool-registry')

/** Convert a Zod schema to a serializable JSON Schema object */
function zodToJsonSchema(schema: unknown): Record<string, unknown> | undefined {
	if (!schema || typeof schema !== 'object') return undefined

	try {
		const zodSchema = schema as { _def?: { shape?: () => Record<string, unknown> }; shape?: Record<string, unknown> }
		const shape = typeof zodSchema._def?.shape === 'function' ? zodSchema._def.shape() : zodSchema.shape
		if (!shape || typeof shape !== 'object') return undefined

		const properties: Record<string, unknown> = {}
		const required: string[] = []

		for (const [key, val] of Object.entries(shape)) {
			const field = val as { _def?: { typeName?: string; description?: string; innerType?: { _def?: { typeName?: string; values?: string[] } }; values?: string[] } }
			const isOptional = field?._def?.typeName === 'ZodOptional' || field?._def?.typeName === 'ZodDefault'
			const inner = isOptional ? field?._def?.innerType?._def : field?._def
			const typeName = inner?.typeName

			let type = 'string'
			if (typeName === 'ZodNumber') type = 'number'
			else if (typeName === 'ZodBoolean') type = 'boolean'
			else if (typeName === 'ZodRecord') type = 'object'

			const prop: Record<string, unknown> = { type }
			const description = field?._def?.description
			if (description) prop.description = description
			if (typeName === 'ZodEnum') {
				prop.enum = inner?.values
			}

			properties[key] = prop
			if (!isOptional) required.push(key)
		}

		return {
			type: 'object',
			properties,
			...(required.length > 0 ? { required } : {}),
		}
	} catch {
		return undefined
	}
}

export class ToolRegistry {
	private tools = new Map<string, ToolRegistryEntry>()

	constructor(private bus: MessageBus) {}

	/** Register tools from a Paw. Auto-prefixes with paw name on conflict. */
	register(pawName: string, tools: ToolDefinition[], inProcess: boolean): void {
		for (const tool of tools) {
			let toolName = tool.name
			if (this.tools.has(toolName)) {
				const existing = this.tools.get(toolName)!
				// Auto-prefix with paw name to resolve conflict
				const prefix = pawName.replace(/^@openvole\//, '').replace(/-/g, '_')
				toolName = `${prefix}_${tool.name}`
				logger.warn(
					`Tool name conflict: "${tool.name}" already registered by "${existing.pawName}", ` +
						`registering as "${toolName}" from "${pawName}"`,
				)
			}

			this.tools.set(toolName, {
				name: toolName,
				description: tool.description,
				parameters: tool.parameters,
				pawName,
				inProcess,
				execute: tool.execute,
			})

			logger.debug(`Registered tool "${toolName}" from "${pawName}"`)
			this.bus.emit('tool:registered', { toolName, pawName })
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
			parameters: zodToJsonSchema(t.parameters),
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
