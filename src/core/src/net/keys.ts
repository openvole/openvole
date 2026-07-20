/**
 * VoleNet Ed25519 key management.
 * Each vole instance has a keypair for identity and message signing.
 *
 * Key format: "vole-ed25519 <base64-ed25519-public-key> <instance-name> [base64-ml-dsa-public-key]"
 *   The 4th field (ML-DSA public key) is present when post-quantum support is available
 *   — the identity is then a hybrid Ed25519 + ML-DSA keypair.
 * Storage: .openvole/net/vole_key (private), vole_key.pub (public), vole_key.pq (ML-DSA private)
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
	/** X25519 key-agreement keys for sealed (end-to-end encrypted) envelopes. */
	xPublicKey?: crypto.KeyObject
	xPrivateKey?: crypto.KeyObject
	/** Base64 SPKI of xPublicKey — announced to peers via discovery. */
	xPublicKeyB64?: string
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

	// X25519 key-agreement pair for sealed envelopes (relay E2E). Separate from the signing
	// identity on purpose: signing keys sign, agreement keys agree.
	const x = crypto.generateKeyPairSync('x25519')
	await fs.writeFile(
		path.join(netDir, 'vole_key.x25519'),
		x.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
		{ mode: 0o600 },
	)
	const xPublicKeyB64 = Buffer.from(x.publicKey.export({ type: 'spki', format: 'der' })).toString(
		'base64',
	)
	await fs.writeFile(path.join(netDir, 'vole_key.x25519.pub'), `${xPublicKeyB64}\n`, 'utf-8')

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
		xPublicKey: x.publicKey,
		xPrivateKey: x.privateKey,
		xPublicKeyB64,
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
					await fs.writeFile(
						path.join(netDir, 'vole_key.pub'),
						finalPublicKeyString + '\n',
						'utf-8',
					)
					logger.info('Upgraded keypair with a post-quantum (ML-DSA) key')
				}
			}
		}

		// X25519 agreement key — load, or auto-upgrade older keypairs by generating one.
		let xPrivateKey: crypto.KeyObject | undefined
		let xPublicKey: crypto.KeyObject | undefined
		try {
			const xPem = await fs.readFile(path.join(netDir, 'vole_key.x25519'), 'utf-8')
			xPrivateKey = crypto.createPrivateKey(xPem)
			xPublicKey = crypto.createPublicKey(xPrivateKey)
		} catch {
			const x = crypto.generateKeyPairSync('x25519')
			xPrivateKey = x.privateKey
			xPublicKey = x.publicKey
			await fs.writeFile(
				path.join(netDir, 'vole_key.x25519'),
				x.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
				{ mode: 0o600 },
			)
			logger.info('Upgraded keypair with an X25519 (sealed envelope) key')
		}
		const xPublicKeyB64 = Buffer.from(xPublicKey.export({ type: 'spki', format: 'der' })).toString(
			'base64',
		)
		await fs.writeFile(path.join(netDir, 'vole_key.x25519.pub'), `${xPublicKeyB64}\n`, 'utf-8')

		return {
			publicKey,
			privateKey,
			publicKeyString: finalPublicKeyString,
			instanceId,
			pqPublicKey,
			pqPrivateKey,
			xPublicKey,
			xPrivateKey,
			xPublicKeyB64,
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
export async function trustPeer(
	netDir: string,
	publicKeyString: string,
	opts?: { allowUpgrade?: boolean },
): Promise<string> {
	const parsed = parsePublicKey(publicKeyString)
	if (!parsed) throw new Error('Invalid public key format. Expected: vole-ed25519 <base64> <name>')

	const authorizedPath = path.join(netDir, 'authorized_voles')

	// Check if already trusted
	const existing = await loadAuthorizedVoles(netDir)
	const current = existing.get(parsed.instanceId)
	if (current) {
		// Same identity (Ed25519) already trusted. Auto-upgrade an Ed25519-only entry to hybrid
		// when it gains a post-quantum key. Disabled (add-only) for untrusted self-join paths,
		// so a guest can never overwrite another peer's PQ key.
		const allowUpgrade = opts?.allowUpgrade !== false
		if (allowUpgrade && !current.pqPublicKey && parsed.pqPublicKey) {
			await replaceAuthorizedLine(netDir, parsed.instanceId, publicKeyString.trim())
			logger.info(
				`Upgraded peer to hybrid PQ: ${parsed.name} (${parsed.instanceId.substring(0, 8)})`,
			)
		}
		return parsed.instanceId
	}

	// Append
	await fs.appendFile(authorizedPath, publicKeyString.trim() + '\n', 'utf-8')
	logger.info(`Trusted peer: ${parsed.name} (${parsed.instanceId.substring(0, 8)})`)

	return parsed.instanceId
}

/** Replace the authorized_voles line for an instance ID with a new key string (in place). */
async function replaceAuthorizedLine(
	netDir: string,
	instanceId: string,
	newLine: string,
): Promise<void> {
	const authorizedPath = path.join(netDir, 'authorized_voles')
	const content = await fs.readFile(authorizedPath, 'utf-8').catch(() => '')
	let replaced = false
	const out = content.split('\n').map((line) => {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) return line
		const parsed = parsePublicKey(trimmed)
		if (parsed && parsed.instanceId === instanceId) {
			replaced = true
			return newLine
		}
		return line
	})
	if (!replaced) out.push(newLine)
	await fs.writeFile(authorizedPath, out.join('\n'), 'utf-8')
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
 * Relay consent store: peers whose relayed (hub-forwarded) chat this vole accepts. Distinct from
 * authorized_voles — accepting relay contact from a peer does NOT grant it direct-connect trust
 * (memory sync, tool sharing). Same on-disk line format so keys stay pinned to identities.
 * Storage: .openvole/net/relay_accepts
 */
export async function loadRelayAccepts(
	netDir: string,
): Promise<
	Map<string, { publicKey: crypto.KeyObject; name: string; pqPublicKey?: crypto.KeyObject }>
> {
	const acceptsPath = path.join(netDir, 'relay_accepts')
	const accepts = new Map<
		string,
		{ publicKey: crypto.KeyObject; name: string; pqPublicKey?: crypto.KeyObject }
	>()
	try {
		const content = await fs.readFile(acceptsPath, 'utf-8')
		for (const line of content.split('\n')) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith('#')) continue
			const parsed = parsePublicKey(trimmed)
			if (parsed) {
				accepts.set(parsed.instanceId, {
					publicKey: parsed.publicKey,
					name: parsed.name,
					pqPublicKey: parsed.pqPublicKey,
				})
			}
		}
	} catch {
		// No relay_accepts file — nothing accepted yet
	}
	return accepts
}

