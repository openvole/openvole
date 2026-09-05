import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager } from '../src/index.js'
import { generateKeyPair, trustPeer } from '../src/keys.js'

/**
 * Chat to a member who is away — the phone-closed case.
 *
 * The message never lands on the hub. It waits in the sender's own outbox, the hub keeps a
 * notice (who, how many, when), and when the member reappears in a roster the sender delivers
 * it, re-signed, carrying the time it was originally written. Both ends survive a restart.
 */

const HUB = 19981
const MA = 19982
const MB = 19983

let hub: VoleNetManager
let a: VoleNetManager
let b: VoleNetManager
let rootHub: string
let rootA: string
let rootB: string
let aId: string
let bId: string

const memberCfg = (name: string, port: number) => ({
	enabled: true,
	instanceName: name,
	role: 'peer' as const,
	port,
	hostname: '127.0.0.1',
	peers: [{ url: `http://127.0.0.1:${HUB}`, trust: 'full' as const }],
	relay: { acceptFrom: '*' as const },
})

async function until(cond: () => boolean | Promise<boolean>, ms = 60000): Promise<void> {
	const t0 = Date.now()
	while (!(await cond())) {
		if (Date.now() - t0 > ms) throw new Error(`until(): not met within ${ms}ms — ${cond}`)
		await new Promise((r) => setTimeout(r, 150))
	}
}

/** How `who` currently sees `name` on its hub roster, or undefined if unlisted. */
function rosterEntry(who: VoleNetManager, name: string) {
	// biome-ignore lint/suspicious/noExplicitAny: test reads internals
	const rosters = (who as any).hubRosters as Map<
		string,
		Map<string, { name: string; instanceId: string; connected: boolean }>
	>
	for (const roster of rosters.values())
		for (const m of roster.values()) if (m.name === name) return m
	return undefined
}

/** Whether the hub currently has a live connection to a member. */
const hubSees = (id: string): boolean =>
	// biome-ignore lint/suspicious/noExplicitAny: test reads internals
	((hub as any).transport.isPeerConnected(id) as boolean) === true

const instanceId = (m: VoleNetManager): string =>
	// biome-ignore lint/suspicious/noExplicitAny: test reads internals
	(m as any).keyPair.instanceId as string

beforeAll(async () => {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-relay-outbox-'))
	rootHub = path.join(base, 'hub')
	rootA = path.join(base, 'a')
	rootB = path.join(base, 'b')
	for (const d of [rootHub, rootA, rootB])
		await fs.mkdir(path.join(d, '.openvole/net'), { recursive: true })
	const kh = await generateKeyPair(path.join(rootHub, '.openvole/net'), 'the-hub')
	const ka = await generateKeyPair(path.join(rootA, '.openvole/net'), 'member-a')
	const kb = await generateKeyPair(path.join(rootB, '.openvole/net'), 'member-b')
	await trustPeer(path.join(rootHub, '.openvole/net'), ka.publicKeyString)
	await trustPeer(path.join(rootHub, '.openvole/net'), kb.publicKeyString)
	await trustPeer(path.join(rootA, '.openvole/net'), kh.publicKeyString)
	await trustPeer(path.join(rootB, '.openvole/net'), kh.publicKeyString)

	hub = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'the-hub',
			role: 'coordinator',
			port: HUB,
			hostname: '127.0.0.1',
			relay: { enabled: true },
		},
		rootHub,
	)
	await hub.start()
	a = new VoleNetManager(memberCfg('member-a', MA), rootA)
	await a.start()
	b = new VoleNetManager(memberCfg('member-b', MB), rootB)
	await b.start()
	aId = instanceId(a)
	bId = instanceId(b)
	await until(() => rosterEntry(a, 'member-b')?.connected === true, 35000)
	await until(() => rosterEntry(b, 'member-a')?.connected === true, 35000)
}, 40000)

afterAll(async () => {
	await Promise.all([hub?.stop(), a?.stop(), b?.stop()])
})

