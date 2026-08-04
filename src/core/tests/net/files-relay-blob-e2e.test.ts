import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair, trustPeer } from '../../src/net/keys.js'

/**
 * VoleDrop relay blobs — two NAT'd members exchanging a file through the hub:
 *   - members trust only the hub; the offer travels sealed via the hub roster
 *   - the hub stores CIPHERTEXT only (asserted against a plaintext marker) and
 *     deletes the blob after relay:blob:done
 *   - a corrupted stored blob fails the AEAD/sha and never lands in the inbox
 *   - per-pair quota denials surface as relay-denied
 */

const HUB = 19951
const MA = 19952
const MB = 19953

let hub: VoleNetManager
let a: VoleNetManager
let b: VoleNetManager
let rootHub: string
let rootA: string
let rootB: string

async function until(cond: () => boolean, ms = 25000): Promise<void> {
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
	const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-files-relay-'))
	rootHub = path.join(base, 'hub')
	rootA = path.join(base, 'a')
	rootB = path.join(base, 'b')
	for (const d of [rootHub, rootA, rootB])
		await fs.mkdir(path.join(d, '.openvole/net'), { recursive: true })
	const kh = await generateKeyPair(path.join(rootHub, '.openvole/net'), 'the-hub')
	const ka = await generateKeyPair(path.join(rootA, '.openvole/net'), 'member-a')
	const kb = await generateKeyPair(path.join(rootB, '.openvole/net'), 'member-b')
	// Members trust only the hub; the hub trusts both members. A and B never meet directly.
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
			files: { relayQuotaBytes: 2 * 1024 * 1024, relayTtlHours: 1 },
		},
		rootHub,
	)
	await hub.start()

	a = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'member-a',
			role: 'peer',
			port: MA,
			peers: [{ url: `http://127.0.0.1:${HUB}`, trust: 'full' }],
			files: { chunkBytes: 64 * 1024 },
		},
		rootA,
	)
	await a.start()

	b = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'member-b',
			role: 'peer',
			port: MB,
			peers: [{ url: `http://127.0.0.1:${HUB}`, trust: 'full' }],
			files: { acceptFrom: '*', chunkBytes: 64 * 1024 },
		},
		rootB,
	)
	await b.start()

	// Wait for the hub's roster to reach both members. 35s: the heaviest setup in the net
	// suites (hub + two members, three key generations) — under parallel load 25s was tight,
	// and the beforeAll cap is 40s.
	await until(() => {
		// biome-ignore lint/suspicious/noExplicitAny: test reads internals
		const rosters = (a as any).hubRosters as Map<string, Map<string, { name: string }>>
		for (const roster of rosters.values())
			for (const m of roster.values()) if (m.name === 'member-b') return true
		return false
	}, 35000)
}, 40000)

afterAll(async () => {
	await Promise.all([hub?.stop(), a?.stop(), b?.stop()])
})

describe('VoleDrop relay blobs', () => {
	it('delivers via the hub, ciphertext-only, and cleans the blob up', async () => {
		const marker = Buffer.from('PLAINTEXT-MARKER-VOLE-')
		const payload = Buffer.concat(Array.from({ length: 8000 }, () => marker)) // ~176KB
		const src = path.join(rootA, 'secret-recording.bin')
		await fs.writeFile(src, payload)

		// Capture hub blob bytes while the transfer is in flight.
		const blobDir = path.join(rootHub, '.openvole/net/blobs')
		let captured: Buffer | null = null
		const capture = setInterval(() => {
			void (async () => {
				try {
					for (const name of await fs.readdir(blobDir)) {
						if (name.endsWith('.meta.json')) continue
						const buf = await fs.readFile(path.join(blobDir, name))
						if (buf.length > 0) captured = buf
					}
				} catch {
					/* dir may not exist yet */
				}
			})()
		}, 25)

		const sent = await a.sendFile('member-b', src)
		expect(sent.ok).toBe(true)
		const tid = sent.transferId as string
		await until(() => b.getFileTransfer(tid)?.state === 'done')
		clearInterval(capture)

		expect(b.getFileTransfer(tid)?.state).toBe('done')
		expect(b.getFileTransfer(tid)?.mode).toBe('relay')
		const received = await fs.readFile(b.getFileTransfer(tid)?.savedPath as string)
		expect(received.equals(payload)).toBe(true)
		await until(() => a.getFileTransfer(tid)?.state === 'done')

		// The hub only ever held ciphertext…
		expect(captured).not.toBeNull()
		expect((captured as unknown as Buffer).includes(marker)).toBe(false)
		// …and deleted the blob once the receiver confirmed.
		let left: string[] = []
		const t0 = Date.now()
		while (Date.now() - t0 < 10000) {
			left = ((await fs.readdir(blobDir).catch(() => [])) as string[]).filter(
				(n) => !n.startsWith('.'),
			)
			if (left.length === 0) break
			await new Promise((r) => setTimeout(r, 150))
		}
		expect(left).toEqual([])
	}, 60000)

	it('a corrupted stored blob fails verification and never lands', async () => {
		const payload = crypto.randomBytes(150 * 1024)
		const src = path.join(rootA, 'tampered.bin')
		await fs.writeFile(src, payload)

		// Delay B's download long enough to corrupt the stored blob on the hub.
		// biome-ignore lint/suspicious/noExplicitAny: test patches internals deliberately
		const filesB = (b as any).files
		const orig = filesB.runRelayDownload.bind(filesB)
		filesB.runRelayDownload = async (t: unknown) => {
			await new Promise((r) => setTimeout(r, 900))
			return orig(t)
		}
		try {
			const sent = await a.sendFile('member-b', src)
			const tid = sent.transferId as string
			// Corrupt the blob as soon as it lands on the hub.
			const blobDir = path.join(rootHub, '.openvole/net/blobs')
			await until(() => true, 0)
			let corrupted = false
			const t0 = Date.now()
			while (!corrupted && Date.now() - t0 < 10000) {
				try {
					for (const name of await fs.readdir(blobDir)) {
						if (name.endsWith('.meta.json') || name.endsWith('.part')) continue
						const p = path.join(blobDir, name)
						const buf = await fs.readFile(p)
						if (buf.length > 100) {
							buf[Math.floor(buf.length / 2)] ^= 0xff
							await fs.writeFile(p, buf)
							corrupted = true
						}
					}
				} catch {
					/* not yet */
				}
				await new Promise((r) => setTimeout(r, 50))
			}
			expect(corrupted).toBe(true)
			await until(() => {
				const st = b.getFileTransfer(tid)?.state
				return st === 'failed' || st === 'done'
			})
			expect(b.getFileTransfer(tid)?.state).toBe('failed')
			expect(b.getFileTransfer(tid)?.savedPath).toBeUndefined()
		} finally {
			filesB.runRelayDownload = orig
		}
	}, 60000)

	it('denies transfers over the hub pair quota', async () => {
		const src = path.join(rootA, 'over-quota.bin')
		await fs.writeFile(src, crypto.randomBytes(3 * 1024 * 1024)) // > hub's 2MiB quota
		const sent = await a.sendFile('member-b', src)
		const tid = sent.transferId as string
		await until(() => a.getFileTransfer(tid)?.state === 'failed')
		expect(a.getFileTransfer(tid)?.state).toBe('failed')
		expect(a.getFileTransfer(tid)?.error).toContain('relay-denied')
	}, 60000)
})
