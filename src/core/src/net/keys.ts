/**
 * VoleNet Ed25519 key management.
 * Each vole instance has a keypair for identity and message signing.
 *
 * Key format: "vole-ed25519 <base64-public-key> <instance-name>"
 * Storage: .openvole/net/vole_key (private), vole_key.pub (public)
 *          .openvole/net/authorized_voles (trusted peer public keys)
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createLogger } from '../core/logger.js'

const logger = createLogger('volenet-keys')

export interface VoleKeyPair {
	publicKey: crypto.KeyObject
	privateKey: crypto.KeyObject
	publicKeyString: string
	instanceId: string
	/** Post-quantum (ML-DSA-65) keys — present when the runtime supports it (OpenSSL 3.5+ / Node 24+). */
	pqPublicKey?: crypto.KeyObject
	pqPrivateKey?: crypto.KeyObject
}

/** Generate an ML-DSA-65 keypair if the runtime supports it, else null. */
function generateMlDsa(): crypto.KeyPairKeyObjectResult | null {
	try {
		// 'ml-dsa-65' needs OpenSSL 3.5+; cast since older @types/node lack the literal.
		return crypto.generateKeyPairSync('ml-dsa-65' as 'ed25519')
	} catch {
		return null
	}
}

/** Parse an ML-DSA-65 SPKI public key from base64, or null if unsupported/invalid. */
function parseMlDsaPublic(b64: string): crypto.KeyObject | undefined {
	try {
		return crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' })
	} catch {
		return undefined
	}
}

/**
 * Generate a new Ed25519 keypair.
 * Saves to .openvole/net/vole_key and vole_key.pub
 */
export async function generateKeyPair(netDir: string, instanceName: string): Promise<VoleKeyPair> {
	await fs.mkdir(netDir, { recursive: true })

	const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')

	// Export keys
	const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
	const publicRaw = publicKey.export({ type: 'spki', format: 'der' })
	const publicB64 = Buffer.from(publicRaw).toString('base64')
	// Post-quantum (ML-DSA-65) keypair — best effort; appended to the key string as a 4th token.
	const pq = generateMlDsa()
	let pqB64 = ''
	if (pq) {
		pqB64 = Buffer.from(pq.publicKey.export({ type: 'spki', format: 'der' })).toString('base64')
		await fs.writeFile(
			path.join(netDir, 'vole_key.pq'),
			pq.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
			{ mode: 0o600 },
		)
	}
	const publicKeyString = pq
		? `vole-ed25519 ${publicB64} ${instanceName} ${pqB64}`
		: `vole-ed25519 ${publicB64} ${instanceName}`

	// Save private key (owner-only permissions)
	const privateKeyPath = path.join(netDir, 'vole_key')
	await fs.writeFile(privateKeyPath, privatePem, { mode: 0o600 })

	// Save public key
	const publicKeyPath = path.join(netDir, 'vole_key.pub')
	await fs.writeFile(publicKeyPath, publicKeyString + '\n', 'utf-8')

	// Create authorized_voles if it doesn't exist
	const authorizedPath = path.join(netDir, 'authorized_voles')
	try {
		await fs.access(authorizedPath)
	} catch {
		await fs.writeFile(authorizedPath, '', 'utf-8')
	}

	const instanceId = deriveInstanceId(publicB64)
	logger.info(
		`Generated keypair — instance ID: ${instanceId}${pq ? ' (hybrid Ed25519 + ML-DSA)' : ' (Ed25519)'}`,
	)

	return {
		publicKey,
		privateKey,
		publicKeyString,
		instanceId,
		pqPublicKey: pq?.publicKey,
		pqPrivateKey: pq?.privateKey,
	}
}

/**
 * Load existing keypair from disk.
 */
export async function loadKeyPair(netDir: string): Promise<VoleKeyPair | null> {
	const privateKeyPath = path.join(netDir, 'vole_key')
	const publicKeyPath = path.join(netDir, 'vole_key.pub')

	try {
		const privatePem = await fs.readFile(privateKeyPath, 'utf-8')
		const publicKeyString = (await fs.readFile(publicKeyPath, 'utf-8')).trim()

		const privateKey = crypto.createPrivateKey(privatePem)
		const publicKey = crypto.createPublicKey(privateKey)

		const parts = publicKeyString.split(' ')
		if (parts[0] !== 'vole-ed25519' || parts.length < 2) {
			logger.error('Invalid public key format')
			return null
		}

		const instanceId = deriveInstanceId(parts[1])

		// Load the post-quantum key if present; auto-upgrade legacy keypairs when supported.
		let pqPrivateKey: crypto.KeyObject | undefined
		let pqPublicKey: crypto.KeyObject | undefined
		let finalPublicKeyString = publicKeyString
		try {
			const pqPem = await fs.readFile(path.join(netDir, 'vole_key.pq'), 'utf-8')
			pqPrivateKey = crypto.createPrivateKey(pqPem)
			pqPublicKey = crypto.createPublicKey(pqPrivateKey)
		} catch {
			const pq = generateMlDsa()
			if (pq) {
				pqPrivateKey = pq.privateKey
				pqPublicKey = pq.publicKey
				await fs.writeFile(
					path.join(netDir, 'vole_key.pq'),
					pq.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
					{ mode: 0o600 },
				)
				if (parts.length < 4) {
					const pqB64 = Buffer.from(pq.publicKey.export({ type: 'spki', format: 'der' })).toString(
						'base64',
					)
					finalPublicKeyString = `vole-ed25519 ${parts[1]} ${parts[2] ?? instanceId.substring(0, 8)} ${pqB64}`
					await fs.writeFile(path.join(netDir, 'vole_key.pub'), finalPublicKeyString + '\n', 'utf-8')
					logger.info('Upgraded keypair with a post-quantum (ML-DSA) key')
				}
			}
		}

		return {
			publicKey,
			privateKey,
			publicKeyString: finalPublicKeyString,
			instanceId,
			pqPublicKey,
			pqPrivateKey,
		}
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return null
		}
		logger.error(`Failed to load keypair: ${err instanceof Error ? err.message : String(err)}`)
		return null
	}
}

