import { describe, expect, it } from 'vitest'
import { notifier, preview } from '../src/notify.js'

/**
 * A notification is the only thing that can reach the person while nothing is open, so the parts
 * that decide *whether* and *what* are worth pinning down. Whether the OS actually draws it is
 * not something a test can assert, and not something worth failing a delivery over either.
 */
describe('notify', () => {
	it('can be turned off, and does nothing where there is nothing to use', () => {
		const off = process.env.VOLENET_MCP_NOTIFY
		try {
			process.env.VOLENET_MCP_NOTIFY = 'off'
			expect(notifier('darwin')('t', 'b')).toBeUndefined()
			delete process.env.VOLENET_MCP_NOTIFY
			expect(notifier('sunos' as NodeJS.Platform)('t', 'b')).toBeUndefined()
		} finally {
			if (off === undefined) delete process.env.VOLENET_MCP_NOTIFY
			else process.env.VOLENET_MCP_NOTIFY = off
		}
	})

	it('never throws, whatever the platform or the text', () => {
		const off = process.env.VOLENET_MCP_NOTIFY
		try {
			// A command that does not exist: spawning must fail quietly, not take down a delivery.
			process.env.VOLENET_MCP_NOTIFY = 'volenet-no-such-notifier-binary'
			expect(() => notifier()('a "quoted" title', 'body with \\ backslash')).not.toThrow()
		} finally {
			if (off === undefined) delete process.env.VOLENET_MCP_NOTIFY
			else process.env.VOLENET_MCP_NOTIFY = off
		}
	})

	it('flattens a message to one readable line', () => {
		expect(preview('hello\n\nthere   friend')).toBe('hello there friend')
		expect(preview('x'.repeat(200))).toHaveLength(140)
		expect(preview('x'.repeat(200)).endsWith('…')).toBe(true)
	})
})
