import { describe, expect, it } from 'vitest'
import {
	CHAT_DEFAULT_SESSION,
	projectIdFromSession,
	projectSessionId,
	replyAddressFor,
} from '../../src/core/reply-address.js'

/**
 * One rule for where a run reports back to.
 *
 * The bug this replaced: a run with no session had no address at all, so paw-session filed its
 * reply against a module-global "current session" — whichever task bootstrapped last. These pin
 * that every kind of run has an address, and that it depends only on the task.
 */
describe('replyAddressFor', () => {
	it('answers into the conversation a chat turn came from', () => {
		expect(replyAddressFor({ sessionId: 'dashboard' })).toBe('dashboard')
		expect(replyAddressFor({ sessionId: 'project:olivia' })).toBe('project:olivia')
	})

	it('sends project work to the project, not the general chat', () => {
		// A board run and a heartbeat that picked up queued work are not conversations, which is
		// exactly why they used to land wherever the last chat happened to be.
		expect(replyAddressFor({ metadata: { projectId: 'olivia-tunes' } })).toBe(
			'project:olivia-tunes',
		)
	})

	it('prefers the run’s own conversation over its project', () => {
		// A project chat already names the project in its session id; a chat turn must answer
		// itself even when scoped, or the reply skips the bubble that is waiting for it.
		expect(
			replyAddressFor({ sessionId: 'dashboard', metadata: { projectId: 'olivia-tunes' } }),
		).toBe('dashboard')
	})

	it('always produces an address', () => {
		// The point of the whole change: there is no "no address" case left to fall back from.
		for (const task of [
			undefined,
			{},
			{ sessionId: '' },
			{ metadata: {} },
			{ metadata: { projectId: '' } },
			{ metadata: { projectId: 42 } },
			{ sessionId: 42 as unknown as string },
		]) {
			expect(replyAddressFor(task as never)).toBe(CHAT_DEFAULT_SESSION)
		}
	})

	it('round-trips a project session id', () => {
		expect(projectIdFromSession(projectSessionId('olivia-tunes'))).toBe('olivia-tunes')
		expect(projectIdFromSession('dashboard')).toBeNull()
		expect(projectIdFromSession('project:')).toBeNull()
		expect(projectIdFromSession(undefined)).toBeNull()
	})
})
