/**
 * The only thing this library needs to know about an agent's tools.
 *
 * VoleNet can lend a node's tools to a peer it trusts, which means it has to be able to list them
 * and run one. That is the whole contract — two methods and five fields — so it is stated here
 * structurally rather than imported from the agent framework. Anything that satisfies this shape
 * works, including a host with no notion of paws at all.
 */

/** One tool, as the network needs to see it. */
export interface SharedToolEntry {
	name: string
	description: string
	/** Which plugin provides it. Used to decide what may be shared, so it is required. */
	pawName: string
	/**
	 * The host's own context type is opaque here, and deliberately `any`: typed as `unknown` this
	 * contract would be satisfiable by nothing, since a function taking a specific context is not
	 * assignable to one taking anything at all.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: see above
	execute: (params: unknown, ctx?: any) => Promise<unknown>
}

/** A tool as the host defines it, when the network registers a peer's tools locally. */
export interface SharedToolDefinition {
	name: string
	description: string
	/** The host's own parameter schema type (a Zod schema in OpenVole). Opaque here. */
	parameters: unknown
	/**
	 * The host's own context type is opaque here, and deliberately `any`: typed as `unknown` this
	 * contract would be satisfiable by nothing, since a function taking a specific context is not
	 * assignable to one taking anything at all.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: see above
	execute: (params: unknown, ctx?: any) => Promise<unknown>
}

/** Whatever holds this node's tools. `ToolRegistry` in OpenVole; anything with this shape here. */
export interface ToolProvider {
	get(toolName: string): SharedToolEntry | undefined
	list(): SharedToolEntry[]
	/** Publish a peer's tools locally, so the host can call them as if they were its own. */
	register(pawName: string, tools: SharedToolDefinition[], inProcess: boolean): void
}

/**
 * Plugins whose tools are backed by the host's control plane, and must never be shared over the
 * mesh.
 *
 * They read as ordinary tools but execute against the local server — managing siblings, or
 * speaking as this agent to one. A shared tool runs *on its owner*, so lending one of these lends
 * the owner's authority with it: a peer that cannot manage agents itself could drive the owner's
 * `agent_submit` and have every permission check pass, because by then the call really is the
 * owner's. Excluded by **source** rather than by name — a name pattern would have to be kept in
 * step with every tool ever added, and would quietly miss the first one somebody forgets.
 *
 * This lives with the network rather than with the tools because the network is what enforces it.
 */
export const CONTROL_PLANE_PAWS = ['__orchestrate__', '__agent_chat__'] as const

export function isControlPlanePaw(pawName: string): boolean {
	return (CONTROL_PLANE_PAWS as readonly string[]).includes(pawName)
}
