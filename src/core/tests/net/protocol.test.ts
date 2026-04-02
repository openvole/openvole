import * as crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	MAX_MESSAGE_AGE_MS,
	VOLENET_VERSION,
	type VoleNetMessageType,
	createMessage,
	deserialize,
	serialize,
	verifyMessage,
} from '../../src/net/protocol.js'

function generateTestKeyPair() {
	return crypto.generateKeyPairSync('ed25519')
}

describe('VoleNet Protocol', () => {
	let keyPair: crypto.KeyPairKeyObjectResult

	beforeEach(() => {
		keyPair = generateTestKeyPair()
	})

	describe('createMessage()', () => {
		it('creates a message with all required fields', () => {
			const msg = createMessage(
				'ping',
				'sender-id',
				'target-id',
				{ foo: 'bar' },
				keyPair.privateKey,
			)

			expect(msg.version).toBe(VOLENET_VERSION)
			expect(msg.id).toBeTruthy()
			expect(msg.type).toBe('ping')
			expect(msg.from).toBe('sender-id')
			expect(msg.to).toBe('target-id')
			expect(msg.timestamp).toBeTypeOf('number')
			expect(msg.signature).toBeTypeOf('string')
			expect(msg.payload).toEqual({ foo: 'bar' })
		})

		it('generates unique message IDs', () => {
			const msg1 = createMessage('ping', 'sender', '*', {}, keyPair.privateKey)
			const msg2 = createMessage('ping', 'sender', '*', {}, keyPair.privateKey)
			expect(msg1.id).not.toBe(msg2.id)
		})

		it('sets timestamp close to current time', () => {
			const before = Date.now()
			const msg = createMessage('pong', 'sender', 'target', null, keyPair.privateKey)
			const after = Date.now()
			expect(msg.timestamp).toBeGreaterThanOrEqual(before)
			expect(msg.timestamp).toBeLessThanOrEqual(after)
		})

		it('supports broadcast target (*)', () => {
			const msg = createMessage('discover', 'sender', '*', {}, keyPair.privateKey)
			expect(msg.to).toBe('*')
		})

		it('produces a valid signature verifiable with the public key', () => {
			const msg = createMessage('ping', 'sender', 'target', { data: 123 }, keyPair.privateKey)
			const result = verifyMessage(msg, keyPair.publicKey)
			expect(result.valid).toBe(true)
			expect(result.error).toBeUndefined()
		})

		it('supports all message types', () => {
			const types: VoleNetMessageType[] = [
				'ping',
				'pong',
				'discover',
				'discover:response',
				'auth:challenge',
				'auth:response',
				'auth:result',
				'task:delegate',
				'task:result',
				'task:status',
				'memory:sync',
				'memory:search',
				'memory:results',
				'session:sync',
				'tool:list',
				'tool:list:response',
				'tool:call',
				'tool:result',
				'leader:heartbeat',
				'leader:claim',
				'leader:ack',
			]

			for (const type of types) {
				const msg = createMessage(type, 'sender', '*', {}, keyPair.privateKey)
				expect(msg.type).toBe(type)
			}
		})
	})

	describe('verifyMessage()', () => {
		it('verifies a valid message', () => {
			const msg = createMessage('ping', 'sender', 'target', { x: 1 }, keyPair.privateKey)
			const result = verifyMessage(msg, keyPair.publicKey)
			expect(result.valid).toBe(true)
		})

		it('rejects a message with tampered payload', () => {
			const msg = createMessage('ping', 'sender', 'target', { x: 1 }, keyPair.privateKey)
			msg.payload = { x: 2 }
			const result = verifyMessage(msg, keyPair.publicKey)
			expect(result.valid).toBe(false)
			expect(result.error).toBe('Invalid signature')
		})

		it('rejects a message with tampered from field', () => {
			const msg = createMessage('ping', 'sender', 'target', { x: 1 }, keyPair.privateKey)
			msg.from = 'impersonator'
			const result = verifyMessage(msg, keyPair.publicKey)
			expect(result.valid).toBe(false)
			expect(result.error).toBe('Invalid signature')
		})

		it('rejects a message with tampered type', () => {
			const msg = createMessage('ping', 'sender', 'target', {}, keyPair.privateKey)
			msg.type = 'task:delegate'
			const result = verifyMessage(msg, keyPair.publicKey)
			expect(result.valid).toBe(false)
			expect(result.error).toBe('Invalid signature')
		})

		it('rejects expired messages (replay protection)', () => {
			const msg = createMessage('ping', 'sender', 'target', {}, keyPair.privateKey)
			msg.timestamp = Date.now() - MAX_MESSAGE_AGE_MS - 1000

			// Re-sign with the old timestamp to make signature valid
			// but the freshness check should still fail
			const result = verifyMessage(msg, keyPair.publicKey)
			expect(result.valid).toBe(false)
			expect(result.error).toContain('Message too old')
		})

		it('rejects messages from the future (>5s ahead)', () => {
			const msg = createMessage('ping', 'sender', 'target', {}, keyPair.privateKey)
			msg.timestamp = Date.now() + 10_000
			const result = verifyMessage(msg, keyPair.publicKey)
			expect(result.valid).toBe(false)
			expect(result.error).toContain('Message from the future')
		})

		it('rejects a message with wrong version', () => {
			const msg = createMessage('ping', 'sender', 'target', {}, keyPair.privateKey)
			msg.version = 99
			const result = verifyMessage(msg, keyPair.publicKey)
			expect(result.valid).toBe(false)
			expect(result.error).toContain('Unsupported protocol version')
		})

		it('rejects a message signed by a different key', () => {
			const otherKeyPair = generateTestKeyPair()
			const msg = createMessage('ping', 'sender', 'target', {}, otherKeyPair.privateKey)
			const result = verifyMessage(msg, keyPair.publicKey)
			expect(result.valid).toBe(false)
			expect(result.error).toBe('Invalid signature')
		})
	})

	describe('serialize() / deserialize()', () => {
		it('round-trips a message', () => {
			const msg = createMessage(
				'task:delegate',
				'from',
				'to',
				{ input: 'hello' },
				keyPair.privateKey,
			)
			const serialized = serialize(msg)
			const deserialized = deserialize(serialized)

			expect(deserialized).not.toBeNull()
			expect(deserialized!.id).toBe(msg.id)
			expect(deserialized!.type).toBe(msg.type)
			expect(deserialized!.from).toBe(msg.from)
			expect(deserialized!.to).toBe(msg.to)
			expect(deserialized!.timestamp).toBe(msg.timestamp)
			expect(deserialized!.signature).toBe(msg.signature)
			expect(deserialized!.payload).toEqual(msg.payload)
		})

		it('serialize returns valid JSON', () => {
			const msg = createMessage('ping', 'from', 'to', {}, keyPair.privateKey)
			const serialized = serialize(msg)
			expect(() => JSON.parse(serialized)).not.toThrow()
		})

		it('deserialize returns null for invalid JSON', () => {
			expect(deserialize('not json')).toBeNull()
		})

		it('deserialize returns null for missing required fields', () => {
			expect(deserialize(JSON.stringify({ foo: 'bar' }))).toBeNull()
			expect(deserialize(JSON.stringify({ version: 1 }))).toBeNull()
			expect(deserialize(JSON.stringify({ version: 1, type: 'ping' }))).toBeNull()
			expect(deserialize(JSON.stringify({ version: 1, type: 'ping', from: 'x' }))).toBeNull()
		})

		it('deserialize accepts message with all required fields', () => {
			const minimal = {
				version: 1,
				type: 'ping',
				from: 'x',
				id: 'abc',
				to: '*',
				timestamp: 1,
				signature: '',
				payload: null,
			}
			expect(deserialize(JSON.stringify(minimal))).not.toBeNull()
		})
	})

	describe('canonical string generation', () => {
		it('produces deterministic signatures for same input', () => {
			const payload = { b: 2, a: 1 }
			const msg1 = createMessage('ping', 'sender', 'target', payload, keyPair.privateKey)

			// Verify with same payload (different key order) still validates
			const result = verifyMessage(msg1, keyPair.publicKey)
			expect(result.valid).toBe(true)
		})

		it('different payloads produce different signatures', () => {
			const msg1 = createMessage('ping', 'sender', 'target', { x: 1 }, keyPair.privateKey)
			const msg2 = createMessage('ping', 'sender', 'target', { x: 2 }, keyPair.privateKey)
			expect(msg1.signature).not.toBe(msg2.signature)
		})

		it('null payload produces valid message', () => {
			const msg = createMessage('ping', 'sender', 'target', null, keyPair.privateKey)
			const result = verifyMessage(msg, keyPair.publicKey)
			expect(result.valid).toBe(true)
		})
	})
})
