/** Summary of a tool available to the Brain */
export interface ToolSummary {
	name: string
	description: string
	pawName: string
}

/** A Skill whose required tools are all satisfied (compact — Brain reads full instructions on demand) */
export interface ActiveSkill {
	name: string
	description: string
	satisfiedBy: string[]
}

/** A single message in the agent's reasoning history */
export interface AgentMessage {
	role: 'user' | 'brain' | 'tool_result' | 'error'
	content: string
	toolCall?: { name: string; params: unknown }
	timestamp: number
}

/** The shared data structure that flows through the agent loop */
export interface AgentContext {
	taskId: string
	messages: AgentMessage[]
	availableTools: ToolSummary[]
	activeSkills: ActiveSkill[]
	metadata: Record<string, unknown>
	iteration: number
	maxIterations: number
}

/** Create an empty AgentContext for a new task */
export function createAgentContext(
	taskId: string,
	maxIterations: number,
): AgentContext {
	return {
		taskId,
		messages: [],
		availableTools: [],
		activeSkills: [],
		metadata: {},
		iteration: 0,
		maxIterations,
	}
}
