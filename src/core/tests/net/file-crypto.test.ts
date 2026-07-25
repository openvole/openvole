import * as crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
	CHUNK_BYTES_DEFAULT,
	ChunkDecryptStream,
	ChunkEncryptStream,
	FRAME_OVERHEAD,
	cipherSizeFor,
	decryptChunk,
	encryptChunk,
	totalChunksFor,
} from '../../src/net/file-crypto.js'

const KEY = crypto.randomBytes(32)
const TID = 'test-transfer-1'

async function pump(input: Buffer, ...streams: NodeJS.ReadWriteStream[]): Promise<Buffer> {
	const out: Buffer[] = []
	let stream: NodeJS.ReadableStream = Readable.from([input])
	for (const s of streams) stream = stream.pipe(s)
	for await (const chunk of stream) out.push(chunk as Buffer)
	return Buffer.concat(out)
}

describe('file-crypto framing', () => {
	const CHUNK = 1024 // small chunk size to exercise boundaries cheaply

	it('round-trips sizes across chunk boundaries', async () => {
		for (const size of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 3 + 17]) {
			const plain = crypto.randomBytes(size)
			const enc = new ChunkEncryptStream(KEY, TID, CHUNK)
			const dec = new ChunkDecryptStream(KEY, TID, CHUNK)
			const back = await pump(plain, enc, dec)
			expect(back.equals(plain), `size ${size}`).toBe(true)
			expect(enc.chunksEmitted).toBe(totalChunksFor(size, CHUNK))
			expect(dec.chunksDone).toBe(totalChunksFor(size, CHUNK))
		}
	})

	it('cipherSizeFor matches actual wire size', async () => {
		for (const size of [0, 1, CHUNK, CHUNK * 2 + 5]) {
			const plain = crypto.randomBytes(size)
			const wire = await pump(plain, new ChunkEncryptStream(KEY, TID, CHUNK))
			expect(wire.length).toBe(cipherSizeFor(size, CHUNK))
		}
	})

	it('rejects a flipped ciphertext byte', async () => {
		const wire = await pump(crypto.randomBytes(CHUNK * 2), new ChunkEncryptStream(KEY, TID, CHUNK))
		wire[CHUNK / 2] ^= 0xff
		await expect(pump(wire, new ChunkDecryptStream(KEY, TID, CHUNK))).rejects.toThrow(
			/failed authentication/,
		)
	})

	it('rejects reordered chunks (position bound via AAD)', () => {
		const a = encryptChunk(KEY, TID, 0, Buffer.from('chunk-a'))
		const b = encryptChunk(KEY, TID, 1, Buffer.from('chunk-b'))
		// Present chunk b's body at index 0: tag must fail.
		expect(decryptChunk(KEY, TID, 0, b.subarray(4))).toBeNull()
		expect(decryptChunk(KEY, TID, 0, a.subarray(4))).not.toBeNull()
	})

	it('rejects frames transplanted across transfers', () => {
		const frame = encryptChunk(KEY, TID, 0, Buffer.from('secret'))
		expect(decryptChunk(KEY, 'other-transfer', 0, frame.subarray(4))).toBeNull()
	})

	it('resume re-encryption is byte-identical from a chunk boundary', async () => {
		const plain = crypto.randomBytes(CHUNK * 4 + 100)
		const full = await pump(plain, new ChunkEncryptStream(KEY, TID, CHUNK))
		const resumed = await pump(
			plain.subarray(CHUNK * 2),
			new ChunkEncryptStream(KEY, TID, CHUNK, 2),
		)
		// Wire bytes from chunk 2 onward must match the resumed encryption exactly.
		const skip = 2 * (CHUNK + FRAME_OVERHEAD)
		expect(full.subarray(skip).equals(resumed)).toBe(true)
		// And a decryptor starting at chunk 2 accepts them.
		const tail = await pump(resumed, new ChunkDecryptStream(KEY, TID, CHUNK, 2))
		expect(tail.equals(plain.subarray(CHUNK * 2))).toBe(true)
	})

	it('rejects trailing garbage and oversized frames', async () => {
		const wire = await pump(crypto.randomBytes(10), new ChunkEncryptStream(KEY, TID, CHUNK))
		await expect(
			pump(Buffer.concat([wire, Buffer.from([1, 2, 3])]), new ChunkDecryptStream(KEY, TID, CHUNK)),
		).rejects.toThrow(/trailing|invalid frame/)

		const bogus = Buffer.alloc(4)
		bogus.writeUInt32BE(CHUNK + 16 + 1, 0)
		await expect(pump(bogus, new ChunkDecryptStream(KEY, TID, CHUNK))).rejects.toThrow(
			/invalid frame length/,
		)
	})

	it('default chunk size sanity', () => {
		expect(cipherSizeFor(CHUNK_BYTES_DEFAULT)).toBe(CHUNK_BYTES_DEFAULT + FRAME_OVERHEAD)
		expect(totalChunksFor(0)).toBe(0)
		expect(cipherSizeFor(0)).toBe(0)
	})
})
