/**
 * VoleNet Protocol — message types, serialization, validation.
 * All messages are signed with Ed25519 for integrity and authenticity.
 */

import * as crypto from 'node:crypto'
import { sign, verify } from './keys.js'
import type { KeyObject } from 'node:crypto'

export const VOLENET_VERSION = 1
export const MAX_MESSAGE_AGE_MS = 60_000 // reject messages older than 60s

export type VoleNetMessageType =
	| 'ping'
	| 'pong'
	| 'discover'
	| 'discover:response'
	| 'auth:challenge'
	| 'auth:response'
	| 'auth:result'
	| 'task:delegate'
	| 'task:result'
	| 'task:status'
	| 'memory:sync'
	| 'memory:search'
	| 'memory:results'
	| 'session:sync'
	| 'tool:list'
	| 'tool:list:response'
	| 'tool:call'
	| 'tool:result'
	| 'leader:heartbeat'
	| 'leader:claim'
	| 'leader:ack'

export interface VoleNetMessage {
	version: number
	id: string
	type: VoleNetMessageType
	from: string              // sender instance ID
	to: string | '*'          // target instance or broadcast
	timestamp: number
	signature: string         // Ed25519 signature of payload
	payload: unknown
}

export interface VoleNetInstance {
	id: string
	name: string
	publicKey: string         // base64 public key
	endpoint: string          // https://host:port
	capabilities: string[]    // ["brain:ollama", "paw-browser", "paw-database"]
	role: 'coordinator' | 'worker' | 'peer'
	load: number              // 0-1 current task load
	maxTasks: number
	lastSeen: number
	version: string
}

export interface RemoteToolInfo {
	name: string
	description: string
	pawName: string
	instanceId: string
	instanceName: string
}

/**
 * Create a signed VoleNet message.
 */
export function createMessage(
	type: VoleNetMessageType,
	from: string,
	to: string | '*',
	payload: unknown,
	privateKey: KeyObject,
): VoleNetMessage {
	const id = crypto.randomUUID()
	const timestamp = Date.now()

	// Sign the canonical payload representation
	const dataToSign = canonicalize(type, from, to, timestamp, payload)
	const signature = sign(privateKey, dataToSign)

	return {
		version: VOLENET_VERSION,
		id,
		type,
		from,
		to,
		timestamp,
		signature,
		payload,
	}
}

/**
 * Verify a received message's signature and freshness.
 */
export function verifyMessage(
	message: VoleNetMessage,
	publicKey: KeyObject,
): { valid: boolean; error?: string } {
	// Version check
	if (message.version !== VOLENET_VERSION) {
		return { valid: false, error: `Unsupported protocol version: ${message.version}` }
	}

	// Freshness check (replay protection)
	const age = Date.now() - message.timestamp
	if (age > MAX_MESSAGE_AGE_MS) {
		return { valid: false, error: `Message too old: ${age}ms (max: ${MAX_MESSAGE_AGE_MS}ms)` }
	}
	if (age < -5000) {
		return { valid: false, error: `Message from the future: ${-age}ms ahead` }
	}

	// Signature verification
	const dataToSign = canonicalize(
		message.type,
		message.from,
		message.to,
		message.timestamp,
		message.payload,
	)
	const valid = verify(publicKey, dataToSign, message.signature)
	if (!valid) {
		return { valid: false, error: 'Invalid signature' }
	}

	return { valid: true }
}

/**
 * Serialize a message for transport.
 */
export function serialize(message: VoleNetMessage): string {
	return JSON.stringify(message)
}

/**
 * Deserialize a message from transport.
 */
export function deserialize(data: string): VoleNetMessage | null {
	try {
		const parsed = JSON.parse(data)
		if (!parsed.version || !parsed.type || !parsed.from || !parsed.id) {
			return null
		}
		return parsed as VoleNetMessage
	} catch {
		return null
	}
}

/**
 * Create canonical string for signing.
 * Deterministic representation: type + from + to + timestamp + sorted JSON payload.
 */
function canonicalize(
	type: string,
	from: string,
	to: string | '*',
	timestamp: number,
	payload: unknown,
): string {
	const payloadStr = payload !== undefined && payload !== null
		? JSON.stringify(payload, Object.keys(payload as object).sort())
		: ''
	return `${VOLENET_VERSION}:${type}:${from}:${to}:${timestamp}:${payloadStr}`
}
