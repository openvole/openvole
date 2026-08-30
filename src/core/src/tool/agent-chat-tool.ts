import { z } from 'zod'
import type { ToolDefinition } from './types.js'

/** Paw name this registers under; `isControlPlanePaw` keeps it off the mesh. */
export const AGENT_CHAT_PAW = '__agent_chat__'

/**
 * Talking to a sibling agent — the one cross-agent tool every agent gets.
 *
 * Kept apart from `orchestrate-tools.ts` on purpose. Messaging is not orchestration: talking to a
 * colleague is something any agent should be able to do, while assigning them work, rewriting their
 * identity or restarting them is management and stays behind the orchestrator flag. Filing this
 * under the orchestrate module would have said the opposite of what it means, and its paw name is
 * what VoleNet reads when deciding not to lend the control plane to a peer.
 *
 * Both still travel the same reverse-RPC channel, so the split is drawn by intent in three places:
 * which tools register here, the paw name they register under, and the server-side check in
 * `handleOrchestrateRequest`.
 */
export function createAgentMessageTool(
	callParent: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
	selfAgentId: string,
): ToolDefinition {
	const run = async (
		method: string,
		params?: Record<string, unknown>,
	): Promise<Record<string, unknown>> => {
		try {
			const r = await callParent(method, params)
			return typeof r === 'object' && r !== null
				? (r as Record<string, unknown>)
				: { ok: true, result: r }
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) }
		}
	}
	// `to` first, because that is what this tool's schema advertises — it was missing from the
	// list copied over from the orchestrate tools, so a model following the schema exactly got
	// "Missing target" and only the ones that guessed `target` (as agent_submit uses) got through.
	// The aliases stay: models reach for all of these.
	const targetOf = (params: unknown): string => {
		const p = params as Record<string, unknown>
		return (p.to ?? p.target ?? p.agentId ?? p.agent ?? p.id) as string
	}
	const guardSelf = (target: string, op: string): Record<string, unknown> | undefined =>
		target === selfAgentId
			? { ok: false, error: `Refusing to ${op} your own agent ("${selfAgentId}")` }
			: undefined

	return {
		name: 'agent_message',
		description:
			'Say something to another agent in this vole server and have it read it. Conversational, not a work order: the message lands in your ongoing thread with that agent, wakes it to read, and its reply comes back to you the same way — you do not poll. Use agent_submit when you want a job done and tracked; use this to ask a question, answer one, or tell a colleague something. Returns once delivered, not once answered.',
		parameters: z.object({
			to: z.string().describe('Agent id or name (see agent_list)'),
			text: z.string().describe('What to say'),
		}),
		async execute(q: unknown, ctx?: { replyTo?: string; hops?: number; relayTo?: string }) {
			// `to` is read through targetOf, which also accepts the aliases models reach for.
			const { text } = q as { text: string }
			const body = (text ?? '').trim()
			if (!body) return { ok: false, error: 'text is empty — nothing to send' }
			const target = targetOf(q)
			const self = guardSelf(target, 'message')
			if (self) return self
			// Why this thread exists, carried with it and echoed back on the reply.
			//
			// A colleague's answer wakes a *new* run in the agent thread, which knows nothing of the
			// conversation that prompted the question — so an agent that told a person "I'll relay
			// what they say" had no way to keep the promise: the run holding the answer had never
			// seen it made. Passing the asker along means the reply arrives knowing who is waiting.
			//
			// Taken from the calling run rather than from the model: an agent naming its own relay
			// target could post into a conversation it was never part of. Another agent thread is
			// not worth carrying — the reply address already names that hop.
			const origin = ctx?.relayTo || ctx?.replyTo
			const relayTo = origin && origin.indexOf('agent:') !== 0 ? origin : undefined
			// Carry this run's depth so a reply-to-a-reply eventually stops waking anyone.
			return run('message', { target, text: body, hops: ctx?.hops ?? 0, relayTo })
		},
	}
}
