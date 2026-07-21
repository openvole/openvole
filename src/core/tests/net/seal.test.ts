import { describe, expect, it } from 'vitest'
import {
	exportXPublic,
	generateMlKemKeyPair,
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

describe('hybrid post-quantum seal (X25519 + ML-KEM-768)', () => {
	const mlkem = generateMlKemKeyPair() // null on runtimes without ML-KEM (OpenSSL < 3.5)
	const bob = generateXKeyPair()
	const bobXPub = exportXPublic(bob.publicKey)
	const bobKemPub = mlkem
		? Buffer.from(mlkem.publicKey.export({ type: 'spki', format: 'der' })).toString('base64')
		: undefined
	const AAD = 'alice-id|bob-id'

	it.skipIf(!mlkem)('produces a hybrid box (carries a KEM ciphertext) and round-trips', () => {
		const box = seal(bobXPub, Buffer.from('post-quantum secret'), AAD, bobKemPub)!
		expect(box.kem).toBeTruthy() // the ML-KEM half is present
		const plain = unseal(bob.privateKey, box, AAD, mlkem!.privateKey)
		expect(plain?.toString('utf8')).toBe('post-quantum secret')
	})

	it.skipIf(!mlkem)(
		'X25519-only boxes still unseal for a peer that HAS an ML-KEM key (interop)',
		() => {
			const legacy = seal(bobXPub, Buffer.from('from an older peer'), AAD)! // no kem
			expect(legacy.kem).toBeUndefined()
			expect(unseal(bob.privateKey, legacy, AAD, mlkem!.privateKey)?.toString('utf8')).toBe(
				'from an older peer',
			)
		},
	)

	it.skipIf(!mlkem)('a hybrid box will not open without the ML-KEM private key', () => {
		const box = seal(bobXPub, Buffer.from('needs the pq key'), AAD, bobKemPub)!
		expect(unseal(bob.privateKey, box, AAD)).toBeNull() // no mlkem key supplied
	})

	it.skipIf(!mlkem)(
		'resists downgrade: stripping the KEM ciphertext fails the tag, never weakens',
		() => {
			const box = seal(bobXPub, Buffer.from('do not downgrade me'), AAD, bobKemPub)!
			const stripped = { epk: box.epk, n: box.n, c: box.c } // attacker removes .kem
			expect(unseal(bob.privateKey, stripped, AAD, mlkem!.privateKey)).toBeNull()
		},
	)

	it.skipIf(!mlkem)('rejects tampering on a hybrid box', () => {
		const box = seal(bobXPub, Buffer.from('untampered'), AAD, bobKemPub)!
		const flipped = Buffer.from(box.c, 'base64')
		flipped[0] ^= 0xff
		expect(
			unseal(bob.privateKey, { ...box, c: flipped.toString('base64') }, AAD, mlkem!.privateKey),
		).toBeNull()
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
