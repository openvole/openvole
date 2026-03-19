import type { ZodSchema } from 'zod'

/** A tool definition as provided by a Paw */
export interface ToolDefinition {
	name: string
	description: string
	parameters: ZodSchema
	execute: (params: unknown) => Promise<unknown>
}

/** An entry in the tool registry — includes ownership metadata */
export interface ToolRegistryEntry {
	name: string
	description: string
	parameters: ZodSchema
	pawName: string
	inProcess: boolean
	execute: (params: unknown) => Promise<unknown>
}
