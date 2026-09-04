import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair } from '../../src/net/keys.js'

/**
 * Naming a peer by identity rather than by address.
 *
 * `net.peers` entries are matched to a connected peer by url — by port, or by host. A peer that
 * advertises no endpoint can never match one: a phone running the chat app dials out and is
 * never dialled, so its entry is never found and it falls through to whatever `publicJoin`
 * allows anyone. That made "let my phone use my agent's brain" and "let anyone who joins use
 * my agent's brain" the same setting, and left an agent with publicJoin off no setting at all.
 *
 * An entry may instead carry `id` (or `name`), which matches the peer itself.
 */

const A = 19991 // the peer with no address of its own — a phone, in effect
const B = 19992 // the agent deciding what it may do

let a: VoleNetManager
let b: VoleNetManager
let idA: string

async function until(cond: () => boolean, ms = 20000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error(`until(): not met within ${ms}ms`)
		await new Promise((r) => setTimeout(r, 150))
	}
}

beforeAll(async () => {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-peer-id-'))
	const rootA = path.join(base, 'a')
	const rootB = path.join(base, 'b')
	await fs.mkdir(path.join(rootA, '.openvole/net'), { recursive: true })
	await fs.mkdir(path.join(rootB, '.openvole/net'), { recursive: true })
	const keyA = await generateKeyPair(path.join(rootA, '.openvole/net'), 'pocket')
	const keyB = await generateKeyPair(path.join(rootB, '.openvole/net'), 'agent-b')
	idA = keyA.instanceId

	// Each trusts the other's key, as pairing would leave them. What that trust may *do* is
	// the whole question here.
	await fs.writeFile(
		path.join(rootA, '.openvole/net/authorized_voles'),
		`${keyB.publicKeyString}\n`,
	)
	await fs.writeFile(
		path.join(rootB, '.openvole/net/authorized_voles'),
		`${keyA.publicKeyString}\n`,
	)

	a = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'pocket',
			role: 'peer',
			port: A,
			hostname: '127.0.0.1',
			peers: [{ url: `http://127.0.0.1:${B}`, trust: 'full' }],
		},
		rootA,
	)
	b = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'agent-b',
			role: 'peer',
			port: B,
			hostname: '127.0.0.1',
			// No url: there is no address to dial. The entry names who it is instead.
			peers: [{ id: idA, trust: 'read', allowBrain: true }],
		},
		rootB,
	)
	await b.start()
	await a.start()
	await until(() => b.getInstances().some((i) => i.id === idA))
}, 40000)

afterAll(async () => {
	await Promise.all([a?.stop(), b?.stop()])
})

// biome-ignore lint/suspicious/noExplicitAny: the tests edit config the way an operator would
const peersOf = (m: VoleNetManager) =>
	(m as any).config as { peers: Array<Record<string, unknown>> }

describe('a peers entry that names an identity', () => {
	it('grants what it says, with no address to match on', () => {
		const trust = b.getPeerTrust(idA)
		expect(trust).not.toBeNull()
		expect(trust?.trust).toBe('read')
		expect(trust?.allowBrain).toBe(true)
	})

	it('grants nothing to anyone else', () => {
		expect(b.getPeerTrust(`${'0'.repeat(63)}1`)).toBeNull()
	})

	it('takes a prefix, but not one short enough to collide', () => {
		const cfg = peersOf(b)
		cfg.peers = [{ id: idA.substring(0, 12), trust: 'tool', allowBrain: true }]
		expect(b.getPeerTrust(idA)?.allowBrain).toBe(true)

		cfg.peers = [{ id: idA.substring(0, 4), trust: 'tool', allowBrain: true }]
		expect(b.getPeerTrust(idA)).toBeNull()
	})

	it('matches an announced name too, for an id you have not written down', () => {
		const cfg = peersOf(b)
		cfg.peers = [{ name: 'pocket', trust: 'read', allowBrain: true }]
		expect(b.getPeerTrust(idA)?.allowBrain).toBe(true)

		cfg.peers = [{ name: 'someone-else', trust: 'read', allowBrain: true }]
		expect(b.getPeerTrust(idA)).toBeNull()
	})

	it('leaves address matching alone, and ignores an entry with neither', () => {
		const cfg = peersOf(b)
		cfg.peers = [{ url: `http://127.0.0.1:${A}`, trust: 'full', allowBrain: true }]
		expect(b.getPeerTrust(idA)?.trust).toBe('full')

		cfg.peers = [{ trust: 'full', allowBrain: true }]
		expect(b.getPeerTrust(idA)).toBeNull()
	})
})
