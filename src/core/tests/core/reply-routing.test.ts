import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessageBus } from '../../src/core/bus.js'
import { SchedulerStore } from '../../src/core/scheduler.js'
import { buildSystemPrompt } from '../../src/core/system-prompt.js'
import { TaskQueue } from '../../src/core/task.js'
import { Vault } from '../../src/core/vault.js'
import { createCoreTools } from '../../src/tool/core-tools.js'
import type { ToolDefinition } from '../../src/tool/types.js'

/**
 * A run reports back to one place, decided by core, and every surface that can deliver a report
 * has to agree on it.
 *
 * Before this there were three answers: the loop's reply followed the task's session (absent for a
 * heartbeat or a board run, so a paw fell back to whichever chat ran last), `chat_send` hardcoded
 * the dashboard, and nothing told the agent which conversation it was serving. Reports drifted.
 */

function createMockSkillRegistry() {
	return {
		get: vi.fn(() => undefined),
		list: vi.fn(() => []),
		active: vi.fn(() => []),
		load: vi.fn(async () => true),
		unload: vi.fn(() => true),
		resolve: vi.fn(),
	} as never
}

describe('the task queue announces where a run reports', () => {
	it('carries the address on task:completed, including for runs with no conversation', async () => {
		const bus = createMessageBus()
		const queue = new TaskQueue(bus)
		const seen: Array<{ sessionId?: string; replyTo?: string }> = []
		bus.on('task:completed', (d) => seen.push({ sessionId: d.sessionId, replyTo: d.replyTo }))

		queue.setRunner(async () => {})
		queue.enqueue('a chat turn', 'user', { sessionId: 'dashboard' })
		queue.enqueue('board work', 'user', { metadata: { projectId: 'olivia-tunes' } })
		queue.enqueue('a bare heartbeat', 'heartbeat')
		await vi.waitFor(() => expect(seen.length).toBe(3))

		expect(seen[0]).toEqual({ sessionId: 'dashboard', replyTo: 'dashboard' })
		// The one that used to have nowhere to go: no session, so a subscriber had to guess.
		expect(seen[1]).toEqual({ sessionId: undefined, replyTo: 'project:olivia-tunes' })
		expect(seen[2]).toEqual({ sessionId: undefined, replyTo: 'dashboard' })
	})

	it('announces the address on failure too', async () => {
		const bus = createMessageBus()
		const queue = new TaskQueue(bus)
		const seen: Array<string | undefined> = []
		bus.on('task:failed', (d) => seen.push(d.replyTo))

		queue.setRunner(async () => {
			throw new Error('boom')
		})
		queue.enqueue('board work', 'user', { metadata: { projectId: 'olivia-tunes' } })
		// A failure is a report: it must reach the same place the success would have.
		await vi.waitFor(() => expect(seen).toEqual(['project:olivia-tunes']))
	})
})

describe('chat_send follows the run', () => {
	let tmpDir: string
	let tools: ToolDefinition[]
	let posted: Array<{ sessionId?: string }>

	const tool = (name: string) => tools.find((t) => t.name === name) as ToolDefinition

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-reply-routing-'))
		const bus = createMessageBus()
		posted = []
		bus.on('channel:message', (d) => posted.push({ sessionId: d.sessionId }))
		const vault = new Vault(path.join(tmpDir, 'vault.json'))
		await vault.init()
		tools = createCoreTools(
			new SchedulerStore(),
			new TaskQueue(bus),
			tmpDir,
			createMockSkillRegistry(),
			vault,
			undefined,
			bus,
		)
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it('posts into the conversation the run belongs to', async () => {
		await tool('chat_send').execute({ text: 'the render is done' }, { replyTo: 'project:olivia' })
		expect(posted.map((p) => p.sessionId)).toEqual(['project:olivia'])
	})

	it('falls back to the dashboard when a run has no address', async () => {
		await tool('chat_send').execute({ text: 'hello' }, undefined)
		await tool('chat_send').execute({ text: 'hello' }, {})
		expect(posted.map((p) => p.sessionId)).toEqual(['dashboard', 'dashboard'])
	})

	it('still lets the agent name a destination on purpose', async () => {
		// The override has to survive: an agent asked to answer somewhere else must be able to.
		await tool('chat_send').execute(
			{ text: 'over here', session: 'dashboard' },
			{ replyTo: 'project:olivia' },
		)
		expect(posted.map((p) => p.sessionId)).toEqual(['dashboard'])
	})
})

