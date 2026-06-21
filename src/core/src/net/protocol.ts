/**
 * VoleNet Protocol — message types, serialization, validation.
 * All messages are signed with Ed25519 for integrity and authenticity.
 */

import * as crypto from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { sign, verify } from './keys.js'

export const VOLENET_VERSION = 1
export const MAX_MESSAGE_AGE_MS = 60_000 // reject messages older than 60s

/**
 * The local node's post-quantum (ML-DSA) signing key, set once at VoleNet start.
 * Module-level because there is exactly one signing identity per process — this lets
 * createMessage dual-sign without threading the key through every call site.
 */
let activePqSigningKey: KeyObject | undefined
export function setPqSigningKey(key: KeyObject | undefined): void {
	activePqSigningKey = key
}

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
	| 'chat:message'

export interface VoleNetMessage {
	version: number
	id: string
	type: VoleNetMessageType
	from: string // sender instance ID
	to: string | '*' // target instance or broadcast
	timestamp: number
	signature: string // Ed25519 signature of payload
	sigPq?: string // optional ML-DSA-65 (post-quantum) signature of the same canonical data
	payload: unknown
}

export interface VoleNetInstance {
	id: string
	name: string
	publicKey: string // base64 public key
	endpoint: string // https://host:port
	capabilities: string[] // ["brain:ollama", "paw-browser", "paw-database"]
	role: 'coordinator' | 'worker' | 'peer'
	load: number // 0-1 current task load
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

	// Sign the canonical payload representation (Ed25519, plus ML-DSA when available — hybrid).
	const dataToSign = canonicalize(type, from, to, timestamp, payload)
	const signature = sign(privateKey, dataToSign)
	const sigPq = activePqSigningKey ? sign(activePqSigningKey, dataToSign) : undefined

	return {
		version: VOLENET_VERSION,
		id,
		type,
		from,
		to,
		timestamp,
		signature,
		...(sigPq ? { sigPq } : {}),
		payload,
	}
}

/**
 * Verify a received message's signature and freshness.
 */
export function verifyMessage(
	message: VoleNetMessage,
	publicKey: KeyObject,
	pqPublicKey?: KeyObject,
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

	// Hybrid post-quantum: if we know the peer's ML-DSA key, the PQ signature is required
	// and must verify (downgrade-resistant). Legacy peers (no PQ key) stay Ed25519-only.
	if (pqPublicKey) {
		if (!message.sigPq) {
			return { valid: false, error: 'Missing post-quantum signature' }
		}
		if (!verify(pqPublicKey, dataToSign, message.sigPq)) {
			return { valid: false, error: 'Invalid post-quantum signature' }
		}
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
	const payloadStr =
		payload !== undefined && payload !== null
			? JSON.stringify(payload, Object.keys(payload as object).sort())
			: ''
	return `${VOLENET_VERSION}:${type}:${from}:${to}:${timestamp}:${payloadStr}`
}
