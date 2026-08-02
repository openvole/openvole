import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type MessageBus, createMessageBus } from '../../src/core/bus.js'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair, trustPeer } from '../../src/net/keys.js'

/**
 * VoleDrop direct-mesh pull: A offers, B (acceptFrom '*') auto-accepts, probes A's
 * endpoint, pulls the encrypted frames, verifies sha256, lands the file in its inbox.
 */

const A = 19921
const B = 19922

let a: VoleNetManager
let b: VoleNetManager
let bBus: MessageBus
let rootA: string
let rootB: string
let events: Array<{ type: string; data: unknown }>

async function until(cond: () => boolean, ms = 20000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) return
		await new Promise((r) => setTimeout(r, 150))
	}
}

beforeAll(async () => {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-files-pull-'))
	rootA = path.join(base, 'a')
	rootB = path.join(base, 'b')
	await fs.mkdir(path.join(rootA, '.openvole/net'), { recursive: true })
	await fs.mkdir(path.join(rootB, '.openvole/net'), { recursive: true })
	const ka = await generateKeyPair(path.join(rootA, '.openvole/net'), 'sender-a')
	const kb = await generateKeyPair(path.join(rootB, '.openvole/net'), 'recv-b')
	await trustPeer(path.join(rootA, '.openvole/net'), kb.publicKeyString)
	await trustPeer(path.join(rootB, '.openvole/net'), ka.publicKeyString)

	a = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'sender-a',
			role: 'peer',
			port: A,
			files: { chunkBytes: 64 * 1024 },
		},
		rootA,
	)
	await a.start()

	bBus = createMessageBus()
	events = []
	for (const ev of [
		'volenet:file:offer',
		'volenet:file:received',
		'volenet:file:failed',
	] as const) {
		bBus.on(ev, (data) => events.push({ type: ev, data }))
	}
	b = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'recv-b',
			role: 'peer',
			port: B,
			peers: [{ url: `http://127.0.0.1:${A}`, trust: 'full' }],
			files: { acceptFrom: '*', maxBytes: 8 * 1024 * 1024, chunkBytes: 64 * 1024 },
		},
		rootB,
	)
	await b.start(undefined, bBus)

	await until(() => a.getInstances().length > 0 && b.getInstances().length > 0)
}, 40000)

afterAll(async () => {
	await Promise.all([a?.stop(), b?.stop()])
})

describe('VoleDrop direct pull', () => {
	it('delivers a multi-chunk file end to end, sha-verified', async () => {
		const payload = crypto.randomBytes(700 * 1024) // ~11 chunks at 64KB
		const src = path.join(rootA, 'gameplay recording.mkv')
		await fs.writeFile(src, payload)

		const sent = await a.sendFile('recv-b', src)
		expect(sent.ok).toBe(true)
		const tid = sent.transferId as string

		await until(() => a.getFileTransfer(tid)?.state === 'done')
		const sendInfo = a.getFileTransfer(tid)
		expect(sendInfo?.state).toBe('done')
		expect(sendInfo?.mode).toBe('pull')

		const recvInfo = b.getFileTransfer(tid)
		expect(recvInfo?.state).toBe('done')
		expect(recvInfo?.savedPath).toBeTruthy()
		const received = await fs.readFile(recvInfo?.savedPath as string)
		expect(received.equals(payload)).toBe(true)
		expect(recvInfo?.sha256).toBe(crypto.createHash('sha256').update(payload).digest('hex'))

		const types = events.map((e) => e.type)
		expect(types).toContain('volenet:file:offer')
		expect(types).toContain('volenet:file:received')
		expect(types).not.toContain('volenet:file:failed')
		const offer = events.find((e) => e.type === 'volenet:file:offer')?.data as { auto: boolean }
		expect(offer.auto).toBe(true)
	}, 40000)

	it('suffixes collisions instead of overwriting', async () => {
		const payload = crypto.randomBytes(64)
		const src = path.join(rootA, 'notes.txt')
		await fs.writeFile(src, payload)
		const s1 = await a.sendFile('recv-b', src)
		await until(() => a.getFileTransfer(s1.transferId as string)?.state === 'done')
		const s2 = await a.sendFile('recv-b', src)
		await until(() => a.getFileTransfer(s2.transferId as string)?.state === 'done')
		const p1 = b.getFileTransfer(s1.transferId as string)?.savedPath as string
		const p2 = b.getFileTransfer(s2.transferId as string)?.savedPath as string
		expect(p1).not.toBe(p2)
		expect(path.basename(p2)).toBe('notes (1).txt')
	}, 40000)

	it('sanitizes hostile filenames to a basename', async () => {
		const src = path.join(rootA, 'innocent.bin')
		await fs.writeFile(src, crypto.randomBytes(32))
		// The offer carries the display name — simulate a hostile one via a renamed copy.
		const evil = path.join(rootA, '..evil.bin')
		await fs.writeFile(evil, crypto.randomBytes(32))
		const s = await a.sendFile('recv-b', evil)
		expect(s.ok).toBe(true)
		await until(() => a.getFileTransfer(s.transferId as string)?.state === 'done')
		const saved = b.getFileTransfer(s.transferId as string)?.savedPath as string
		// Landed inside B's inbox, not outside it.
		expect(saved.startsWith(path.join(rootB, '.openvole/net/inbox'))).toBe(true)
	}, 40000)

	it('auto-rejects offers over maxBytes', async () => {
		const src = path.join(rootA, 'big.bin')
		await fs.writeFile(src, crypto.randomBytes(9 * 1024 * 1024)) // > B's 8MiB cap
		const s = await a.sendFile('recv-b', src)
		expect(s.ok).toBe(true)
		await until(() => a.getFileTransfer(s.transferId as string)?.state === 'rejected')
		expect(a.getFileTransfer(s.transferId as string)?.state).toBe('rejected')
		// The reason names both numbers so the sender knows whether to split the file or ask for
		// a bigger limit, rather than being told only that something was too large.
		const why = a.getFileTransfer(s.transferId as string)?.error ?? ''
		expect(why).toMatch(/^too-large/)
		expect(why).toMatch(/9(\.0)? MiB/)
		expect(why).toMatch(/8(\.0)? MiB/)
		expect(why).toMatch(/net\.files\.maxBytes/)
	}, 40000)
})
