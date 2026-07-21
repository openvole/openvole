/**
 * Sealed envelopes — end-to-end encryption for VoleNet messages (relay and, opt-in, direct).
 *
 * Hybrid KEM: every seal mixes an X25519 ECDH shared secret with an ML-KEM-768 (post-quantum)
 * shared secret — HKDF-SHA256 over the concatenation — so confidentiality holds unless BOTH the
 * classical and the post-quantum KEM are broken. This closes the harvest-now-decrypt-later gap:
 * an adversary recording ciphertext today cannot read it with a future quantum computer. The
 * X25519 half uses a fresh ephemeral key per envelope (random nonces, no cross-envelope leakage);
 * the ML-KEM half encapsulates to the recipient's static PQ key. The AAD binds the envelope to
 * its routing (`from|to`), so a relay cannot re-address a ciphertext without breaking the tag.
 *
 * Backward-compatible: when the recipient announces no ML-KEM key (an older peer) or the runtime
 * lacks ML-KEM, the seal falls back to X25519-only (the `v1` scheme, byte-identical to before).
 * The scheme is bound into the KDF, so stripping the KEM ciphertext from a hybrid box yields the
 * wrong key and fails the tag — a downgrade cannot silently weaken an envelope, only drop it.
 *
 * The plaintext is a full, signed VoleNet message: sealing wraps the existing protocol, it does
 * not replace any of its checks — the recipient still verifies the inner signature, freshness,
 * and sender identity after unsealing.
 */

import * as crypto from 'node:crypto'

export interface SealedBox {
	/** Ephemeral X25519 public key, base64 SPKI DER. */
	epk: string
	/** ML-KEM-768 ciphertext, base64 — present only for hybrid (post-quantum) envelopes. */
	kem?: string
	/** ChaCha20-Poly1305 nonce, base64 (12 bytes). */
	n: string
	/** Ciphertext ‖ auth tag, base64. */
	c: string
}

const SCHEME_X25519 = 'volenet-seal-v1' // X25519-only (legacy / fallback)
const SCHEME_HYBRID = 'volenet-seal-v2' // X25519 + ML-KEM-768
const NONCE_BYTES = 12
const TAG_BYTES = 16

export function generateXKeyPair(): { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject } {
	return crypto.generateKeyPairSync('x25519')
}

/** Generate an ML-KEM-768 keypair if the runtime supports it (OpenSSL 3.5+ / Node 24+), else null. */
export function generateMlKemKeyPair(): crypto.KeyPairKeyObjectResult | null {
	try {
		// 'ml-kem-768' needs OpenSSL 3.5+; cast since older @types/node lack the literal.
		return crypto.generateKeyPairSync('ml-kem-768' as 'x25519')
	} catch {
		return null
	}
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

export function parseMlKemPublic(b64: string): crypto.KeyObject | undefined {
	try {
		return crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' })
	} catch {
		return undefined
	}
}

function deriveKey(ikm: Buffer, scheme: string, aad: string): Buffer {
	return Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), `${scheme}|${aad}`, 32))
}

/**
 * Seal plaintext to a recipient. When `recipientMlkemPubB64` is supplied (and ML-KEM is available),
 * produces a post-quantum hybrid envelope; otherwise an X25519-only one. Returns null on a bad key.
 */
export function seal(
	recipientXPubB64: string,
	plaintext: Buffer,
	aad: string,
	recipientMlkemPubB64?: string,
): SealedBox | null {
	const recipient = parseXPublic(recipientXPubB64)
	if (!recipient) return null
	const eph = crypto.generateKeyPairSync('x25519')
	const ssX = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipient })

	let ikm = ssX
	let scheme = SCHEME_X25519
	let kem: string | undefined
	if (recipientMlkemPubB64) {
		const mlkemPub = parseMlKemPublic(recipientMlkemPubB64)
		if (mlkemPub) {
			try {
				const { sharedKey, ciphertext } = crypto.encapsulate(mlkemPub)
				ikm = Buffer.concat([ssX, Buffer.from(sharedKey)])
				scheme = SCHEME_HYBRID
				kem = Buffer.from(ciphertext).toString('base64')
			} catch {
				// ML-KEM unavailable at runtime — fall back to X25519-only.
			}
		}
	}

	const key = deriveKey(ikm, scheme, aad)
	const nonce = crypto.randomBytes(NONCE_BYTES)
	const cipher = crypto.createCipheriv('chacha20-poly1305', key, nonce, {
		authTagLength: TAG_BYTES,
	})
	cipher.setAAD(Buffer.from(aad, 'utf8'))
	const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
	return {
		epk: exportXPublic(eph.publicKey),
		...(kem ? { kem } : {}),
		n: nonce.toString('base64'),
		c: ct.toString('base64'),
	}
}

/**
 * Unseal with our X25519 private key (and ML-KEM private key for hybrid envelopes). The scheme is
 * chosen by whether the box carries a KEM ciphertext, so a stripped-KEM downgrade fails the tag
 * rather than decrypting under a weaker key. Returns null on any tampering or mismatch.
 */
export function unseal(
	xPrivateKey: crypto.KeyObject,
	box: SealedBox,
	aad: string,
	mlkemPrivateKey?: crypto.KeyObject,
): Buffer | null {
	try {
		const epk = parseXPublic(box.epk)
		if (!epk) return null
		const ssX = crypto.diffieHellman({ privateKey: xPrivateKey, publicKey: epk })

		let ikm = ssX
		let scheme = SCHEME_X25519
		if (box.kem) {
			if (!mlkemPrivateKey) return null // hybrid envelope but we hold no ML-KEM key
			const ssPq = crypto.decapsulate(mlkemPrivateKey, Buffer.from(box.kem, 'base64'))
			ikm = Buffer.concat([ssX, Buffer.from(ssPq)])
			scheme = SCHEME_HYBRID
		}

		const key = deriveKey(ikm, scheme, aad)
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
