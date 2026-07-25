import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMessageBus, type MessageBus } from '../../src/core/bus.js'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair } from '../../src/net/keys.js'

/**
 * Consent-based pairing (vole net pair): an unknown node introduces itself via
 * POST /volenet/pair; NOTHING is trusted until the operator accepts; acceptance
 * grants trust live (no restart) and the mesh forms.
 */

const A = 19971
const B = 19972

let a: VoleNetManager
let b: VoleNetManager
let bBus: MessageBus
let rootA: string
let rootB: string
let pairEvents: Array<{ from: string; fromName: string }>

async function until(cond: () => boolean, ms = 20000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) return
		await new Promise((r) => setTimeout(r, 150))
	}
}

beforeAll(async () => {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-pair-'))
	rootA = path.join(base, 'a')
	rootB = path.join(base, 'b')
	await fs.mkdir(path.join(rootA, '.openvole/net'), { recursive: true })
	await fs.mkdir(path.join(rootB, '.openvole/net'), { recursive: true })
	await generateKeyPair(path.join(rootA, '.openvole/net'), 'initiator-a')
	await generateKeyPair(path.join(rootB, '.openvole/net'), 'acceptor-b')
	// Deliberately NO mutual trust — pairing must establish it.

	a = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'initiator-a',
			role: 'peer',
			port: A,
			hostname: '127.0.0.1',
			peers: [{ url: `http://127.0.0.1:${B}`, trust: 'full' }],
		},
		rootA,
	)
	await a.start()

	bBus = createMessageBus()
	pairEvents = []
	bBus.on('volenet:pair:request', (d) => pairEvents.push(d as { from: string; fromName: string }))
	b = new VoleNetManager(
		{ enabled: true, instanceName: 'acceptor-b', role: 'peer', port: B, hostname: '127.0.0.1' },
		rootB,
	)
	await b.start(undefined, bBus)
}, 40000)

afterAll(async () => {
	await Promise.all([a?.stop(), b?.stop()])
})

describe('consent-based pairing', () => {
	it('exposes the public key on /volenet/info for fingerprinting', async () => {
		const info = (await (await fetch(`http://127.0.0.1:${B}/volenet/info`)).json()) as {
			publicKey?: string
			name?: string
		}
		expect(info.publicKey).toMatch(/^vole-ed25519 /)
		expect(info.name).toBeUndefined() // names stay private without publishNames
	})

	it('queues a pair request without trusting, then accept grants trust live', async () => {
		// The initiator's local half: trust B (simulating the CLI's fingerprint-confirm step).
		const { trustPeer } = await import('../../src/net/keys.js')
		const infoB = (await (await fetch(`http://127.0.0.1:${B}/volenet/info`)).json()) as {
			publicKey: string
		}
		await trustPeer(path.join(rootA, '.openvole/net'), infoB.publicKey)
		// The real CLI restarts the initiating agent after trusting; a live manager
		// re-reads its trust store the same way the acceptor does.
		// biome-ignore lint/suspicious/noExplicitAny: test reaches internals
		await (a as any).discovery.reloadAuthorized()

		// File the pair request (what `vole net pair <url>` POSTs).
		const keyA = (await (await fetch(`http://127.0.0.1:${A}/volenet/info`)).json()) as {
			publicKey: string
		}
		const resp = (await (
			await fetch(`http://127.0.0.1:${B}/volenet/pair`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					publicKey: keyA.publicKey,
					name: 'initiator-a',
					note: 'same fleet',
					endpoint: `http://127.0.0.1:${A}`,
				}),
			})
		).json()) as { ok?: boolean; pending?: boolean }
		expect(resp.ok).toBe(true)
		expect(resp.pending).toBe(true)

		// B has the request surfaced, but does NOT trust A yet — no mesh forms.
		await until(() => pairEvents.length > 0)
		expect(pairEvents[0]?.fromName).toBe('initiator-a')
		expect(b.listPairRequests().length).toBe(1)
		expect(b.getInstances().length).toBe(0)

		// Operator accepts → trust granted live, dial-back + A's retry form the mesh.
		const acc = await b.acceptPair('initiator-a')
		expect(acc.ok).toBe(true)
		expect(b.listPairRequests().length).toBe(0)

		await until(() => a.getInstances().length > 0 && b.getInstances().length > 0)
		expect(a.getInstances().map((i) => i.name)).toContain('acceptor-b')
		expect(b.getInstances().map((i) => i.name)).toContain('initiator-a')
	}, 40000)

	it('deny removes the request without granting anything', async () => {
		const extra = await generateKeyPair(
			path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'vole-pair-x-')), 'net'),
			'stranger',
		)
		await fetch(`http://127.0.0.1:${B}/volenet/pair`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ publicKey: extra.publicKeyString, name: 'stranger' }),
		})
		await until(() => b.listPairRequests().some((r) => r.name === 'stranger'))
		const denied = await b.denyPair('stranger')
		expect(denied.ok).toBe(true)
		expect(b.listPairRequests().some((r) => r.name === 'stranger')).toBe(false)
	}, 20000)

	it('rejects garbage keys', async () => {
		const r = await fetch(`http://127.0.0.1:${B}/volenet/pair`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ publicKey: 'not-a-key' }),
		})
		expect(r.status).toBe(400)
	})

	it('dashboard flow: probePair + initiatePair pair two fresh nodes live', async () => {
		const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-pair-dash-'))
		const rootC = path.join(base, 'c')
		const rootD = path.join(base, 'd')
		await fs.mkdir(path.join(rootC, '.openvole/net'), { recursive: true })
		await fs.mkdir(path.join(rootD, '.openvole/net'), { recursive: true })
		await generateKeyPair(path.join(rootC, '.openvole/net'), 'dash-c')
		await generateKeyPair(path.join(rootD, '.openvole/net'), 'dash-d')
		// Give C a config file so addPeerEntry can persist the peers entry.
		await fs.writeFile(path.join(rootC, 'vole.config.json'), JSON.stringify({ net: {} }))
		const c = new VoleNetManager(
			{ enabled: true, instanceName: 'dash-c', role: 'peer', port: 19973, hostname: '127.0.0.1' },
			rootC,
		)
		const d = new VoleNetManager(
			{ enabled: true, instanceName: 'dash-d', role: 'peer', port: 19974, hostname: '127.0.0.1' },
			rootD,
		)
		await c.start()
		await d.start()
		try {
			const probe = await c.probePair('http://127.0.0.1:19974')
			expect(probe.ok).toBe(true)
			expect(probe.publicKey).toMatch(/^vole-ed25519 /)
			expect(probe.alreadyTrusted).toBe(false)

			const init = await c.initiatePair('http://127.0.0.1:19974', probe.publicKey as string)
			expect(init.ok).toBe(true)
			expect(init.pending).toBe(true)
			expect(d.listPairRequests().map((r) => r.name)).toContain('dash-c')

			const acc = await d.acceptPair('dash-c')
			expect(acc.ok).toBe(true)
			await until(() => c.getInstances().length > 0 && d.getInstances().length > 0)
			expect(c.getInstances().map((i) => i.name)).toContain('dash-d')
			expect(d.getInstances().map((i) => i.name)).toContain('dash-c')
			// The peers entry was persisted for future restarts.
			const cfg = JSON.parse(await fs.readFile(path.join(rootC, 'vole.config.json'), 'utf-8'))
			expect(cfg.net.peers.some((p: { url: string }) => p.url === 'http://127.0.0.1:19974')).toBe(true)
		} finally {
			await Promise.all([c.stop(), d.stop()])
		}
	}, 40000)
})