/** Record consent to receive relayed contact from a peer (append its pinned key line). */
export async function addRelayAccept(netDir: string, publicKeyString: string): Promise<string> {
	const parsed = parsePublicKey(publicKeyString)
	if (!parsed) throw new Error('Invalid public key format. Expected: vole-ed25519 <base64> <name>')
	const acceptsPath = path.join(netDir, 'relay_accepts')
	const existing = await loadRelayAccepts(netDir)
	if (existing.has(parsed.instanceId)) return parsed.instanceId
	await fs.appendFile(acceptsPath, publicKeyString.trim() + '\n', 'utf-8')
	logger.info(`Accepted relay contact: ${parsed.name} (${parsed.instanceId.substring(0, 8)})`)
	return parsed.instanceId
}

/** Withdraw relay consent for a peer (remove its line from relay_accepts). */
export async function removeRelayAccept(netDir: string, instanceIdOrKey: string): Promise<boolean> {
	const acceptsPath = path.join(netDir, 'relay_accepts')
	try {
		const content = await fs.readFile(acceptsPath, 'utf-8')
		const lines = content.split('\n')
		const filtered = lines.filter((line) => {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith('#')) return true
			const parsed = parsePublicKey(trimmed)
			if (!parsed) return true
			return parsed.instanceId !== instanceIdOrKey && !trimmed.includes(instanceIdOrKey)
		})
		if (filtered.length === lines.length) return false
		await fs.writeFile(acceptsPath, filtered.join('\n'), 'utf-8')
		logger.info(`Withdrew relay consent: ${instanceIdOrKey.substring(0, 8)}`)
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
