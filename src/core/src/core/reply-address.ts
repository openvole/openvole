/**
 * Where a run's report goes.
 *
 * A run has two different relationships to a conversation, and conflating them is what let brain
 * replies drift into the wrong chat:
 *
 * - `sessionId` means *this run is a turn in that conversation*. Its history is loaded into the
 *   prompt and the input is appended to the transcript. Only a chat message has one.
 * - The **reply address** means *deliver this run's report here*. Every run has one, including
 *   heartbeats, schedules and work started from the task board, none of which are conversations.
 *
 * Before this, a run without a `sessionId` had no address at all, and paw-session filed its reply
 * against a module-global "current session" — whichever task happened to bootstrap last. That is
 * interleaving-dependent: correct until two runs overlap, then silently wrong.
 *
 * The address is *derived*, never stored or passed in. One rule, applied everywhere, so no enqueue
 * site can forget it and no two paths can disagree — the same reason project scope is resolved from
 * the task rather than read from ambient state (see project/context.ts).
 */

/** The dashboard Chat tab. Where a report goes when nothing more specific applies. */
export const CHAT_DEFAULT_SESSION = 'dashboard'

/** Marks a session as belonging to a project rather than the central Chat tab. */
export const PROJECT_SESSION_PREFIX = 'project:'

/** The session a project's conversation lives in. */
export function projectSessionId(projectId: string): string {
	return `${PROJECT_SESSION_PREFIX}${projectId}`
}

/** The project a session belongs to, or null when it is not a project conversation. */
export function projectIdFromSession(sessionId: string | undefined): string | null {
	if (!sessionId?.startsWith(PROJECT_SESSION_PREFIX)) return null
	return sessionId.slice(PROJECT_SESSION_PREFIX.length) || null
}

/** The parts of a task the address depends on. */
export interface Addressable {
	sessionId?: string
	metadata?: Record<string, unknown>
}

/**
 * Where this run reports back to.
 *
 * 1. Its own conversation, when it is a turn in one.
 * 2. Its project's conversation, when it is project work — a board run or a heartbeat that picked
 *    up a queued task reports next to the task board it came from, not into the general chat.
 * 3. The dashboard chat, for everything else.
 */
export function replyAddressFor(task: Addressable | undefined): string {
	const sessionId = task?.sessionId
	if (typeof sessionId === 'string' && sessionId) return sessionId

	const projectId = task?.metadata?.projectId
	if (typeof projectId === 'string' && projectId) return projectSessionId(projectId)

	return CHAT_DEFAULT_SESSION
}
