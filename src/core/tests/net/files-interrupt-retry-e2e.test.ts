import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair, trustPeer } from '../../src/net/keys.js'

/**
 * VoleDrop interrupt + resume: the sender's blob stream dies mid-transfer on the first
 * attempt; the receiver retries with ?from=<completed chunks> and the transfer completes
 * with a correct sha — proving chunk-boundary truncation + deterministic re-encryption.
 */

const A = 19961
const B = 19962

let a: VoleNetManager
let b: VoleNetManager
let rootA: string
let rootB: string

async function until(cond: () => boolean, ms = 30000): Promise<void> {
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
	const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-files-resume-'))
	rootA = path.join(base, 'a')
	rootB = path.join(base, 'b')
	await fs.mkdir(path.join(rootA, '.openvole/net'), { recursive: true })
	await fs.mkdir(path.join(rootB, '.openvole/net'), { recursive: true })
	const ka = await generateKeyPair(path.join(rootA, '.openvole/net'), 'flaky-a')
	const kb = await generateKeyPair(path.join(rootB, '.openvole/net'), 'patient-b')
	await trustPeer(path.join(rootA, '.openvole/net'), kb.publicKeyString)
	await trustPeer(path.join(rootB, '.openvole/net'), ka.publicKeyString)

	a = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'flaky-a',
			role: 'peer',
			port: A,
			hostname: '127.0.0.1',
			files: { chunkBytes: 32 * 1024 },
		},
		rootA,
	)
	await a.start()
	b = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'patient-b',
			role: 'peer',
			port: B,
			peers: [{ url: `http://127.0.0.1:${A}`, trust: 'full' }],
			files: { acceptFrom: '*', chunkBytes: 32 * 1024 },
		},
		rootB,
	)
	await b.start()
	await until(() => a.getInstances().length > 0 && b.getInstances().length > 0)
}, 40000)

afterAll(async () => {
	await Promise.all([a?.stop(), b?.stop()])
})

describe('VoleDrop interrupt + resume', () => {
	it('resumes a killed pull from the chunk boundary and lands the exact bytes', async () => {
		const payload = crypto.randomBytes(400 * 1024) // 13 chunks at 32KB
		const src = path.join(rootA, 'resume-me.bin')
		await fs.writeFile(src, payload)

		// First pull attempt: kill the response stream after ~3 chunks. Later attempts serve fully.
		// biome-ignore lint/suspicious/noExplicitAny: test patches internals deliberately
		const filesA = (a as any).files
		const orig = filesA.serveSenderPull.bind(filesA)
		const seen: number[] = []
		filesA.serveSenderPull = async (
			req: import('node:http').IncomingMessage,
			res: import('node:http').ServerResponse,
			entry: unknown,
		) => {
			const from = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('from') ?? 0) || 0
			seen.push(from)
			if (seen.length === 1) {
				// Deterministic mid-stream interruption: end the response short of the declared
				// Content-Length after ~3 chunks. A FIN (unlike an RST) lets the flushed frames
				// reach the receiver, so the retry genuinely resumes from a later chunk.
				let written = 0
				let ended = false
				const realWrite = res.write.bind(res)
				// biome-ignore lint/suspicious/noExplicitAny: raw stream monkey-patch
				;(res as any).write = (chunk: Buffer, ...rest: unknown[]) => {
					if (ended) return true
					written += chunk.length
					if (written > 3.5 * 32 * 1024) {
						ended = true
						res.end()
						return true
					}
					// biome-ignore lint/suspicious/noExplicitAny: passthrough
					return realWrite(chunk, ...(rest as any[]))
				}
			}
			return orig(req, res, entry)
		}
		try {
			const sent = await a.sendFile('patient-b', src)
			expect(sent.ok).toBe(true)
			const tid = sent.transferId as string
			await until(() => b.getFileTransfer(tid)?.state === 'done')
			expect(b.getFileTransfer(tid)?.state).toBe('done')
			const received = await fs.readFile(b.getFileTransfer(tid)?.savedPath as string)
			expect(received.equals(payload)).toBe(true)
			// The receiver retried, and the retry resumed from a non-zero chunk.
			expect(seen.length).toBeGreaterThan(1)
			expect(seen[0]).toBe(0)
			expect(seen.some((f) => f > 0)).toBe(true)
		} finally {
			filesA.serveSenderPull = orig
		}
	}, 60000)
})
