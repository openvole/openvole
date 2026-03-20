import type { ZodSchema } from 'zod'

/** Agent context passed to hooks and the Brain */
export interface AgentContext {
	taskId: string
	messages: AgentMessage[]
	availableTools: ToolSummary[]
	activeSkills: ActiveSkill[]
	metadata: Record<string, unknown>
	iteration: number
	maxIterations: number
}

export interface AgentMessage {
	role: 'user' | 'brain' | 'tool_result' | 'error'
	content: string
	toolCall?: { name: string; params: unknown }
	timestamp: number
}

export interface ToolSummary {
	name: string
	description: string
	pawName: string
	parameters?: unknown
}

export interface ActiveSkill {
	name: string
	description: string
	satisfiedBy: string[]
}

/** Result of a tool execution */
export interface ActionResult {
	toolName: string
	pawName: string
	success: boolean
	output?: unknown
	error?: { code: string; message: string; details?: unknown }
	durationMs: number
}

/** Plan returned by a Brain Paw */
export interface AgentPlan {
	actions: PlannedAction[]
	execution?: 'parallel' | 'sequential'
	response?: string
	done?: boolean
}

export interface PlannedAction {
	tool: string
	params: unknown
}


/** Tool definition within a Paw */
export interface ToolDefinition {
	name: string
	description: string
	parameters: ZodSchema
	execute: (params: unknown) => Promise<unknown>
}

/** Bootstrap hook — called once when a task starts */
export type BootstrapHook = (context: AgentContext) => Promise<AgentContext>

/** Perceive hook — called before Think to enrich context */
export type PerceiveHook = (context: AgentContext) => Promise<AgentContext>

/** Observe hook — called after Act, fire-and-forget side effect */
export type ObserveHook = (result: ActionResult) => Promise<void>

/** Compact hook — called when context exceeds size threshold */
export type CompactHook = (context: AgentContext) => Promise<AgentContext>

/** Schedule hook */
export interface ScheduleHook {
	cron: string
	handler: () => Promise<{ input: string; source?: 'schedule' | 'paw' }>
}

/** VoleIO interface for Paws that want to provide I/O */
export interface VoleIO {
	confirm(message: string): Promise<boolean>
	prompt(message: string): Promise<string>
	notify(message: string): void
}

/** The full Paw definition */
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
