/**
 * Sealed envelopes — end-to-end encryption for relayed VoleNet messages.
 *
 * ECIES over X25519: every seal generates an ephemeral X25519 keypair, derives a one-time
 * key via ECDH + HKDF-SHA256, and encrypts with ChaCha20-Poly1305. A fresh ephemeral key
 * per envelope means nonces can be random without birthday concerns, and compromise of one
 * envelope's key reveals nothing about others. The AAD binds the envelope to its routing
 * (`from|to`), so a relay cannot re-address a ciphertext without breaking the tag.
 *
 * The plaintext is a full, signed VoleNet message: sealing wraps the existing protocol,
 * it does not replace any of its checks — the recipient still verifies the inner signature,
 * freshness, and sender identity after unsealing.
 */

import * as crypto from 'node:crypto'

export interface SealedBox {
	/** Ephemeral X25519 public key, base64 SPKI DER. */
	epk: string
	/** ChaCha20-Poly1305 nonce, base64 (12 bytes). */
	n: string
	/** Ciphertext ‖ auth tag, base64. */
	c: string
}

const HKDF_INFO = 'volenet-seal-v1'
const NONCE_BYTES = 12
const TAG_BYTES = 16

export function generateXKeyPair(): { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject } {
	return crypto.generateKeyPairSync('x25519')
}

export function exportXPublic(key: crypto.KeyObject): string {
	return Buffer.from(key.export({ type: 'spki', format: 'der' })).toString('base64')
}

export function parseXPublic(b64: string): crypto.KeyObject | undefined {
	try {
		return crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' })
	} catch {
		return undefined
	}
}

function deriveKey(shared: Buffer, aad: string): Buffer {
	return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), `${HKDF_INFO}|${aad}`, 32))
}

/** Seal plaintext to a recipient's X25519 public key. Returns null on a bad key. */
export function seal(recipientXPubB64: string, plaintext: Buffer, aad: string): SealedBox | null {
	const recipient = parseXPublic(recipientXPubB64)
	if (!recipient) return null
	const eph = crypto.generateKeyPairSync('x25519')
	const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipient })
	const key = deriveKey(shared, aad)
	const nonce = crypto.randomBytes(NONCE_BYTES)
	const cipher = crypto.createCipheriv('chacha20-poly1305', key, nonce, {
		authTagLength: TAG_BYTES,
	})
	cipher.setAAD(Buffer.from(aad, 'utf8'))
	const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
	return {
		epk: exportXPublic(eph.publicKey),
		n: nonce.toString('base64'),
		c: ct.toString('base64'),
	}
}

/** Unseal with our X25519 private key. Returns null on any tampering or mismatch. */
export function unseal(xPrivateKey: crypto.KeyObject, box: SealedBox, aad: string): Buffer | null {
	try {
		const epk = parseXPublic(box.epk)
		if (!epk) return null
		const shared = crypto.diffieHellman({ privateKey: xPrivateKey, publicKey: epk })
		const key = deriveKey(shared, aad)
		const nonce = Buffer.from(box.n, 'base64')
		const ct = Buffer.from(box.c, 'base64')
		if (nonce.length !== NONCE_BYTES || ct.length <= TAG_BYTES) return null
		const decipher = crypto.createDecipheriv('chacha20-poly1305', key, nonce, {
			authTagLength: TAG_BYTES,
		})
		decipher.setAAD(Buffer.from(aad, 'utf8'))
		decipher.setAuthTag(ct.subarray(ct.length - TAG_BYTES))
		return Buffer.concat([decipher.update(ct.subarray(0, ct.length - TAG_BYTES)), decipher.final()])
	} catch {
		return null
	}
}

/** Sliding-window relay policy: at most `maxPerMinute` forwards per (from,to) pair. */
export function relayPairAllow(
	windows: Map<string, number[]>,
	from: string,
	to: string,
	maxPerMinute: number,
): boolean {
	const key = `${from}>${to}`
	const now = Date.now()
	if (windows.size > 4096) {
		for (const [k, ts] of windows)
			if (ts.length === 0 || now - ts[ts.length - 1] > 60_000) windows.delete(k)
	}
	const win = (windows.get(key) ?? []).filter((t) => now - t < 60_000)
	if (win.length >= maxPerMinute) {
		windows.set(key, win)
		return false
	}
	win.push(now)
	windows.set(key, win)
	return true
}
