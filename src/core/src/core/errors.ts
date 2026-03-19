/** Error codes for categorizing failures in the agent loop */
export type ActionErrorCode =
	| 'TOOL_TIMEOUT'
	| 'TOOL_EXCEPTION'
	| 'TOOL_NOT_FOUND'
	| 'PERMISSION_DENIED'
	| 'PAW_CRASHED'
	| 'BRAIN_ERROR'
	| 'INVALID_PLAN'

/** Structured error attached to a failed action */
export interface ActionError {
	code: ActionErrorCode
	message: string
	toolName?: string
	pawName?: string
	details?: unknown
}

/** Result of a single tool execution during the Act phase */
export interface ActionResult {
	toolName: string
	pawName: string
	success: boolean
	output?: unknown
	error?: ActionError
	durationMs: number
}

/** Create a structured ActionError */
export function createActionError(
	code: ActionErrorCode,
	message: string,
	opts?: { toolName?: string; pawName?: string; details?: unknown },
): ActionError {
	return {
		code,
		message,
		toolName: opts?.toolName,
		pawName: opts?.pawName,
		details: opts?.details,
	}
}

/** Create a successful ActionResult */
export function successResult(
	toolName: string,
	pawName: string,
	output: unknown,
	durationMs: number,
): ActionResult {
	return { toolName, pawName, success: true, output, durationMs }
}

/** Create a failed ActionResult */
export function failureResult(
	toolName: string,
	pawName: string,
	error: ActionError,
	durationMs: number,
): ActionResult {
	return { toolName, pawName, success: false, error, durationMs }
}
