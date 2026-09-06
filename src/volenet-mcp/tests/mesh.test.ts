import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { VoleNetManager, generateKeyPair } from '@openvole/volenet'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadStored } from '../src/config.js'
import { unreadFooter } from '../src/index.js'
import { type Node, startNode } from '../src/node.js'
import { TOOLS } from '../src/tools.js'

/**
 * A Claude Code session and an agent, as two separate identities on one mesh.
 *
 * This is the whole proposition: the session is not borrowing the agent's identity, it has its
 * own keypair and its own consent decisions, and the two reach each other as peers. The tools are
 * exercised the way the client calls them — by name, with the arguments it would pass.
 */

const AGENT = 19993

let session: Node
let agent: VoleNetManager
let agentId: string
let sessionRoot: string

const call = (name: string, args: Record<string, unknown> = {}) => {
	const tool = TOOLS.find((t) => t.name === name)
	if (!tool) throw new Error(`no tool ${name}`)
	return tool.run(session, args)
}

async function until(cond: () => boolean, ms = 20000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error(`until(): not met within ${ms}ms`)
		await new Promise((r) => setTimeout(r, 100))
	}
}

beforeAll(async () => {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-mcp-mesh-'))
	const sessionDir = path.join(base, 'session')
	const agentRoot = path.join(base, 'agent')
	await fs.mkdir(path.join(sessionDir, 'net'), { recursive: true })
	await fs.mkdir(path.join(agentRoot, '.openvole/net'), { recursive: true })

	// Both identities exist before either starts, so each can be told to trust the other —
	// which is what pairing does, and is not what this test is about.
	const keySession = await generateKeyPair(path.join(sessionDir, 'net'), 'claude-test')
	const keyAgent = await generateKeyPair(path.join(agentRoot, '.openvole/net'), 'agent-b')
	agentId = keyAgent.instanceId
	await fs.writeFile(
		path.join(sessionDir, 'net', 'authorized_voles'),
		`${keyAgent.publicKeyString}\n`,
	)
	await fs.writeFile(
		path.join(agentRoot, '.openvole/net/authorized_voles'),
		`${keySession.publicKeyString}\n`,
	)

	agent = new VoleNetManager(
		{ enabled: true, instanceName: 'agent-b', role: 'peer', port: AGENT, hostname: '127.0.0.1' },
		agentRoot,
	)
	await agent.start()

	// In-process: these exercise the tools against a real mesh, not the daemon that normally
	// holds the node. The daemon has its own test.
	process.env.VOLENET_MCP_NO_DAEMON = '1'
	session = await startNode({
		name: 'claude-test',
		hub: `http://127.0.0.1:${AGENT}`,
		dir: sessionDir,
		port: 19994,
		session: 'test',
	})
	sessionRoot = sessionDir
	await until(() => agent.getInstances().some((i) => i.id === keySession.instanceId))
}, 40000)

afterAll(async () => {
	await session?.stop()
	await agent?.stop()
})

