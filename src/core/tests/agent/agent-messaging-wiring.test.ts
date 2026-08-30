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
		expect(cli).toContain("const orchestrator = process.env.VOLE_ORCHESTRATOR === '1'")
		// ...but the management set still is, and under its own source.
		expect(cli).toMatch(/if \(orchestrator\) \{[\s\S]{0,200}'__orchestrate__'/)
	})

	it('files messaging under a different source than orchestration', async () => {
		const cli = await read('cli.ts')
		// One paw name for both made messaging read as orchestration to anything inspecting the
		// registry — including VoleNet, which decides what to lend a peer by source.
		expect(cli).toContain('eng.toolRegistry.register(AGENT_CHAT_PAW,')
		const chat = await read('tool/agent-chat-tool.ts')
		expect(chat).toContain("export const AGENT_CHAT_PAW = '__agent_chat__'")
		// And it no longer lives in the orchestrate module at all.
		expect(await read('tool/orchestrate-tools.ts')).not.toContain('agent_message')
	})

	it('never lends a control-plane tool to a mesh peer', async () => {
		const types = await read('tool/types.ts')
		// By source, not by name pattern: a pattern has to be kept in step with every tool added
		// and quietly misses the first one somebody forgets.
		expect(types).toContain("CONTROL_PLANE_PAWS = ['__orchestrate__', '__agent_chat__']")
		const net = await read('net/index.ts')
		expect(net).toContain('.filter((t) => !isControlPlanePaw(t.pawName))')
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

	it('carries the hop depth across the round trip', async () => {
		const adapter = await read('agent/control-adapter.ts')
		const status = adapter.slice(
			adapter.indexOf("case 'task_status'"),
			adapter.indexOf("case 'chat_history'"),
		)
		// The reply router reads this back to decide whether to keep waking. Without it the count
		// resets to zero on every hop and two agents answer each other indefinitely.
		expect(status).toContain('hops:')
		// Only the hop count — the metadata bag also holds allowTools and the resolved config.
		expect(status).not.toMatch(/metadata: t\.metadata\b/)

		const plane = await read('agent/control-plane.ts')
		const fn = plane.slice(plane.indexOf('private async hopsOfTask'))
		expect(fn).toContain('t?.hops')
	})
})
