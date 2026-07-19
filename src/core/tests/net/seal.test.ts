import { describe, expect, it } from 'vitest'
import {
	exportXPublic,
	generateXKeyPair,
	relayPairAllow,
	seal,
	unseal,
} from '../../src/net/seal.js'

describe('sealed envelopes (X25519 ECIES + ChaCha20-Poly1305)', () => {
	const bob = generateXKeyPair()
	const bobPub = exportXPublic(bob.publicKey)
	const AAD = 'alice-id|bob-id'

	it('round-trips plaintext', () => {
		const box = seal(bobPub, Buffer.from('the club meets at nine'), AAD)
		expect(box).toBeTruthy()
		const plain = unseal(bob.privateKey, box!, AAD)
		expect(plain?.toString('utf8')).toBe('the club meets at nine')
	})

	it('every seal uses a fresh ephemeral key and nonce', () => {
		const a = seal(bobPub, Buffer.from('same message'), AAD)!
		const b = seal(bobPub, Buffer.from('same message'), AAD)!
		expect(a.epk).not.toBe(b.epk)
		expect(a.n).not.toBe(b.n)
		expect(a.c).not.toBe(b.c)
	})

	it('rejects ciphertext tampering', () => {
		const box = seal(bobPub, Buffer.from('untampered'), AAD)!
		const flipped = Buffer.from(box.c, 'base64')
		flipped[0] ^= 0xff
		expect(unseal(bob.privateKey, { ...box, c: flipped.toString('base64') }, AAD)).toBeNull()
	})

	it('rejects a swapped ephemeral key', () => {
		const box = seal(bobPub, Buffer.from('secret'), AAD)!
		const other = seal(bobPub, Buffer.from('other'), AAD)!
		expect(unseal(bob.privateKey, { ...box, epk: other.epk }, AAD)).toBeNull()
	})

	it('rejects the wrong recipient key', () => {
		const eve = generateXKeyPair()
		const box = seal(bobPub, Buffer.from('for bob only'), AAD)!
		expect(unseal(eve.privateKey, box, AAD)).toBeNull()
	})

	it('rejects an AAD mismatch — a relay cannot re-address an envelope', () => {
		const box = seal(bobPub, Buffer.from('bound to routing'), AAD)!
		expect(unseal(bob.privateKey, box, 'alice-id|carol-id')).toBeNull()
	})

	it('rejects garbage keys and truncated boxes without throwing', () => {
		expect(seal('not-a-key', Buffer.from('x'), AAD)).toBeNull()
		const box = seal(bobPub, Buffer.from('x'), AAD)!
		expect(unseal(bob.privateKey, { ...box, c: 'AAAA' }, AAD)).toBeNull()
		expect(unseal(bob.privateKey, { ...box, n: 'AAAA' }, AAD)).toBeNull()
	})
})

describe('relayPairAllow', () => {
	it('limits per pair, not globally', () => {
		const w = new Map<string, number[]>()
		for (let i = 0; i < 3; i++) expect(relayPairAllow(w, 'a', 'b', 3)).toBe(true)
		expect(relayPairAllow(w, 'a', 'b', 3)).toBe(false)
		expect(relayPairAllow(w, 'a', 'c', 3)).toBe(true) // different pair unaffected
		expect(relayPairAllow(w, 'b', 'a', 3)).toBe(true) // direction matters
	})
})
