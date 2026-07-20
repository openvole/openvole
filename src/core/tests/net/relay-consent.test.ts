import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair, loadRelayAccepts, trustPeer } from '../../src/net/keys.js'

/**
 * The relay consent contract: sharing a hub is NOT consent. A member's relayed chat is held —
 * surfaced as a pending connect-request — until the recipient approves it. Proves default-deny,
 * the request→approve handshake, persistence of approvals, and the acceptFrom:'*' community-hub
 * bypass. (The blind-relay mechanism itself is covered in relay-e2e.test.ts.)
 */

const HUB = 19781
const A = 19782
const B = 19783
const C = 19784

let hub: VoleNetManager
let a: VoleNetManager
let b: VoleNetManager
let c: VoleNetManager
const dirs: Record<string, string> = {}

async function until(cond: () => boolean | Promise<boolean>, ms = 15000): Promise<void> {
	const t0 = Date.now()
	while (!(await cond())) {
		if (Date.now() - t0 > ms) throw new Error('condition not met in time')
		await new Promise((r) => setTimeout(r, 120))
	}
}

// biome-ignore lint/suspicious/noExplicitAny: reading a manager's own instanceId in-test
const idOf = (m: VoleNetManager) => (m as any).keyPair.instanceId as string

beforeAll(async () => {
	const fsp = await import('node:fs/promises')
	const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vole-consent-'))
	const keys: Record<string, Awaited<ReturnType<typeof generateKeyPair>>> = {}
	for (const n of ['hub', 'a', 'b', 'c']) {
		dirs[n] = path.join(root, n)
		await fsp.mkdir(path.join(dirs[n], '.openvole/net'), { recursive: true })
		keys[n] = await generateKeyPair(path.join(dirs[n], '.openvole/net'), n)
	}
	// publicJoin trust shape: hub↔each member; members never trust each other directly.
	for (const n of ['a', 'b', 'c']) {
		await trustPeer(path.join(dirs.hub, '.openvole/net'), keys[n].publicKeyString)
		await trustPeer(path.join(dirs[n], '.openvole/net'), keys.hub.publicKeyString)
	}

	hub = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'hub',
			role: 'coordinator',
			port: HUB,
			relay: { enabled: true },
		},
		dirs.hub,
	)
	await hub.start()

	const member = (name: string, port: number, acceptFrom?: '*') =>
		new VoleNetManager(
			{
				enabled: true,
				instanceName: name,
				role: 'peer',
				port,
				peers: [{ url: `http://127.0.0.1:${HUB}`, trust: 'tool' }],
				...(acceptFrom ? { relay: { acceptFrom } } : {}),
			},
			dirs[name === 'member-a' ? 'a' : name === 'member-b' ? 'b' : 'c'],
		)
	// a and b default-deny; c opts into the open community-hub policy.
	a = member('member-a', A)
	await a.start()
	b = member('member-b', B)
	await b.start()
	c = member('member-c', C, '*')
	await c.start()

	// wait until A can see B and C in a hub roster (sealing keys announced)
	await until(() => {
		const relay = a.getRelayMembers()
		return relay.some((m) => m.name === 'member-b') && relay.some((m) => m.name === 'member-c')
	})
}, 40000)

afterAll(async () => {
	await a?.stop?.()
	await b?.stop?.()
	await c?.stop?.()
	await hub?.stop?.()
})

describe('relay consent handshake', () => {
	it('default-deny: an unsolicited relayed chat is held, surfacing a pending request', async () => {
		const aId = idOf(a)
		const res = await a.sendChat('member-b', 'unsolicited hello')
		expect(res.ok).toBe(true) // A handed it to the hub
		// B holds it: nothing delivered, but A shows up as a pending connect-request
		await until(() => b.getRelayRequests().some((r) => r.id === aId))
		const inbound = (await b.getChatHistory(aId)).filter((e) => e.dir === 'in')
		expect(inbound).toHaveLength(0)
		// and B lists A as an incoming request, not yet accepted
		const am = b.getRelayMembers().find((m) => m.id === aId)
		expect(am?.incoming).toBe(true)
		expect(am?.accepted).toBe(false)
	})

	it('request → approve → chat: delivery only flows after the recipient approves', async () => {
		const aId = idOf(a)
		const bId = idOf(b)

		const rq = await a.requestRelayConnect('member-b')
		expect(rq.ok).toBe(true)
		await until(() => b.getRelayRequests().some((r) => r.id === aId))

		// still not accepted → a chat sent now is still held
		await a.sendChat('member-b', 'still waiting')
		await new Promise((r) => setTimeout(r, 700))
		expect((await b.getChatHistory(aId)).some((e) => e.dir === 'in')).toBe(false)

		// B approves — consent is persisted to disk (survives restart) and the request clears
		const ap = await b.approveRelayConnect(aId)
		expect(ap.ok).toBe(true)
		expect(b.getRelayRequests().some((r) => r.id === aId)).toBe(false)
		const persisted = await loadRelayAccepts(path.join(dirs.b, '.openvole/net'))
		expect(persisted.has(aId)).toBe(true)

		// now A's chat is delivered end-to-end
		const secret = 'now we are connected'
		await a.sendChat('member-b', secret)
		await until(async () =>
			(await b.getChatHistory(aId)).some((e) => e.dir === 'in' && e.text === secret),
		)

		// A learns B accepted: B is confirmed (connected), not awaiting
		await until(() => {
			const bm = a.getRelayMembers().find((m) => m.id === bId)
			return !!bm?.accepted && !bm?.awaiting
		})
	})

	it("acceptFrom '*' bypasses the handshake — an open member takes chat from any hub peer", async () => {
		const aId = idOf(a)
		const secret = 'hello open member'
		await a.sendChat('member-c', secret)
		await until(async () =>
			(await c.getChatHistory(aId)).some((e) => e.dir === 'in' && e.text === secret),
		)
		expect(c.getRelayRequests().some((r) => r.id === aId)).toBe(false) // no request needed
	})

	it('revoking consent stops future delivery', async () => {
		const aId = idOf(a)
		await b.revokeRelayConnect(aId)
		const persisted = await loadRelayAccepts(path.join(dirs.b, '.openvole/net'))
		expect(persisted.has(aId)).toBe(false)
		const before = (await b.getChatHistory(aId)).filter((e) => e.dir === 'in').length
		await b.clearChat(aId).catch(() => {})
		await a.sendChat('member-b', 'are you still there')
		await new Promise((r) => setTimeout(r, 800))
		const after = (await b.getChatHistory(aId)).filter((e) => e.dir === 'in').length
		expect(after).toBe(0)
		expect(before).toBeGreaterThanOrEqual(0)
	})
})