/**
 * Sign a message with the private key.
 * Returns base64-encoded signature.
 */
export function sign(privateKey: crypto.KeyObject, data: string): string {
	const signature = crypto.sign(null, Buffer.from(data), privateKey)
	return signature.toString('base64')
}

/**
 * Verify a signature against a public key.
 */
export function verify(publicKey: crypto.KeyObject, data: string, signature: string): boolean {
	try {
		return crypto.verify(null, Buffer.from(data), publicKey, Buffer.from(signature, 'base64'))
	} catch {
		return false
	}
}

/**
 * Parse a public key string ("vole-ed25519 <base64> <name>") into a KeyObject.
 */
export function parsePublicKey(keyString: string): {
	publicKey: crypto.KeyObject
	instanceId: string
	name: string
	pqPublicKey?: crypto.KeyObject
} | null {
	const parts = keyString.trim().split(' ')
	if (parts[0] !== 'vole-ed25519' || parts.length < 2) return null

	try {
		const der = Buffer.from(parts[1], 'base64')
		const publicKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' })
		const instanceId = deriveInstanceId(parts[1])
		const name = parts[2] ?? instanceId.substring(0, 8)
		// Optional 4th token: ML-DSA-65 public key (hybrid). Ignored on runtimes without PQ.
		const pqPublicKey = parts[3] ? parseMlDsaPublic(parts[3]) : undefined
		return { publicKey, instanceId, name, pqPublicKey }
	} catch {
		return null
	}
}

/**
 * Load trusted peer public keys from authorized_voles file.
 */
export async function loadAuthorizedVoles(netDir: string): Promise<
	Map<
		string,
		{
			publicKey: crypto.KeyObject
			name: string
			pqPublicKey?: crypto.KeyObject
		}
	>
> {
	const authorizedPath = path.join(netDir, 'authorized_voles')
	const trusted = new Map<
		string,
		{ publicKey: crypto.KeyObject; name: string; pqPublicKey?: crypto.KeyObject }
	>()

	try {
		const content = await fs.readFile(authorizedPath, 'utf-8')
		for (const line of content.split('\n')) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith('#')) continue

			const parsed = parsePublicKey(trimmed)
			if (parsed) {
				trusted.set(parsed.instanceId, {
					publicKey: parsed.publicKey,
					name: parsed.name,
					pqPublicKey: parsed.pqPublicKey,
				})
			}
		}
	} catch {
		// No authorized_voles file — empty trust list
	}

	return trusted
}

/**
 * Add a peer's public key to authorized_voles.
 */
export async function trustPeer(netDir: string, publicKeyString: string): Promise<string> {
	const parsed = parsePublicKey(publicKeyString)
	if (!parsed) throw new Error('Invalid public key format. Expected: vole-ed25519 <base64> <name>')

	const authorizedPath = path.join(netDir, 'authorized_voles')

	// Check if already trusted
	const existing = await loadAuthorizedVoles(netDir)
	if (existing.has(parsed.instanceId)) {
		return parsed.instanceId
	}

	// Append
	await fs.appendFile(authorizedPath, publicKeyString.trim() + '\n', 'utf-8')
	logger.info(`Trusted peer: ${parsed.name} (${parsed.instanceId.substring(0, 8)})`)

	return parsed.instanceId
}

/**
 * Remove a peer's public key from authorized_voles.
 */
export async function revokePeer(netDir: string, instanceIdOrKey: string): Promise<boolean> {
	const authorizedPath = path.join(netDir, 'authorized_voles')

	try {
		const content = await fs.readFile(authorizedPath, 'utf-8')
		const lines = content.split('\n')
		const filtered = lines.filter((line) => {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith('#')) return true
			const parsed = parsePublicKey(trimmed)
			if (!parsed) return true
			return parsed.instanceId !== instanceIdOrKey && !trimmed.includes(instanceIdOrKey)
		})

		if (filtered.length === lines.length) return false

		await fs.writeFile(authorizedPath, filtered.join('\n'), 'utf-8')
		logger.info(`Revoked peer: ${instanceIdOrKey.substring(0, 8)}`)
		return true
	} catch {
		return false
	}
}

/**
 * Generate a random nonce for challenge-response auth.
 */
export function generateNonce(): string {
	return crypto.randomBytes(32).toString('base64')
}

/**
 * Derive a deterministic instance ID from a public key.
 * Uses SHA-256 hash of the public key, truncated to 16 hex chars.
 */
function deriveInstanceId(publicKeyB64: string): string {
	return crypto.createHash('sha256').update(publicKeyB64).digest('hex').substring(0, 16)
}
