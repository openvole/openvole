import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The three places the messaging/management split has to hold, and the loop that closes it.
 *
 * Messaging is open to every agent; assigning work, rewriting an identity or restarting an agent is
 * not. Both travel the same reverse-RPC channel, so the split is drawn by intent in three separate
 * files — and a split enforced in only two of them is a hole rather than a policy.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

const read = (p: string) => fs.readFile(path.join(SRC, p), 'utf-8')

describe('agent messaging wiring', () => {
	it('gives every agent the message tool and only orchestrators the rest', async () => {
		const cli = await read('cli.ts')
		// Registration is no longer behind the orchestrator flag...
		expect(cli).toContain('if (process.send) {')
		// ...but the management set still is.
		expect(cli).toMatch(/orchestrator\s*\?\s*\[\s*createAgentMessageTool/)
		expect(cli).toContain("const orchestrator = process.env.VOLE_ORCHESTRATOR === '1'")
	})

	it('exempts only messaging from the server-side gate', async () => {
		const plane = await read('agent/control-plane.ts')
		// The gate is what actually enforces this — the tool registration is only the client half.
		expect(plane).toContain("if (req.method !== 'message' && sender?.orchestrator !== true)")
		// Every other method must still be refused for a non-orchestrator.
		const gate = plane.slice(plane.indexOf('is not an orchestrator'))
		expect(gate).not.toContain("req.method !== 'submit'")
	})

	it('keeps the message tool reachable under tool horizon', async () => {
		// A message that arrived is unanswerable if the tool to answer it is hidden by horizon.
		expect(await read('cli.ts')).toContain("addAlwaysVisiblePaw('__orchestrate__')")
	})

	it('delivers, then wakes — and delivers even when it will not wake', async () => {
		const adapter = await read('agent/control-adapter.ts')
		const block = adapter.slice(
			adapter.indexOf("case 'agent_message'"),
			adapter.indexOf("case 'task_status'"),
		)
		// Appended before the wake decision, so the message survives being over budget.
		expect(block.indexOf('session_append')).toBeLessThan(block.indexOf('const woke'))
		expect(block).toContain('hops < MAX_AGENT_HOPS')
		// The run carries the sender and the incremented count, or the reply cannot find its way
		// back and the exchange never terminates.
		expect(block).toContain('fromAgent: from')
		expect(block).toContain('hops: hops + 1')
	})

	it('routes a finished run’s answer back to the agent that asked', async () => {
		const plane = await read('agent/control-plane.ts')
		expect(plane).toContain("if (m.event === 'task:completed') void this.deliverAgentReply")
		const fn = plane.slice(plane.indexOf('private async deliverAgentReply'))
		// Only when the address names an agent, and never back to itself.
		expect(fn).toContain('agentFromSession(d?.replyTo)')
		expect(fn).toContain('target.id === fromId')
		// A failed delivery must not take the finishing agent down with it.
		expect(fn).toMatch(/catch\s*\{/)
	})
})
