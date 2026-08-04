import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type MessageBus, createMessageBus } from '../../src/core/bus.js'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair, trustPeer } from '../../src/net/keys.js'

/**
 * VoleDrop consent + push-mode fallback:
 *  - no acceptFrom → offers hold as 'pending' (volenet:file:offer auto=false), zero bytes move
 *  - explicit acceptFile completes; rejectFile reports 'rejected' to the sender
 *  - a sender with a black-hole advertised endpoint fails the receiver's probe → push mode
 */

const A = 19931
const B = 19932

let a: VoleNetManager
let b: VoleNetManager
let bBus: MessageBus
let rootA: string
let rootB: string
let offers: Array<{ transferId: string; auto: boolean }>

async function until(cond: () => boolean, ms = 20000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		// Throw, never return silently: a swallowed timeout here let a slow suite setup
		// masquerade as an instant assertion failure in the first test (the roster wait gave
		// up quietly, then sendFile failed fast) — a flake with a misleading stack.
		if (Date.now() - t0 > ms) throw new Error(`until(): not met within ${ms}ms — ${cond}`)
		await new Promise((r) => setTimeout(r, 150))
	}
}

beforeAll(async () => {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-files-consent-'))
	rootA = path.join(base, 'a')
	rootB = path.join(base, 'b')
	await fs.mkdir(path.join(rootA, '.openvole/net'), { recursive: true })
	await fs.mkdir(path.join(rootB, '.openvole/net'), { recursive: true })
	const ka = await generateKeyPair(path.join(rootA, '.openvole/net'), 'push-a')
	const kb = await generateKeyPair(path.join(rootB, '.openvole/net'), 'consent-b')
	await trustPeer(path.join(rootA, '.openvole/net'), kb.publicKeyString)
	await trustPeer(path.join(rootB, '.openvole/net'), ka.publicKeyString)

	// Sender advertises an unroutable endpoint (TEST-NET-3) — receiver's probe must fail,
	// forcing push mode. Its outbound connection to B still works.
	a = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'push-a',
			role: 'peer',
			port: A,
			hostname: '203.0.113.1',
			peers: [{ url: `http://127.0.0.1:${B}`, trust: 'full' }],
			files: { chunkBytes: 32 * 1024 },
		},
		rootA,
	)
	await a.start()

	bBus = createMessageBus()
	offers = []
	bBus.on('volenet:file:offer', (d) => offers.push(d as { transferId: string; auto: boolean }))
	b = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'consent-b',
			role: 'peer',
			port: B,
			files: { chunkBytes: 32 * 1024 }, // NO acceptFrom → explicit consent only
		},
		rootB,
	)
	await b.start(undefined, bBus)

	await until(() => a.getInstances().length > 0 && b.getInstances().length > 0)
}, 40000)

afterAll(async () => {
	await Promise.all([a?.stop(), b?.stop()])
})

describe('VoleDrop consent + push mode', () => {
	it('holds offers pending, then explicit accept completes over PUSH', async () => {
		const payload = crypto.randomBytes(200 * 1024)
		const src = path.join(rootA, 'clip.bin')
		await fs.writeFile(src, payload)

		const sent = await a.sendFile('consent-b', src, 'for the evening loop')
		expect(sent.ok).toBe(true)
		const tid = sent.transferId as string

		// Held as pending — no auto path, nothing transferred yet.
		await until(() => b.getFileTransfer(tid)?.state === 'pending')
		expect(b.getFileTransfer(tid)?.state).toBe('pending')
		expect(offers.find((o) => o.transferId === tid)?.auto).toBe(false)
		expect(a.getFileTransfer(tid)?.state).toBe('offered')

		// Explicit accept → probe of 203.0.113.1 fails (~4s) → push chosen → delivered.
		const acc = await b.acceptFile(tid)
		expect(acc.ok).toBe(true)
		await until(() => b.getFileTransfer(tid)?.state === 'done', 30000)
		expect(b.getFileTransfer(tid)?.state).toBe('done')
		expect(b.getFileTransfer(tid)?.mode).toBe('push')
		const received = await fs.readFile(b.getFileTransfer(tid)?.savedPath as string)
		expect(received.equals(payload)).toBe(true)
		await until(() => a.getFileTransfer(tid)?.state === 'done')
		expect(a.getFileTransfer(tid)?.state).toBe('done')
	}, 60000)

	it('explicit reject reports back to the sender', async () => {
		const src = path.join(rootA, 'unwanted.bin')
		await fs.writeFile(src, crypto.randomBytes(1024))
		const sent = await a.sendFile('consent-b', src)
		const tid = sent.transferId as string
		await until(() => b.getFileTransfer(tid)?.state === 'pending')
		await b.rejectFile(tid)
		await until(() => a.getFileTransfer(tid)?.state === 'rejected')
		expect(a.getFileTransfer(tid)?.state).toBe('rejected')
		expect(b.getFileTransfer(tid)?.state).toBe('rejected')
	}, 40000)

	it('note travels with the offer', async () => {
		const anyOffer = offers[0]
		expect(anyOffer).toBeTruthy()
		const info = b.getFileTransfer(anyOffer.transferId)
		expect(info?.note).toBe('for the evening loop')
	})
})
