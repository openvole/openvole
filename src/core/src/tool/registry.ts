import type { ToolSummary } from '../context/types.js'
import type { MessageBus } from '../core/bus.js'
import { createLogger } from '../core/logger.js'
import type { ToolDefinition, ToolRegistryEntry } from './types.js'

const logger = createLogger('tool-registry')

/** Convert a Zod schema to a serializable JSON Schema object */
function zodToJsonSchema(schema: unknown): Record<string, unknown> | undefined {
	if (!schema || typeof schema !== 'object') return undefined

	try {
		const zodSchema = schema as {
			_def?: { shape?: () => Record<string, unknown> }
			shape?: Record<string, unknown>
		}
		const shape =
			typeof zodSchema._def?.shape === 'function' ? zodSchema._def.shape() : zodSchema.shape
		if (!shape || typeof shape !== 'object') return undefined

		const properties: Record<string, unknown> = {}
		const required: string[] = []

		for (const [key, val] of Object.entries(shape)) {
			const field = val as {
				_def?: {
					typeName?: string
					description?: string
					innerType?: { _def?: { typeName?: string; values?: string[] } }
					values?: string[]
				}
			}
			const isOptional =
				field?._def?.typeName === 'ZodOptional' || field?._def?.typeName === 'ZodDefault'
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
	private horizonEnabled = false
	private horizonTools = new Set<string>()
	/** Paw names whose tools are always visible in horizon mode */
	private alwaysVisiblePaws = new Set<string>(['__core__'])

	constructor(private bus: MessageBus) {}

	/** Enable/disable Tool Horizon mode */
	setHorizon(enabled: boolean): void {
		this.horizonEnabled = enabled
		if (enabled) {
			// Core tools are always visible
			for (const [name, entry] of this.tools) {
				if (this.alwaysVisiblePaws.has(entry.pawName)) {
					this.horizonTools.add(name)
				}
			}
		}
	}

	/** Mark a paw's tools as always visible in horizon mode */
	addAlwaysVisiblePaw(pawName: string): void {
		this.alwaysVisiblePaws.add(pawName)
		if (this.horizonEnabled) {
			for (const [name, entry] of this.tools) {
				if (entry.pawName === pawName) {
					this.horizonTools.add(name)
				}
			}
		}
	}

	/** Add tools to the horizon (make them visible to the Brain) */
	addToHorizon(toolNames: string[]): void {
		for (const name of toolNames) {
			this.horizonTools.add(name)
		}
	}

	/** Reset horizon for a new task */
	resetHorizon(): void {
		this.horizonTools.clear()
		if (this.horizonEnabled) {
			for (const [name, entry] of this.tools) {
				if (this.alwaysVisiblePaws.has(entry.pawName)) {
					this.horizonTools.add(name)
				}
			}
		}
	}

	/** Search all tools by intent using BM25 over descriptions */
	searchTools(
		query: string,
		limit = 10,
	): Array<{ name: string; description: string; pawName: string; score: number }> {
		const queryTokens = query
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((t) => t.length > 1)
		if (queryTokens.length === 0) return []

		const results: Array<{ name: string; description: string; pawName: string; score: number }> = []
		const N = this.tools.size

		// Build document frequency
		const df = new Map<string, number>()
		for (const entry of this.tools.values()) {
			const tokens = new Set(
				`${entry.name} ${entry.description}`
					.toLowerCase()
					.split(/[^a-z0-9]+/)
					.filter((t) => t.length > 1),
			)
			for (const token of tokens) {
				df.set(token, (df.get(token) ?? 0) + 1)
			}
		}

		for (const entry of this.tools.values()) {
			const text = `${entry.name} ${entry.description}`.toLowerCase()
			const docTokens = text.split(/[^a-z0-9]+/).filter((t) => t.length > 1)
			const dl = docTokens.length
			const avgDl = 15 // approximate average
			let score = 0

			const tf = new Map<string, number>()
			for (const token of docTokens) {
				tf.set(token, (tf.get(token) ?? 0) + 1)
			}

			for (const term of queryTokens) {
				const termFreq = tf.get(term) ?? 0
				if (termFreq === 0) continue
				const docFreq = df.get(term) ?? 0
				const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5))
				const tfNorm = (termFreq * 2.5) / (termFreq + 1.5 * (1 - 0.75 + (0.75 * dl) / avgDl))
				score += idf * tfNorm
			}

			if (score > 0) {
				results.push({
					name: entry.name,
					description: entry.description,
					pawName: entry.pawName,
					score,
				})
			}
		}

		return results.sort((a, b) => b.score - a.score).slice(0, limit)
	}

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

	/** Get tool summaries for AgentContext (respects horizon if enabled) */
	summaries(): ToolSummary[] {
		const tools = this.horizonEnabled
			? this.list().filter((t) => this.horizonTools.has(t.name))
			: this.list()
		return tools.map((t) => ({
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
