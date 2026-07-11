// Types for the "agent" feature — isolated agent containers managed by a supervisor.

/** A registered agent (an isolated agent container = a normal OpenVole project dir). */
export interface AgentEntry {
	/** Stable id (slug of the name). */
	id: string
	/** Human-friendly name. */
	name: string
	/** Absolute path to the agent's project directory. */
	path: string
	/** ISO timestamp of creation. */
	createdAt: string
	/**
	 * This agent may supervise its siblings via the control plane's reverse-RPC (agent_* tools).
	 * Parent-owned: lives in the registry, outside every agent's sandbox — an agent cannot
	 * grant itself orchestrator.
	 */
	orchestrator?: boolean
}

/** The global agents registry — persisted at ~/.openvole/agents.json. */
export interface AgentRegistry {
	/** Currently active agent id (for CLI targeting). */
	activeId?: string
	agents: AgentEntry[]
}

/** Per-agent runtime hint — persisted at <agent>/.openvole/runtime.json. */
export interface AgentRuntime {
	pid: number
	startedAt: string
}

export type AgentRunState = 'running' | 'stopped'

/** An agent entry plus its derived (live-checked) runtime status. */
export interface AgentStatus extends AgentEntry {
	state: AgentRunState
	pid?: number
}
