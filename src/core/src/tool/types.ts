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
	/**
	 * How many agent-to-agent hops this run is already deep, so a message it sends carries the
	 * count onward. Without it every reply looks like a fresh conversation and nothing ever stops.
	 */
	hops?: number
	/**
	 * The conversation this run is ultimately answering, when it is not this one — a person who
	 * asked a question that has since been passed to a colleague. Carried so their answer can find
	 * its way back to whoever is actually waiting.
	 */
	relayTo?: string
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

/**
 * Paws whose tools are backed by this agent's control plane, and must never be shared over VoleNet.
 *
 * They read as ordinary tools but execute against the local server — managing siblings, or speaking
 * as this agent to one. A shared tool runs *on its owner*, so lending one of these to a peer lends
 * the owner's authority with it: a peer that cannot manage agents itself could drive the owner's
 * `agent_submit` and have every permission check pass, because by then the call really is the
 * owner's. Excluded by **source** rather than by name — a name pattern would have to be kept in
 * step with every tool ever added here, and would quietly miss the first one somebody forgets.
 */
export const CONTROL_PLANE_PAWS = ['__orchestrate__', '__agent_chat__'] as const

export function isControlPlanePaw(pawName: string): boolean {
	return (CONTROL_PLANE_PAWS as readonly string[]).includes(pawName)
}
