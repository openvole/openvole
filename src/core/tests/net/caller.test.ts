import { describe, expect, it } from 'vitest'
import { withVerifiedCaller } from '../../src/net/index.js'

describe('withVerifiedCaller', () => {
	it('attaches the verified caller to object params', () => {
		const out = withVerifiedCaller({ text: 'hi' }, 'inst-123', 'alice')
		expect(out.text).toBe('hi')
		expect(out.__caller).toEqual({ instanceId: 'inst-123', name: 'alice' })
	})

	it('overwrites a spoofed __caller from the wire', () => {
		const out = withVerifiedCaller(
			{ text: 'hi', __caller: { instanceId: 'victim', name: 'queen' } },
			'attacker-instance',
			'mallory',
		)
		expect(out.__caller).toEqual({ instanceId: 'attacker-instance', name: 'mallory' })
	})

	it('falls back to a short id when the peer has no known name', () => {
		const out = withVerifiedCaller({}, 'abcdef1234567890')
		expect((out.__caller as { name: string }).name).toBe('abcdef12')
	})

	it('tolerates non-object params', () => {
		const out = withVerifiedCaller('raw', 'inst-1', 'bob')
		expect(out.__caller).toEqual({ instanceId: 'inst-1', name: 'bob' })
	})
})
