import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHUNK_BYTES_DEFAULT, totalChunksFor } from '../../src/net/file-crypto.js'

/**
 * VoleDrop has to carry the files people actually want to move between machines, and for this
 * project that means video: a gameplay capture is routinely 6-14 GB. Two ceilings stood in the way
 * and one of them failed badly — the dashboard streamed the whole upload before noticing it was
 * over budget, then said only "upload too large", naming neither the limit nor the way to raise it.
 *
 * These pin the three properties that keep a large send working: the arithmetic holds, the two
 * limits stay in the right order, and an over-sized upload is refused before it is transferred.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SERVER = path.join(ROOT, 'dashboard-server/src/server.ts')
const FILES = path.join(ROOT, 'core/src/net/files.ts')

const GIB = 1024 ** 3

async function read(p: string): Promise<string> {
	return fs.readFile(p, 'utf-8')
}

/** `const NAME = <expr>` evaluated as a number. */
function constant(source: string, name: string): number {
	const m = source.match(new RegExp(`const ${name} =\\s*([0-9*\\s]+)`))
	if (!m) throw new Error(`${name} not found`)
	return Number(new Function(`return ${m[1]}`)())
}

describe('large file transfers', () => {
	it('chunks and nonces stay in range far past any real file', () => {
		// The nonce is a 64-bit counter and sizes are float64 integers; both must hold at sizes
		// nobody will reach, or a big transfer corrupts rather than fails.
		for (const size of [6e9, 16 * GIB, 64 * GIB, 1024 * GIB]) {
			const chunks = totalChunksFor(size, CHUNK_BYTES_DEFAULT)
			expect(chunks).toBeGreaterThan(0)
			expect(Number.isSafeInteger(chunks)).toBe(true)
			// ciphertext = plaintext + per-frame overhead; must stay an exact integer
			expect(Number.isSafeInteger(size + chunks * 20)).toBe(true)
		}
		expect(totalChunksFor(6e9, CHUNK_BYTES_DEFAULT)).toBe(Math.ceil(6e9 / CHUNK_BYTES_DEFAULT))
	})

	it('accepts a video-sized file by default', async () => {
		const limit = constant(await read(FILES), 'DEFAULT_MAX_BYTES')
		// The size that prompted this: a 6 GB capture must not be refused out of the box.
		expect(limit).toBeGreaterThan(6e9)
	})

	it('keeps the upload spool above the transfer limit', async () => {
		// The refusal should come from the receiving node, which names its own limit and setting.
		// If the browser half is the smaller of the two it fails first and explains nothing.
		const transfer = constant(await read(FILES), 'DEFAULT_MAX_BYTES')
		const server = await read(SERVER)
		const upload = Number(
			server.match(/VOLE_UPLOAD_MAX_BYTES\) \|\|\s*([0-9*\s]+)/)?.[1]
				? new Function(
						`return ${server.match(/VOLE_UPLOAD_MAX_BYTES\) \|\|\s*([0-9*\s]+)/)?.[1]}`,
					)()
				: Number.NaN,
		)
		expect(Number.isFinite(upload)).toBe(true)
		expect(upload).toBeGreaterThan(transfer)
	})

	it('refuses an over-sized upload before transferring it', async () => {
		const server = await read(SERVER)
		// Both upload routes must consult the guard, or one of them still streams to nowhere.
		expect((server.match(/if \(refusedOversizeUpload\(req, res\)\) return/g) ?? []).length).toBe(2)

		const guard = server.slice(server.indexOf('function refusedOversizeUpload'))
		// Decided from the declared length, so nothing moves first.
		expect(guard).toContain("req.headers['content-length']")
		expect(guard).toContain('413')
		// A refusal has to say what the limit is and how to change it — the original said neither.
		expect(guard).toContain('VOLE_UPLOAD_MAX_BYTES')
		expect(guard).toContain('net_send_file')
		// Content-Length is a hint and can be absent or lie, so the streaming budget must remain.
		expect(server).toContain('MAX_UPLOAD_BYTES')
	})
})
