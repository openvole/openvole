import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { VoleNetManager, generateKeyPair } from 'openvole'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

	session = await startNode({
		name: 'claude-test',
		hub: `http://127.0.0.1:${AGENT}`,
		dir: sessionDir,
		port: 19994,
	})
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
		expect(who).toContain(session.net.getKeyPair()!.instanceId)
		expect(who).not.toContain(agentId)

		// The hybrid key is kilobytes of ML-DSA, so it is asked for, not volunteered.
		expect(who).not.toContain('vole-ed25519')
		expect(await call('volenet_whoami', { key: true })).toContain('vole-ed25519')
	})

	it('sees the agent, and says so in words a model can act on', async () => {
		await until(() => session.net.getInstances().length > 0)
		const list = await call('volenet_peers')
		expect(list).toContain('agent-b')
		expect(list).toContain('direct')
	})

	it('sends a message that reaches the agent as chat, not as a task', async () => {
		const out = await call('volenet_send', { to: 'agent-b', text: 'from the editor' })
		expect(out).toContain('Sent to agent-b')

		const me = session.net.getKeyPair()!.instanceId
		await until(async () =>
			(await agent.getChatHistory(me)).some((e) => e.text === 'from the editor'),
		)
		const history = await agent.getChatHistory(me)
		expect(history.some((e) => e.text === 'from the editor' && e.dir === 'in')).toBe(true)
	}, 30000)

	it('receives what the agent sends, and shows it once', async () => {
		const me = session.net.getKeyPair()!.instanceId
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

	it('answers honestly for a peer it cannot find', async () => {
		expect(await call('volenet_ask', { to: 'nobody', question: 'are you there' })).toContain(
			'No peer found',
		)
	})
})
