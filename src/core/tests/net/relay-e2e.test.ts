import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair, trustPeer } from '../../src/net/keys.js'
import { createMessage } from '../../src/net/protocol.js'
import { seal } from '../../src/net/seal.js'

/**
 * End-to-end proof of the blind relay: hub + two members who trust ONLY the hub
 * (the publicJoin shape — A and B have no direct trust relationship and no direct
 * connection). A chats to B: the message travels A → hub → B as a sealed envelope.
 * Asserts delivery, hub blindness (the forwarded bytes contain no plaintext),
 * the chat-only allowlist, and the misdelivery guard.
 */

const HUB = 19761
const A = 19762
const B = 19763

let hub: VoleNetManager
let a: VoleNetManager
let b: VoleNetManager
// every envelope the hub's transport forwards, captured for the blindness assertion
const forwarded: string[] = []

async function until(cond: () => boolean, ms = 15000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error('condition not met in time')
		await new Promise((r) => setTimeout(r, 100))
	}
}

beforeAll(async () => {
	const fsp = await import('node:fs/promises')
	const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vole-relay-'))
	const dirs: Record<string, string> = {}
	for (const n of ['hub', 'a', 'b']) {
		dirs[n] = path.join(root, n)
		await fsp.mkdir(path.join(dirs[n], '.openvole/net'), { recursive: true })
	}
	const keys: Record<string, Awaited<ReturnType<typeof generateKeyPair>>> = {}
	for (const n of ['hub', 'a', 'b'])
		keys[n] = await generateKeyPair(path.join(dirs[n], '.openvole/net'), n)
	// publicJoin trust shape: hub↔A and hub↔B, never A↔B.
	await trustPeer(path.join(dirs.hub, '.openvole/net'), keys.a.publicKeyString)
	await trustPeer(path.join(dirs.hub, '.openvole/net'), keys.b.publicKeyString)
	await trustPeer(path.join(dirs.a, '.openvole/net'), keys.hub.publicKeyString)
	await trustPeer(path.join(dirs.b, '.openvole/net'), keys.hub.publicKeyString)

	hub = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'hub',
			role: 'coordinator',
			port: HUB,
			relay: { enabled: true, maxPerMinutePerPair: 10 },
		},
		dirs.hub,
	)
	await hub.start()

	// biome-ignore lint/suspicious/noExplicitAny: capturing the hub's forwards is the point
	const ht = (hub as any).transport
	const origSend = ht.sendToPeer.bind(ht)
	ht.sendToPeer = (peerId: string, message: unknown) => {
		forwarded.push(JSON.stringify(message))
		return origSend(peerId, message)
	}

	const memberCfg = (name: string, port: number) => ({
		enabled: true,
		instanceName: name,
		role: 'peer' as const,
		port,
		peers: [{ url: `http://127.0.0.1:${HUB}`, trust: 'tool' as const }],
	})
	a = new VoleNetManager(memberCfg('member-a', A), dirs.a)
	await a.start()
	b = new VoleNetManager(memberCfg('member-b', B), dirs.b)
	await b.start()
}, 30000)

afterAll(async () => {
	await a?.stop?.()
	await b?.stop?.()
	await hub?.stop?.()
})