describe('a Claude Code session on the mesh', () => {
	it('has an identity of its own, not the agent’s', async () => {
		const who = await call('volenet_whoami')
		expect(who).toContain('claude-test')
		expect(who).toContain((await session.net.identity())!.instanceId)
		expect(who).not.toContain(agentId)

		// The hybrid key is kilobytes of ML-DSA, so it is asked for, not volunteered.
		expect(who).not.toContain('vole-ed25519')
		expect(await call('volenet_whoami', { key: true })).toContain('vole-ed25519')
	})

	it('sees the agent, and says so in words a model can act on', async () => {
		// `until` takes a sync predicate, so do the async read outside it.
		let seen = 0
		const poll = setInterval(() => {
			void session.net.instances().then((i) => {
				seen = i.length
			})
		}, 100)
		try {
			await until(() => seen > 0)
		} finally {
			clearInterval(poll)
		}
		const list = await call('volenet_peers')
		expect(list).toContain('agent-b')
		expect(list).toContain('direct')
	})

	it('sends a message that reaches the agent as chat, not as a task', async () => {
		const out = await call('volenet_send', { to: 'agent-b', text: 'from the editor' })
		expect(out).toContain('Sent to agent-b')

		const me = (await session.net.identity())!.instanceId
		await until(async () =>
			(await agent.getChatHistory(me)).some((e) => e.text === 'from the editor'),
		)
		const history = await agent.getChatHistory(me)
		expect(history.some((e) => e.text === 'from the editor' && e.dir === 'in')).toBe(true)
	}, 30000)

	it('receives what the agent sends, and shows it once', async () => {
		const me = (await session.net.identity())!.instanceId
		await agent.sendChat(me, 'and back again')
		await until(() => session.inbox.unread().length > 0)

		const first = await call('volenet_inbox')
		expect(first).toContain('and back again')
		expect(first).toContain('agent-b')

		// Reading marks it seen: a session should not be told the same news twice.
		expect(await call('volenet_inbox')).toContain('No new messages')
	}, 30000)

	it('keeps the thread, and hands it back on request', async () => {
		const thread = await call('volenet_history', { peer: 'agent-b' })
		expect(thread).toContain('you: from the editor')
		expect(thread).toContain('agent-b: and back again')
	})

	it('refuses to trust a URL before the fingerprint is confirmed', async () => {
		const probe = await call('volenet_connect', { url: `http://127.0.0.1:${AGENT}` })
		expect(probe).toContain(agentId)
		expect(probe).toContain('confirm')

		const wrong = await call('volenet_connect', {
			url: `http://127.0.0.1:${AGENT}`,
			confirm: 'deadbeef',
		})
		expect(wrong).toContain('does not match')
		expect(wrong).toContain('Nothing was trusted')
	}, 30000)

	it('remembers a hub choice, so the next session starts where this one left off', async () => {
		const before = await call('volenet_hub')
		expect(before).toContain(`http://127.0.0.1:${AGENT}`)

		expect(await call('volenet_hub', { leave: true })).toContain('Left')
		expect(await loadStored(sessionRoot)).toEqual({})
		expect(await call('volenet_hub')).toContain('Not on a hub')

		const rejoined = await call('volenet_hub', { url: `http://127.0.0.1:${AGENT}` })
		expect(rejoined).toContain('Joined')
		expect((await loadStored(sessionRoot)).hub).toBe(`http://127.0.0.1:${AGENT}`)
	}, 30000)

	it('waits for a reply instead of making the session poll for one', async () => {
		const me = (await session.net.identity())!.instanceId
		// Nothing has arrived yet, so this really does block until the message lands.
		const waiting = call('volenet_wait', { from: 'agent-b', timeout_ms: 15000 })
		await new Promise((r) => setTimeout(r, 300))
		await agent.sendChat(me, 'while you were waiting')

		expect(await waiting).toContain('while you were waiting')
		expect(session.inbox.unread()).toHaveLength(0)
	}, 30000)

	it('gives up cleanly, and says the message is not lost', async () => {
		const out = await call('volenet_wait', { from: 'agent-b', timeout_ms: 1000 })
		expect(out).toContain('Nothing arrived')
		expect(out).toContain('not lost')
	}, 30000)

	it('tells the session what is unread, on the result of any other tool', async () => {
		const me = (await session.net.identity())!.instanceId
		await agent.sendChat(me, 'ambient')
		await until(() => session.inbox.unread().length > 0)

		// Appended to every tool's result, because MCP cannot push and an arrived message would
		// otherwise sit unseen until somebody thought to look.
		expect(await unreadFooter(session, 'volenet_peers')).toContain('1 unread message from agent-b')
		// The two that just showed them do not then claim they are still waiting.
		expect(await unreadFooter(session, 'volenet_inbox')).toBe('')
		expect(await unreadFooter(session, 'volenet_wait')).toBe('')

		await call('volenet_inbox')
		expect(await unreadFooter(session, 'volenet_peers')).toBe('')
	}, 30000)

	it('takes another port rather than crashing when one is already in use', async () => {
		// Two editor sessions open at once used to mean the second failed to bind and died. The
		// listener exists so peers can dial in, which for a session behind NAT never happens — not
		// worth failing over.
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-mcp-second-'))
		const second = await startNode({
			name: 'second',
			dir,
			port: session.options.port,
			session: 'second',
		})
		try {
			expect(second.options.port).not.toBe(session.options.port)
			expect(second.options.port).toBeGreaterThan(0)
			expect((await second.net.identity())?.instanceId).toBeTruthy()
		} finally {
			await second.stop()
		}
	}, 30000)

	it('answers honestly for a peer it cannot find', async () => {
		expect(await call('volenet_ask', { to: 'nobody', question: 'are you there' })).toContain(
			'No peer found',
		)
	})
})