describe('chat to a member who is away', () => {
	it('waits on the sender, and the hub keeps only a notice', { timeout: 90000 }, async () => {
		await b.stop()
		// What gates holding is the hub's own view of B, so that is what to wait for.
		await until(() => !hubSees(bId))

		const r = await a.sendChat('member-b', 'while you were out')
		expect(r.ok).toBe(true)
		expect(r.queued).toBe(true)
		expect(r.delivered).toBe(false)

		const outbox = a.getChatOutbox()
		expect(outbox).toHaveLength(1)
		expect(outbox[0]).toMatchObject({ to: bId, toName: 'member-b', text: 'while you were out' })

		// The sender's disk holds the message; the hub's holds who-tried-when and nothing else.
		const mine = await fs.readFile(path.join(rootA, '.openvole/net/chat_outbox.json'), 'utf-8')
		expect(mine).toContain('while you were out')
		const notices = await fs.readFile(
			path.join(rootHub, '.openvole/net/relay_notices.json'),
			'utf-8',
		)
		expect(notices).toContain(aId)
		expect(notices).not.toContain('while you were out')
		expect(JSON.parse(notices)[bId]).toMatchObject([{ from: aId, count: 1 }])
	})

	it(
		'is delivered when they come back — stamped with when it was written',
		{ timeout: 90000 },
		async () => {
			const written = a.getChatOutbox()[0].sentAt

			b = new VoleNetManager(memberCfg('member-b', MB), rootB)
			await b.start()

			// A, seeing B back in the roster, delivers on its own.
			await until(async () =>
				(await b.getChatHistory(aId)).some(
					(e) => e.dir === 'in' && e.text === 'while you were out',
				),
			)
			const got = (await b.getChatHistory(aId)).find((e) => e.text === 'while you were out')
			expect(got?.timestamp).toBe(written)
			expect(got?.relayed).toBe(true)
			await until(() => a.getChatOutbox().length === 0)

			// The hub also told B who tried while it was away. That notice and A's delivery race
			// on reconnect, and the message wins as often as not — either way, once the message
			// it announced is here, nothing must still read as pending.
			expect(b.getChatPending().some((p) => p.from === aId)).toBe(false)
		},
	)

	it(
		'when nobody can deliver yet, the hub still says who tried — and the outbox survives a restart',
		{ timeout: 150000 },
		async () => {
			await b.stop()
			await until(() => !hubSees(bId))
			const r = await a.sendChat('member-b', 'second, after you left again')
			expect(r.queued).toBe(true)

			// The phone-closed case on the sending side too: A goes away holding the message.
			await a.stop()
			await until(() => !hubSees(aId))
			b = new VoleNetManager(memberCfg('member-b', MB), rootB)
			await b.start()

			// Nobody is online to deliver, so the notice is all B can be given — and it is.
			await until(() => b.getChatPending().some((p) => p.from === aId && p.count === 1))
			expect(b.getChatPending()[0]).toMatchObject({ fromName: 'member-a', count: 1 })

			// A comes back with its outbox intact (loaded from disk), sees B, and delivers.
			a = new VoleNetManager(memberCfg('member-a', MA), rootA)
			await a.start()
			expect(a.getChatOutbox().map((e) => e.text)).toEqual(['second, after you left again'])
			await until(
				async () =>
					(await b.getChatHistory(aId)).some(
						(e) => e.dir === 'in' && e.text === 'second, after you left again',
					),
				35000,
			)
			await until(() => a.getChatOutbox().length === 0)
			// The notice clears once the message it announced has arrived.
			expect(b.getChatPending().some((p) => p.from === aId)).toBe(false)
		},
	)

	it(
		'a connection request waits too, and arrives when they are back',
		{ timeout: 150000 },
		async () => {
			await b.stop()
			await until(() => !hubSees(bId))

			// Asking to connect used to be fire-and-forget: to someone who had just locked their
			// phone it simply vanished, which is the first thing a phone user notices.
			const r = await a.requestRelayConnect('member-b', 'let me in')
			expect(r).toMatchObject({ ok: true, queued: true })
			const held = a.getChatOutbox().find((e) => e.kind === 'connect-request')
			expect(held).toMatchObject({ to: bId, toName: 'member-b', note: 'let me in' })

			b = new VoleNetManager(memberCfg('member-b', MB), rootB)
			await b.start()
			await until(() => b.getRelayRequests().some((q) => q.id === aId), 35000)
			expect(b.getRelayRequests().find((q) => q.id === aId)).toMatchObject({
				name: 'member-a',
				note: 'let me in',
			})
			await until(() => a.getChatOutbox().length === 0)
		},
	)

	it(
		'a refused envelope is not queued — only an absent recipient is',
		{ timeout: 15000 },
		async () => {
			const r = await a.sendChat('member-b', 'x'.repeat(70_000)) // over the 64 KiB relay cap
			expect(r.ok).toBe(true)
			expect(r.delivered).toBe(false)
			expect(r.queued).toBeUndefined()
			expect(r.error).toBe('too-large')
			expect(a.getChatOutbox()).toHaveLength(0)
		},
	)
})