describe('the prompt names the address', () => {
	const content = { brainMd: '', identityContext: '', workspaceFiles: [] } as never

	it('tells the agent where its report lands', () => {
		const prompt = buildSystemPrompt(content, [], [], { replyTo: 'project:olivia-tunes' })
		// Without this the agent has no basis to pass anything to chat_send, so every proactive
		// message defaulted to the general chat regardless of what the run was doing.
		expect(prompt).toContain('Reporting to: `project:olivia-tunes`')
	})

	it('says nothing when there is no address to name', () => {
		expect(buildSystemPrompt(content, [], [], {})).not.toContain('Reporting to:')
		expect(buildSystemPrompt(content, [], [], { replyTo: '' })).not.toContain('Reporting to:')
	})
})

/**
 * The loop needs full engine dependencies to run, so the three lines that carry the address from
 * the task into the prompt and the tool context are pinned by inspection. They are the seam: if
 * the loop stopped setting `metadata.replyTo`, `chat_send` would silently fall back to the
 * dashboard and the prompt would stop naming a destination, with every test above still green.
 */
describe('the loop carries the address into the run', () => {
	it('derives it from the task, after the metadata merge, and hands it to tools', async () => {
		const loop = await fs.readFile(
			path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/core/loop.ts'),
			'utf-8',
		)
		const merge = loop.indexOf('Object.assign(context.metadata, task.metadata)')
		const set = loop.indexOf('context.metadata.replyTo = replyAddressFor(task)')
		expect(merge).toBeGreaterThan(-1)
		// AFTER the merge: a paw or a browser must not be able to hand the loop a reply address,
		// for the same reason it cannot hand it allowTools.
		expect(set).toBeGreaterThan(merge)
		expect(loop).toContain('replyTo: context.metadata.replyTo as string | undefined')
	})
})

describe('the prompt says when to reach a colleague', () => {
	const content = { brainMd: '', identityContext: '', workspaceFiles: [] } as never
	const tool = (name: string) => ({ name, pawName: '__agent_chat__', description: '' }) as never

	it('appears only when the agent can actually message someone', () => {
		// Guidance for a capability you do not have is noise in every prompt forever.
		expect(buildSystemPrompt(content, [], [], {})).not.toContain('## Other agents')
		expect(buildSystemPrompt(content, [], [tool('agent_message')], {})).toContain('## Other agents')
	})

	it('does not make the model guess the tool name', () => {
		// The point of putting this in the prompt is that a human should not have to say
		// "use agent_message" — the agent should already know messaging is the move.
		const p = buildSystemPrompt(content, [], [tool('agent_message')], {})
		expect(p).toContain('message that agent directly')
		// And should not route through the human instead.
		expect(p).toContain('no need to ask')
	})

	it('separates a conversation from a work order', () => {
		const p = buildSystemPrompt(content, [], [tool('agent_message')], {})
		// The two paths answer different questions; conflating them is how a question became a
		// task nobody closed.
		expect(p).toContain('Delegate a task instead when you want work done and tracked')
		expect(p).toContain('a reply is not a finished job')
	})

	it('warns that a sibling has none of your context', () => {
		// The documented failure: a brief that reads fine to someone holding the project.
		expect(buildSystemPrompt(content, [], [tool('agent_message')], {})).toContain(
			'They know nothing you have not told them',
		)
	})
})

describe('provenance — who is actually waiting', () => {
	const content = { brainMd: '', identityContext: '', workspaceFiles: [] } as never
	const tool = (name: string) => ({ name, pawName: '__agent_chat__', description: '' }) as never

	it('tells a woken run that a person is still waiting', () => {
		// A colleague's answer wakes a NEW run in the agent thread, blind to the conversation that
		// prompted the question. Without this it answers the colleague and the person hears nothing
		// — exactly what happened live: "I'll relay its reply" was promised by a run that had ended.
		const p = buildSystemPrompt(content, [], [tool('agent_message')], {
			replyTo: 'agent:video-editor',
			relayTo: 'dashboard',
		})
		expect(p).toContain('Answering for')
		expect(p).toContain('dashboard')
		expect(p).toContain('chat_send')
		// The first attempt was too soft — the agent read it, answered the colleague, and left the
		// person waiting. Relaying has to read as the next thing to do, not as an option.
		expect(p).toContain('before you reply to anyone else')
		expect(p).toContain('still waiting')
	})

	it('says nothing when the run is already answering the right person', () => {
		// No relay needed when you are talking to the asker directly.
		const p = buildSystemPrompt(content, [], [tool('agent_message')], {
			replyTo: 'dashboard',
			relayTo: 'dashboard',
		})
		expect(p).not.toContain('Answering for')
		expect(buildSystemPrompt(content, [], [tool('agent_message')], {})).not.toContain(
			'Answering for:',
		)
	})

	it('tells agents to stop rather than trade acknowledgements', () => {
		// Observed live: five wakes ending in "Acknowledged" / "Standing by", each a brain call.
		const p = buildSystemPrompt(content, [], [tool('agent_message')], {})
		expect(p).toContain('End the exchange when you have nothing to add')
		expect(p).toContain('never acknowledge an acknowledgement')
	})
})
