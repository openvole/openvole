/**
 * VoleDrop data-plane crypto — chunked authenticated encryption for file transfer.
 *
 * The transfer KEY travels in the control plane: 32 random bytes, sealed once per
 * transfer with the PQ-hybrid seal (seal.ts) under aad `${from}|${to}|file:${transferId}`.
 * This module owns the BULK bytes: the file is split into fixed-size plaintext chunks,
 * each encrypted with chacha20-poly1305 and framed as `[4B BE length][ciphertext ‖ 16B tag]`.
 *
 * Nonce/AAD safety argument: the key is unique per transfer and never reused, so the
 * deterministic counter nonce (4 zero bytes ‖ BE64 chunk index) cannot collide. The AAD
 * `${transferId}|${chunkIndex}` binds every frame to its transfer AND position — frames
 * cannot be reordered, dropped, duplicated, or transplanted across transfers without
 * failing the tag. Determinism also means re-encrypting from a chunk boundary produces
 * byte-identical frames, which is what makes `?from=<chunk>` resume sound.
 */
import * as crypto from 'node:crypto'
import { Transform } from 'node:stream'

export const CHUNK_BYTES_DEFAULT = 4 * 1024 * 1024
export const TAG_BYTES = 16
export const LEN_BYTES = 4
/** Per-chunk wire overhead: length prefix + poly1305 tag. */
export const FRAME_OVERHEAD = LEN_BYTES + TAG_BYTES

export function chunkNonce(index: number): Buffer {
	const nonce = Buffer.alloc(12)
	nonce.writeBigUInt64BE(BigInt(index), 4)
	return nonce
}

export function chunkAad(transferId: string, index: number): Buffer {
	return Buffer.from(`${transferId}|${index}`, 'utf8')
}

/** Total ciphertext size on the wire for a plaintext of `plainSize` bytes. */
export function cipherSizeFor(plainSize: number, chunkBytes = CHUNK_BYTES_DEFAULT): number {
	if (plainSize <= 0) return 0
	const chunks = Math.ceil(plainSize / chunkBytes)
	return plainSize + chunks * FRAME_OVERHEAD
}

export function totalChunksFor(plainSize: number, chunkBytes = CHUNK_BYTES_DEFAULT): number {
	if (plainSize <= 0) return 0
	return Math.ceil(plainSize / chunkBytes)
}

/** Encrypt one chunk → a complete wire frame `[4B BE len][ct ‖ tag]`. */
export function encryptChunk(
	key: Buffer,
	transferId: string,
	index: number,
	plain: Buffer,
): Buffer {
	const cipher = crypto.createCipheriv('chacha20-poly1305', key, chunkNonce(index), {
		authTagLength: TAG_BYTES,
	})
	cipher.setAAD(chunkAad(transferId, index))
	const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()])
	const frame = Buffer.alloc(LEN_BYTES + ct.length)
	frame.writeUInt32BE(ct.length, 0)
	ct.copy(frame, LEN_BYTES)
	return frame
}

/** Decrypt one frame BODY (ct ‖ tag, without the length prefix). Returns null on any failure. */
export function decryptChunk(
	key: Buffer,
	transferId: string,
	index: number,
	body: Buffer,
): Buffer | null {
	if (body.length < TAG_BYTES) return null
	try {
		const decipher = crypto.createDecipheriv('chacha20-poly1305', key, chunkNonce(index), {
			authTagLength: TAG_BYTES,
		})
		decipher.setAAD(chunkAad(transferId, index))
		decipher.setAuthTag(body.subarray(body.length - TAG_BYTES))
		return Buffer.concat([
			decipher.update(body.subarray(0, body.length - TAG_BYTES)),
			decipher.final(),
		])
	} catch {
		return null
	}
}

/**
 * Plaintext in → wire frames out. `startChunk` sets the first chunk index (resume:
 * the caller seeks the source to `startChunk * chunkBytes` and encryption restarts
 * deterministically from there).
 */
export class ChunkEncryptStream extends Transform {
	private buf: Buffer[] = []
	private buffered = 0
	private index: number
	chunksEmitted = 0

	constructor(
		private key: Buffer,
		private transferId: string,
		private chunkBytes = CHUNK_BYTES_DEFAULT,
		startChunk = 0,
	) {
		super()
		this.index = startChunk
	}

