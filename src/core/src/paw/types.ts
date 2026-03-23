import type { ZodSchema } from 'zod'
import type { ActionResult } from '../core/errors.js'
import type { AgentContext } from '../context/types.js'
import type { ToolDefinition } from '../tool/types.js'
import type { VoleIO } from '../io/types.js'

/** The plan returned by a Brain Paw during the Think phase */
export interface AgentPlan {
	actions: PlannedAction[]
	execution?: 'parallel' | 'sequential'
	response?: string
	done?: boolean
}

/** A single tool call the Brain wants to execute */
export interface PlannedAction {
	tool: string
	params: unknown
}


/** Hook called once when a task starts — initialize Paw state for this task */
export type BootstrapHook = (context: AgentContext) => Promise<AgentContext>

/** Hook called during the Perceive phase — enrich context before Think */
export type PerceiveHook = (context: AgentContext) => Promise<AgentContext>

/** Hook called during the Observe phase — fire-and-forget side effect */
export type ObserveHook = (result: ActionResult) => Promise<void>

/** Hook called when context exceeds size threshold — compress/summarize */
export type CompactHook = (context: AgentContext) => Promise<AgentContext>

/** A cron-triggered schedule hook */
export interface ScheduleHook {
	cron: string
	handler: () => Promise<AgentTaskInput>
}

/** Input for creating a new agent task */
export interface AgentTaskInput {
	input: string
	source?: 'user' | 'schedule' | 'paw'
}

/** The full Paw definition — the contract every Paw must implement */
export interface PawDefinition {
	name: string
	version: string
	description: string
	brain?: boolean
	inProcess?: boolean
	config?: ZodSchema
	hooks?: {
		onBootstrap?: BootstrapHook
		onPerceive?: PerceiveHook
		onObserve?: ObserveHook
		onCompact?: CompactHook
		onSchedule?: ScheduleHook[]
	}
	tools?: ToolDefinition[]
	think?: (context: AgentContext) => Promise<AgentPlan>
	io?: VoleIO
	onLoad?: (config: unknown) => Promise<void>
	onUnload?: () => Promise<void>
}

/** Transport type for IPC communication */
export type TransportType = 'ipc' | 'stdio'

/** Paw manifest as read from vole-paw.json */
export interface PawManifest {
	name: string
	version: string
	description: string
	entry: string
	brain: boolean
	/** Paw category for display purposes */
	type?: 'brain' | 'channel' | 'tool' | 'infrastructure'
	inProcess?: boolean
	transport?: TransportType
	tools: Array<{ name: string; description: string }>
	permissions?: {
		network?: string[]
		listen?: number[]
		filesystem?: string[]
		env?: string[]
		/** If true, the Paw needs to spawn child processes */
		childProcess?: boolean
	}
}

/** Paw configuration in vole.config.ts */
export interface PawConfig {
	name: string
	hooks?: {
		perceive?: { order?: number; pipeline?: boolean }
	}
	allow?: {
		network?: string[]
		listen?: number[]
		filesystem?: string[]
		env?: string[]
		/** If true, allow this Paw to spawn child processes */
		childProcess?: boolean
	}
}

/** Runtime state of a loaded Paw */
export interface PawInstance {
	name: string
	manifest: PawManifest
	config: PawConfig
	healthy: boolean
	transport: TransportType
	inProcess: boolean
	definition?: PawDefinition
	process?: { kill: () => void; pid?: number }
	sendRequest?: (method: string, params?: unknown) => Promise<unknown>
	/** Bus events this Paw has subscribed to */
	subscriptions?: string[]
}

/** Effective permissions = intersection of manifest requests and config grants */
export interface EffectivePermissions {
	network: string[]
	listen: number[]
	filesystem: string[]
	env: string[]
	childProcess: boolean
}
