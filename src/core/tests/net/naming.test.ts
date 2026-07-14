import { describe, expect, it } from 'vitest'
import { peerPrefix } from '../../src/net/index.js'

describe('peerPrefix (remote tool namespacing)', () => {
	it('uses the plain peer name when unique in the mesh', () => {
		expect(peerPrefix('alice', 'inst-abcdef123', false)).toBe('alice')
	})

	it('disambiguates duplicate names with a short id suffix', () => {
		expect(peerPrefix('alice', 'abcdef1234567890', true)).toBe('alice~abcd')
		expect(peerPrefix('alice', 'fedcba0987654321', true)).toBe('alice~fedc')
	})

	it('two same-named peers always yield distinct prefixes', () => {
		const a = peerPrefix('vole', 'aaaa1111', true)
		const b = peerPrefix('vole', 'bbbb2222', true)
		expect(a).not.toBe(b)
	})
})