	private emitChunk(plain: Buffer) {
		this.push(encryptChunk(this.key, this.transferId, this.index, plain))
		this.index += 1
		this.chunksEmitted += 1
	}

	override _transform(data: Buffer, _enc: string, cb: (err?: Error | null) => void) {
		this.buf.push(data)
		this.buffered += data.length
		while (this.buffered >= this.chunkBytes) {
			const whole = Buffer.concat(this.buf)
			this.emitChunk(whole.subarray(0, this.chunkBytes))
			const rest = whole.subarray(this.chunkBytes)
			this.buf = rest.length ? [rest] : []
			this.buffered = rest.length
		}
		cb()
	}

	override _flush(cb: (err?: Error | null) => void) {
		if (this.buffered > 0) this.emitChunk(Buffer.concat(this.buf))
		this.buf = []
		this.buffered = 0
		cb()
	}
}

/**
 * Wire frames in → plaintext out. Strict framing: rejects frames larger than
 * `chunkBytes + TAG_BYTES`, fails on any tag mismatch, and errors on trailing
 * garbage at end of stream. `chunksDone` counts fully decrypted chunks — the
 * receiver's resume cursor.
 */
export class ChunkDecryptStream extends Transform {
	private buf: Buffer[] = []
	private buffered = 0
	private index: number
	chunksDone = 0

	constructor(
		private key: Buffer,
		private transferId: string,
		private chunkBytes = CHUNK_BYTES_DEFAULT,
		startChunk = 0,
	) {
		super()
		this.index = startChunk
	}

	override _transform(data: Buffer, _enc: string, cb: (err?: Error | null) => void) {
		this.buf.push(data)
		this.buffered += data.length
		while (true) {
			if (this.buffered < LEN_BYTES) break
			const whole = this.buf.length === 1 ? this.buf[0] : Buffer.concat(this.buf)
			this.buf = [whole]
			const bodyLen = whole.readUInt32BE(0)
			if (bodyLen < TAG_BYTES || bodyLen > this.chunkBytes + TAG_BYTES) {
				cb(new Error(`file-crypto: invalid frame length ${bodyLen}`))
				return
			}
			if (this.buffered < LEN_BYTES + bodyLen) break
			const body = whole.subarray(LEN_BYTES, LEN_BYTES + bodyLen)
			const plain = decryptChunk(this.key, this.transferId, this.index, body)
			if (plain === null) {
				cb(new Error(`file-crypto: chunk ${this.index} failed authentication`))
				return
			}
			this.push(plain)
			this.index += 1
			this.chunksDone += 1
			const rest = whole.subarray(LEN_BYTES + bodyLen)
			this.buf = rest.length ? [rest] : []
			this.buffered = rest.length
		}
		cb()
	}

	override _flush(cb: (err?: Error | null) => void) {
		if (this.buffered > 0) {
			cb(new Error(`file-crypto: ${this.buffered} trailing bytes after final frame`))
			return
		}
		cb()
	}
}

/**
 * Byte offset of chunk `fromChunk` inside a stored ciphertext file (hub resume) —
 * walks the length prefixes; no index file needed.
 */
export async function scanFrameOffset(
	filePath: string,
	fromChunk: number,
	chunkBytes = CHUNK_BYTES_DEFAULT,
): Promise<number> {
	if (fromChunk <= 0) return 0
	const fs = await import('node:fs/promises')
	const fd = await fs.open(filePath, 'r')
	try {
		const len = Buffer.alloc(LEN_BYTES)
		let offset = 0
		for (let i = 0; i < fromChunk; i++) {
			const { bytesRead } = await fd.read(len, 0, LEN_BYTES, offset)
			if (bytesRead < LEN_BYTES) throw new Error(`file-crypto: blob ends before chunk ${fromChunk}`)
			const bodyLen = len.readUInt32BE(0)
			if (bodyLen < TAG_BYTES || bodyLen > chunkBytes + TAG_BYTES) {
				throw new Error(`file-crypto: invalid stored frame length ${bodyLen}`)
			}
			offset += LEN_BYTES + bodyLen
		}
		return offset
	} finally {
		await fd.close()
	}
}
