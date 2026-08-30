import { describe, expect, it } from 'vitest'
import {
	AGENT_SESSION_PREFIX,
	MAX_AGENT_HOPS,
	agentFromSession,
	agentSessionId,
	hopsOf,
	replyAddressFor,
} from '../../src/core/reply-address.js'

/**
 * Agents talk to each other in a thread, and a reply reaches the agent that asked.
 *
 * Before this a coordinator could only submit a task and poll: the worker's answer landed in the
 * worker's own session and nobody was told. The address is what crosses the boundary, so these pin
 * its shape — and pin the hop count, which is the only thing standing between "every message wakes
 * the receiver" and two agents answering each other's answers forever at a brain call per turn.
 */

describe('agent conversations', () => {
	it('names a thread from each side, needing no shared registry', () => {
		expect(agentSessionId('video-editor')).toBe('agent:video-editor')
		expect(agentFromSession(agentSessionId('orchestrator'))).toBe('orchestrator')
		expect(agentFromSession('dashboard')).toBeNull()
		expect(agentFromSession('project:olivia')).toBeNull()
		expect(agentFromSession(AGENT_SESSION_PREFIX)).toBeNull()
		expect(agentFromSession(undefined)).toBeNull()
	})

	it('answers the agent that wrote, not the general chat', () => {
		// The whole point: a run started by a colleague's message reports back to that colleague.
		expect(replyAddressFor({ metadata: { fromAgent: 'orchestrator' } })).toBe('agent:orchestrator')
	})

	it('lets a real conversation outrank a project it happens to touch', () => {
		// A worker messaged about a project must still answer the asker, not file into the project.
		expect(
			replyAddressFor({ metadata: { fromAgent: 'orchestrator', projectId: 'olivia-tunes' } }),
		).toBe('agent:orchestrator')
	})

	it('still lets a chat turn answer its own chat', () => {
		// A person's message outranks everything — they are waiting on the bubble they sent.
		expect(
			replyAddressFor({ sessionId: 'dashboard', metadata: { fromAgent: 'orchestrator' } }),
		).toBe('dashboard')
	})

	it('counts hops and refuses to trust junk', () => {
		expect(hopsOf({ metadata: { hops: 3 } })).toBe(3)
		expect(hopsOf({ metadata: {} })).toBe(0)
		expect(hopsOf(undefined)).toBe(0)
		for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '4', null]) {
			expect(hopsOf({ metadata: { hops: bad as never } })).toBe(0)
		}
		expect(hopsOf({ metadata: { hops: 2.7 } })).toBe(2)
	})

	it('leaves room for a real exchange before it stops waking', () => {
		// Ask, clarify, answer, confirm is four turns and legitimate. The budget has to clear that
		// or the guard becomes the bug — but stay finite, which is the whole point.
		expect(MAX_AGENT_HOPS).toBeGreaterThanOrEqual(4)
		// Six was observed to allow five wakes of pure politeness on a live pair. Four covers
		// ask -> answer -> clarify -> confirm, and little past that is real.
		expect(MAX_AGENT_HOPS).toBeLessThanOrEqual(6)
	})
})
