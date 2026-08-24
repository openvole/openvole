import type { ZodSchema } from 'zod'
import type { ProjectContextInfo } from '../project/types.js'

/**
 * What core knows about the call a tool is serving.
 *
 * Passed per call rather than captured when the tool is built, because task concurrency is
 * configurable: a tool that read "the current project" off shared mutable state would answer for
 * whichever task last started, which is the wrong answer roughly half the time at concurrency 2.
 *
 * Optional everywhere — a tool that ignores it behaves exactly as before, and tools that run in a
 * Paw subprocess never receive one (the IPC boundary carries params only).
 */
export interface ToolContext {
	/** The project this task is scoped to, when it has one. */
	project?: ProjectContextInfo
	/**
	 * Where this run reports back to — the chat session that gets its result. Derived per run by
	 * `replyAddressFor`, so a tool that talks to the human lands where the work came from instead
	 * of defaulting to the general chat.
	 */
	replyTo?: string
}

/** A tool definition as provided by a Paw */
export interface ToolDefinition {
	name: string
	description: string
	parameters: ZodSchema
	execute: (params: unknown, ctx?: ToolContext) => Promise<unknown>
}

/** An entry in the tool registry — includes ownership metadata */
export interface ToolRegistryEntry {
	name: string
	description: string
	parameters: ZodSchema
	pawName: string
	inProcess: boolean
	execute: (params: unknown, ctx?: ToolContext) => Promise<unknown>
}
