// Types for the "space" feature — isolated agent containers managed by a supervisor.

/** A registered space (an isolated agent container = a normal OpenVole project dir). */
export interface SpaceEntry {
	/** Stable id (slug of the name). */
	id: string
	/** Human-friendly name. */
	name: string
	/** Absolute path to the space's project directory. */
	path: string
	/** ISO timestamp of creation. */
	createdAt: string
}

/** The global spaces registry — persisted at ~/.openvole/spaces.json. */
export interface SpaceRegistry {
	/** Currently active space id (for CLI targeting). */
	activeId?: string
	spaces: SpaceEntry[]
}

/** Per-space runtime hint — persisted at <space>/.openvole/runtime.json. */
export interface SpaceRuntime {
	pid: number
	startedAt: string
}

export type SpaceRunState = 'running' | 'stopped'

/** A space entry plus its derived (live-checked) runtime status. */
export interface SpaceStatus extends SpaceEntry {
	state: SpaceRunState
	pid?: number
}
