import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair, trustPeer } from '../../src/net/keys.js'
import { createMessage } from '../../src/net/protocol.js'

/**
 * Direct-mesh end-to-end encryption. Two directly-trusted peers with `encrypt: true` seal every
 * post-handshake message with the hybrid X25519 + ML-KEM-768 KEM before it crosses the wire — so a
 * network observer (or a peer without TLS) sees only ciphertext, yet the message is delivered and
 * processed normally. Interop: a peer with encryption OFF still talks to an encrypting peer both
 * ways (it seals outbound to a capable peer, accepts plaintext inbound).
 */

const A = 19851
const B = 19852
const C = 19853

let a: VoleNetManager
let b: VoleNetManager
let c: VoleNetManager
const dirs: Record<string, string> = {}

async function until(cond: () => boolean, ms = 15000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error('condition not met in time')
		await new Promise((r) => setTimeout(r, 100))
	}
}
// biome-ignore lint/suspicious/noExplicitAny: test reaches into manager internals
const id = (m: VoleNetManager) => (m as any).keyPair.instanceId as string
// biome-ignore lint/suspicious/noExplicitAny: test reaches into manager internals
const keys = (m: VoleNetManager) => (m as any).keyPair
// biome-ignore lint/suspicious/noExplicitAny: test reaches into manager internals
const sealerOf = (m: VoleNetManager) =>
	(m as any).transport.sealer as (p: string, msg: unknown) => { type: string; payload: unknown }

beforeAll(async () => {
	const fsp = await import('node:fs/promises')
	const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vole-enc-'))
	const k: Record<string, Awaited<ReturnType<typeof generateKeyPair>>> = {}
	for (const n of ['a', 'b', 'c']) {
		dirs[n] = path.join(root, n)
		await fsp.mkdir(path.join(dirs[n], '.openvole/net'), { recursive: true })
		k[n] = await generateKeyPair(path.join(dirs[n], '.openvole/net'), n)
	}
	// full mutual direct trust between all three
	for (const [x, y] of [
		['a', 'b'],
		['b', 'a'],
		['a', 'c'],
		['c', 'a'],
		['b', 'c'],
		['c', 'b'],
	]) {
		await trustPeer(path.join(dirs[x], '.openvole/net'), k[y].publicKeyString)
	}
	const mk = (name: string, port: number, peerPorts: number[], encrypt: boolean) =>
		new VoleNetManager(
			{
				enabled: true,
				instanceName: name,
				role: 'peer',
				port,
				encrypt,
				peers: peerPorts.map((p) => ({ url: `http://127.0.0.1:${p}`, trust: 'full' as const })),
			},
			dirs[name],
		)
	a = mk('a', A, [B, C], true) // encrypts
	b = mk('b', B, [A, C], true) // encrypts
	c = mk('c', C, [A, B], false) // does NOT encrypt
	await a.start()
	await b.start()
	await c.start()
	// wait until A has discovered B (with its ML-KEM key announced) — the capability signal
	await until(() => {
		const inst = a.getInstances().find((i) => i.name === 'b')
		return !!inst?.xPublicKey && !!inst?.mlkemPublicKey
	}, 30000)
}, 45000)

afterAll(async () => {
	await a?.stop?.()
	await b?.stop?.()
	await c?.stop?.()
})

describe('direct-mesh end-to-end encryption', () => {
	it('A→B chat round-trips through the hybrid seal', async () => {
		const aId = id(a)
		const secret = 'the vault code is 4747'
		const res = await a.sendChat('b', secret)
		expect(res.ok).toBe(true)
		await until(() => false || true) // yield
		let hist: Awaited<ReturnType<typeof b.getChatHistory>> = []
		const t0 = Date.now()
		while (Date.now() - t0 < 12000) {
			hist = await b.getChatHistory(aId)
			if (hist.some((e) => e.dir === 'in' && e.text === secret)) break
			await new Promise((r) => setTimeout(r, 120))
		}
		expect(hist.some((e) => e.dir === 'in' && e.text === secret)).toBe(true)
	})

	it('the wire carries a sealed:direct envelope — the plaintext never crosses readable', () => {
		const bId = id(b)
		const secret = 'launch at dawn'
		const msg = createMessage(
			'chat:message',
			id(a),
			bId,
			{ text: secret, fromName: 'a' },
			keys(a).privateKey,
			keys(a).pqPrivateKey,
		)
		const wire = sealerOf(a)(bId, msg) // exactly what sendToPeer would serialize
		expect(wire.type).toBe('sealed:direct')
		expect((wire.payload as { box?: unknown }).box).toBeTruthy()
		expect(JSON.stringify(wire)).not.toContain(secret) // ciphertext only
		expect(JSON.stringify(wire)).not.toContain('chat:message') // inner type hidden too
	})

	it('a peer with encryption OFF sends the message in the clear (opt-in gate works)', () => {
		const aId = id(a)
		const msg = createMessage(
			'chat:message',
			id(c),
			aId,
			{ text: 'hello', fromName: 'c' },
			keys(c).privateKey,
			keys(c).pqPrivateKey,
		)
		const wire = sealerOf(c)(aId, msg) // C has encrypt:false → pass-through
		expect(wire.type).toBe('chat:message')
	})

	it('mixed-version interop: A (encrypting) ↔ C (plaintext) both deliver', async () => {
		const aId = id(a)
		const cId = id(c)
		// A → C : A seals (C announced ML-KEM), C unwraps
		await a.sendChat('c', 'sealed to you')
		// C → A : C sends plaintext, A accepts it
		await c.sendChat('a', 'plain to you')
		let ac = false
		let ca = false
		const t0 = Date.now()
		while (Date.now() - t0 < 12000 && !(ac && ca)) {
			ac = (await c.getChatHistory(aId)).some((e) => e.dir === 'in' && e.text === 'sealed to you')
			ca = (await a.getChatHistory(cId)).some((e) => e.dir === 'in' && e.text === 'plain to you')
			await new Promise((r) => setTimeout(r, 120))
		}
		expect(ac).toBe(true)
		expect(ca).toBe(true)
	})
})
