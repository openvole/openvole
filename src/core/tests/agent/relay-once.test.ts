import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlPlane } from '../../src/agent/control-plane.js'

/**
 * A person asks for one thing and is owed one answer.
 *
 * The relay address records who is waiting behind an agent-to-agent exchange. It used to travel
 * on with the message, so it kept applying after the answer had been delivered: the colleagues
 * would wind the conversation down between themselves — "sounds good", "happy to help" — and
 * every one of those turns was relayed into the person's chat as though they had asked for it.
 */
async function seed(home: string): Promise<void> {
	const agents = [
		{ id: 'boss', name: 'Boss', path: '/x/boss', createdAt: 'x', orchestrator: true },
		{ id: 'worker', name: 'Worker', path: '/x/worker', createdAt: 'x' },
	]
	await fs.mkdir(home, { recursive: true })
	await fs.writeFile(path.join(home, 'agents.json'), JSON.stringify({ activeId: 'boss', agents }))
}

describe('relaying an answer to the person who asked', () => {
	let tmp: string
	let cp: ControlPlane
	let callAgent: ReturnType<typeof vi.fn>

	/** Deliver worker→boss, with the facts the worker's finished task would report. */
	const deliver = async (facts: { hops: number; relayTo?: string }, result = 'It is foggy.') => {
		callAgent = vi.fn(async (_id: string, method: string) =>
			method === 'task_status' ? facts : { ok: true },
		)
		;(cp as never as { callAgent: unknown }).callAgent = callAgent
		await (
			cp as never as { deliverAgentReply(f: string, d: unknown): Promise<void> }
		).deliverAgentReply('worker', { replyTo: 'agent:Boss', result, taskId: 't1' })
	}

	const callsTo = (method: string) => callAgent.mock.calls.filter((c) => c[1] === method)

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-relay-'))
		await seed(tmp)
		cp = new ControlPlane({ cliPath: '/dev/null', port: 0, home: tmp })
	})
	afterEach(async () => {
		await fs.rm(tmp, { recursive: true, force: true })
	})

	it('puts the answer in front of the person waiting', async () => {
		await deliver({ hops: 1, relayTo: 'sess-human' })
		const appended = callsTo('thread_append')
		expect(appended).toHaveLength(1)
		expect(appended[0][2]).toMatchObject({ sessionId: 'sess-human', notify: true })
		expect(String((appended[0][2] as { content: string }).content)).toContain('It is foggy.')
	})

	it('spends the relay address on that answer', async () => {
		await deliver({ hops: 1, relayTo: 'sess-human' })
		// The colleague is told what was said, but not that anyone is still waiting on it.
		expect(callsTo('agent_message')[0][2]).toMatchObject({ from: 'Worker', relayTo: undefined })
	})

	it('stays out of the chat once the answer has been given', async () => {
		// The wind-down turn: same conversation, but the relay address is gone now.
		await deliver({ hops: 2 }, "Sounds good — I'm here whenever.")
		expect(callsTo('thread_append')).toHaveLength(0)
		expect(callsTo('agent_message')).toHaveLength(1)
	})

	it('never relays a conversation no person started', async () => {
		await deliver({ hops: 1, relayTo: 'agent:Someone' })
		expect(callsTo('thread_append')).toHaveLength(0)
		// An agent-to-agent address is not spent, because it was never a relay to begin with.
		expect(callsTo('agent_message')[0][2]).toMatchObject({ relayTo: 'agent:Someone' })
	})

	it('carries the hop count through so the budget can end the exchange', async () => {
		await deliver({ hops: 3, relayTo: 'sess-human' })
		expect(callsTo('agent_message')[0][2]).toMatchObject({ hops: 3 })
	})
})
