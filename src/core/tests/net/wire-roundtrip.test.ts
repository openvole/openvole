import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createMessage, deserialize, serialize, verifyMessage } from '../../src/net/protocol.js'

describe('wire round-trip verification', () => {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519')

	it('clean payload survives serialize→deserialize→verify', () => {
		const m = createMessage(
			'roster',
			'aaaa',
			'bbbb',
			{ members: [{ id: 'x', connected: true }] },
			privateKey,
		)
		const rt = deserialize(serialize(m))!
		expect(verifyMessage(rt, publicKey).valid).toBe(true)
	})

	it('payload with an undefined-valued property — the suspected canonicalization trap', () => {
		const m = createMessage(
			'roster',
			'aaaa',
			'bbbb',
			{ members: [{ id: 'x', xPublicKey: undefined, connected: true }] },
			privateKey,
		)
		const rt = deserialize(serialize(m))!
		const res = verifyMessage(rt, publicKey)
		expect(res.valid).toBe(true) // fails if canonicalJson signs undefined as null
	})
})
