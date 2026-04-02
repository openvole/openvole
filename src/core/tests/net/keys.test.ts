import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	generateKeyPair,
	generateNonce,
	loadAuthorizedVoles,
	loadKeyPair,
	parsePublicKey,
	revokePeer,
	sign,
	trustPeer,
	verify,
} from '../../src/net/keys.js'

describe('VoleNet Keys', () => {
	let tmpDir: string
	let netDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-keys-'))
		netDir = path.join(tmpDir, 'net')
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	describe('generateKeyPair()', () => {
		it('generates a valid Ed25519 keypair', async () => {
			const kp = await generateKeyPair(netDir, 'test-instance')

			expect(kp.publicKey).toBeDefined()
			expect(kp.privateKey).toBeDefined()
			expect(kp.publicKeyString).toBeTruthy()
			expect(kp.instanceId).toBeTruthy()
		})

		it('saves private key file with correct permissions', async () => {
			await generateKeyPair(netDir, 'test-instance')
			const privateKeyPath = path.join(netDir, 'vole_key')
			const stat = await fs.stat(privateKeyPath)
			expect(stat.isFile()).toBe(true)
			// Check permissions (owner read/write only)
			const mode = stat.mode & 0o777
			expect(mode).toBe(0o600)
		})

		it('saves public key file in correct format', async () => {
			await generateKeyPair(netDir, 'my-vole')
			const publicKeyPath = path.join(netDir, 'vole_key.pub')
			const content = await fs.readFile(publicKeyPath, 'utf-8')
			expect(content.trim()).toMatch(/^vole-ed25519 [A-Za-z0-9+/=]+ my-vole$/)
		})

		it('creates authorized_voles file', async () => {
			await generateKeyPair(netDir, 'test')
			const authorizedPath = path.join(netDir, 'authorized_voles')
			const stat = await fs.stat(authorizedPath)
			expect(stat.isFile()).toBe(true)
		})

		it('produces an instanceId that is 16 hex chars (SHA-256 of public key)', async () => {
			const kp = await generateKeyPair(netDir, 'test')
			expect(kp.instanceId).toMatch(/^[0-9a-f]{16}$/)
		})

		it('produces deterministic instanceId for same key', async () => {
			const kp = await generateKeyPair(netDir, 'test')
			// Derive again from publicKeyString
			const parts = kp.publicKeyString.split(' ')
			const b64 = parts[1]
			const expectedId = crypto.createHash('sha256').update(b64).digest('hex').substring(0, 16)
			expect(kp.instanceId).toBe(expectedId)
		})
	})

	describe('loadKeyPair()', () => {
		it('loads a previously generated keypair', async () => {
			const original = await generateKeyPair(netDir, 'test-instance')
			const loaded = await loadKeyPair(netDir)

			expect(loaded).not.toBeNull()
			expect(loaded!.instanceId).toBe(original.instanceId)
			expect(loaded!.publicKeyString).toBe(original.publicKeyString)
		})

		it('returns null when no keypair exists', async () => {
			const loaded = await loadKeyPair(netDir)
			expect(loaded).toBeNull()
		})

		it('loaded keys can sign and verify', async () => {
			await generateKeyPair(netDir, 'test')
			const loaded = await loadKeyPair(netDir)
			expect(loaded).not.toBeNull()

			const signature = sign(loaded!.privateKey, 'hello')
			const valid = verify(loaded!.publicKey, 'hello', signature)
			expect(valid).toBe(true)
		})
	})

	describe('sign() / verify()', () => {
		it('signs data and verifies with correct key', () => {
			const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
			const signature = sign(privateKey, 'test data')
			expect(signature).toBeTypeOf('string')
			expect(verify(publicKey, 'test data', signature)).toBe(true)
		})

		it('rejects verification with wrong data', () => {
			const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
			const signature = sign(privateKey, 'correct data')
			expect(verify(publicKey, 'wrong data', signature)).toBe(false)
		})

		it('rejects verification with wrong key', () => {
			const kp1 = crypto.generateKeyPairSync('ed25519')
			const kp2 = crypto.generateKeyPairSync('ed25519')
			const signature = sign(kp1.privateKey, 'data')
			expect(verify(kp2.publicKey, 'data', signature)).toBe(false)
		})

		it('returns false for malformed signature', () => {
			const { publicKey } = crypto.generateKeyPairSync('ed25519')
			expect(verify(publicKey, 'data', 'not-a-valid-signature')).toBe(false)
		})

		it('handles empty string data', () => {
			const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
			const signature = sign(privateKey, '')
			expect(verify(publicKey, '', signature)).toBe(true)
		})
	})

	describe('generateNonce()', () => {
		it('generates a base64 string', () => {
			const nonce = generateNonce()
			expect(nonce).toBeTypeOf('string')
			// Valid base64
			expect(() => Buffer.from(nonce, 'base64')).not.toThrow()
		})

		it('generates 32 bytes (44 base64 chars)', () => {
			const nonce = generateNonce()
			const bytes = Buffer.from(nonce, 'base64')
			expect(bytes.length).toBe(32)
		})

		it('generates unique nonces', () => {
			const nonces = new Set<string>()
			for (let i = 0; i < 100; i++) {
				nonces.add(generateNonce())
			}
			expect(nonces.size).toBe(100)
		})
	})

	describe('parsePublicKey()', () => {
		it('parses a valid public key string', async () => {
			const kp = await generateKeyPair(netDir, 'my-vole')
			const parsed = parsePublicKey(kp.publicKeyString)

			expect(parsed).not.toBeNull()
			expect(parsed!.instanceId).toBe(kp.instanceId)
			expect(parsed!.name).toBe('my-vole')
		})

		it('returns null for invalid format', () => {
			expect(parsePublicKey('invalid-format')).toBeNull()
			expect(parsePublicKey('ssh-ed25519 AAAA name')).toBeNull()
			expect(parsePublicKey('')).toBeNull()
		})

		it('derives name from instanceId when name is missing', async () => {
			const kp = await generateKeyPair(netDir, 'test')
			const parts = kp.publicKeyString.split(' ')
			const keyOnly = `${parts[0]} ${parts[1]}`
			const parsed = parsePublicKey(keyOnly)

			expect(parsed).not.toBeNull()
			expect(parsed!.name).toBe(parsed!.instanceId.substring(0, 8))
		})
	})

	describe('trustPeer() / revokePeer() / loadAuthorizedVoles()', () => {
		it('trustPeer adds a key to authorized_voles', async () => {
			await generateKeyPair(netDir, 'self')
			const peer = await generateKeyPair(
				await fs.mkdtemp(path.join(os.tmpdir(), 'peer-')),
				'peer-1',
			)

			const instanceId = await trustPeer(netDir, peer.publicKeyString)
			expect(instanceId).toBe(peer.instanceId)

			const authorized = await loadAuthorizedVoles(netDir)
			expect(authorized.has(peer.instanceId)).toBe(true)
			expect(authorized.get(peer.instanceId)!.name).toBe('peer-1')
		})

		it('trustPeer is idempotent (does not duplicate)', async () => {
			await generateKeyPair(netDir, 'self')
			const peer = await generateKeyPair(
				await fs.mkdtemp(path.join(os.tmpdir(), 'peer-')),
				'peer-1',
			)

			await trustPeer(netDir, peer.publicKeyString)
			await trustPeer(netDir, peer.publicKeyString)

			const content = await fs.readFile(path.join(netDir, 'authorized_voles'), 'utf-8')
			const lines = content.split('\n').filter((l) => l.trim().length > 0)
			expect(lines.length).toBe(1)
		})

		it('trustPeer throws for invalid key', async () => {
			await generateKeyPair(netDir, 'self')
			await expect(trustPeer(netDir, 'bad-key')).rejects.toThrow('Invalid public key format')
		})

		it('revokePeer removes a trusted peer', async () => {
			await generateKeyPair(netDir, 'self')
			const peer = await generateKeyPair(
				await fs.mkdtemp(path.join(os.tmpdir(), 'peer-')),
				'peer-1',
			)

			await trustPeer(netDir, peer.publicKeyString)
			const removed = await revokePeer(netDir, peer.instanceId)
			expect(removed).toBe(true)

			const authorized = await loadAuthorizedVoles(netDir)
			expect(authorized.has(peer.instanceId)).toBe(false)
		})

		it('revokePeer returns false when peer not found', async () => {
			await generateKeyPair(netDir, 'self')
			const removed = await revokePeer(netDir, 'nonexistent-id')
			expect(removed).toBe(false)
		})

		it('loadAuthorizedVoles returns empty map when no file', async () => {
			const authorized = await loadAuthorizedVoles(netDir)
			expect(authorized.size).toBe(0)
		})

		it('loadAuthorizedVoles skips comment lines and blank lines', async () => {
			await generateKeyPair(netDir, 'self')
			const peer = await generateKeyPair(
				await fs.mkdtemp(path.join(os.tmpdir(), 'peer-')),
				'peer-1',
			)

			const authorizedPath = path.join(netDir, 'authorized_voles')
			await fs.writeFile(
				authorizedPath,
				`# This is a comment\n\n${peer.publicKeyString}\n\n# Another comment\n`,
				'utf-8',
			)

			const authorized = await loadAuthorizedVoles(netDir)
			expect(authorized.size).toBe(1)
			expect(authorized.has(peer.instanceId)).toBe(true)
		})

		it('manages multiple trusted peers', async () => {
			await generateKeyPair(netDir, 'self')
			const peer1 = await generateKeyPair(await fs.mkdtemp(path.join(os.tmpdir(), 'p1-')), 'peer-1')
			const peer2 = await generateKeyPair(await fs.mkdtemp(path.join(os.tmpdir(), 'p2-')), 'peer-2')

			await trustPeer(netDir, peer1.publicKeyString)
			await trustPeer(netDir, peer2.publicKeyString)

			const authorized = await loadAuthorizedVoles(netDir)
			expect(authorized.size).toBe(2)

			await revokePeer(netDir, peer1.instanceId)

			const afterRevoke = await loadAuthorizedVoles(netDir)
			expect(afterRevoke.size).toBe(1)
			expect(afterRevoke.has(peer2.instanceId)).toBe(true)
		})
	})
})