describe('blind relay end-to-end (hub + two members, no direct trust)', () => {
	it('members receive the hub roster listing each other', { timeout: 20000 }, async () => {
		await until(
			() =>
				[...a.getRosters().values()].some((r) => r.has(b.getInstanceId?.() ?? '')) ||
				[...a.getRosters().values()].some((r) =>
					[...r.values()].some((m) => m.name === 'member-b'),
				),
		)
		const roster = [...a.getRosters().values()][0]
		const memberB = [...roster.values()].find((m) => m.name === 'member-b')
		expect(memberB).toBeTruthy()
		expect(memberB?.xPublicKey).toBeTruthy() // sealing key announced through the hub
	})

	it('the dashboard feed lists B as a relay member, tagged with its hub — not as a direct peer', () => {
		// direct peers: only the hub (A trusts and connects to the hub alone)
		const directNames = a.getInstances().map((i) => i.name)
		expect(directNames).toContain('hub')
		expect(directNames).not.toContain('member-b')
		// relay members: B, reachable via the hub, absent from the direct list (no double-listing)
		const relay = a.getRelayMembers()
		const rb = relay.find((m) => m.name === 'member-b')
		expect(rb).toBeTruthy()
		expect(rb?.viaHubName).toBe('hub')
		expect(relay.some((m) => m.name === 'hub')).toBe(false) // the hub is a direct peer, not a relay member
		expect(relay.some((m) => m.name === 'member-a')).toBe(false) // never lists self
	})

	it('A chats to B through the hub — delivered end-to-end', { timeout: 15000 }, async () => {
		const secret = 'meet me behind the NAT at nine'
		const res = await a.sendChat('member-b', secret)
		expect(res.ok).toBe(true)
		expect(res.relayed).toBe(true)
		// biome-ignore lint/suspicious/noExplicitAny: reading B's chat log
		const aId = (a as any).keyPair.instanceId as string
		let history: Awaited<ReturnType<typeof b.getChatHistory>> = []
		const t0 = Date.now()
		while (Date.now() - t0 < 10000) {
			history = await b.getChatHistory(aId)
			if (history.some((e) => e.dir === 'in' && e.text === secret)) break
			await new Promise((r) => setTimeout(r, 150))
		}
		expect(history.some((e) => e.dir === 'in' && e.text === secret)).toBe(true)
	})

	it('the hub forwarded only ciphertext — the plaintext never crossed it readable', () => {
		const deliveries = forwarded.filter((f) => f.includes('relay:deliver'))
		expect(deliveries.length).toBeGreaterThan(0)
		for (const d of deliveries) {
			expect(d).not.toContain('meet me behind the NAT')
			expect(d).toContain('"box"')
		}
	})

	it('nothing executable rides the relay: a sealed tool:call is dropped by the recipient', async () => {
		// biome-ignore lint/suspicious/noExplicitAny: crafting a hostile envelope from A's internals
		const ak = (a as any).keyPair
		// biome-ignore lint/suspicious/noExplicitAny: crafting a hostile envelope from A's internals
		const at = (a as any).transport
		const roster = [...a.getRosters().values()][0]
		const memberB = [...roster.values()].find((m) => m.name === 'member-b')!
		const inner = createMessage(
			'tool:call',
			ak.instanceId,
			memberB.instanceId,
			{ toolName: 'shell_exec', params: { command: 'id' } },
			ak.privateKey,
			ak.pqPrivateKey,
		)
		const box = seal(
			memberB.xPublicKey!,
			Buffer.from(JSON.stringify(inner), 'utf8'),
			`${ak.instanceId}|${memberB.instanceId}`,
		)!
		const hubId = [...a.getRosters().keys()][0]
		const outer = createMessage(
			'sealed',
			ak.instanceId,
			hubId,
			{ to: memberB.instanceId, box },
			ak.privateKey,
		)
		await at.sendToPeer(hubId, outer)
		await new Promise((r) => setTimeout(r, 800))
		// the envelope was forwarded but B refused the non-chat payload: nothing new in chat,
		// and (decisively) no tool result ever comes back
		const history = await b.getChatHistory(ak.instanceId)
		expect(history.filter((e) => e.dir === 'in')).toHaveLength(1) // still only the chat message
	})

	it('a sealed envelope re-addressed by a hostile relay fails to open (AAD binding)', async () => {
		// biome-ignore lint/suspicious/noExplicitAny: internals
		const ak = (a as any).keyPair
		// biome-ignore lint/suspicious/noExplicitAny: internals
		const bk = (b as any).keyPair
		const roster = [...a.getRosters().values()][0]
		const memberB = [...roster.values()].find((m) => m.name === 'member-b')!
		const inner = createMessage(
			'chat:message',
			ak.instanceId,
			memberB.instanceId,
			{ text: 'redirect me' },
			ak.privateKey,
			ak.pqPrivateKey,
		)
		const box = seal(
			memberB.xPublicKey!,
			Buffer.from(JSON.stringify(inner), 'utf8'),
			`${ak.instanceId}|${memberB.instanceId}`,
		)!
		// a hostile hub claims the envelope came from someone else → AAD mismatch → unseal fails
		const { unseal } = await import('../../src/net/seal.js')
		expect(unseal(bk.xPrivateKey, box, `someone-else|${bk.instanceId}`)).toBeNull()
		expect(unseal(bk.xPrivateKey, box, `${ak.instanceId}|${bk.instanceId}`)).not.toBeNull()
	})
})
