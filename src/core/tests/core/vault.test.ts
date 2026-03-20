import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Vault } from '../../src/core/vault.js'

describe('Vault', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-vault-test-'))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	function createVault(key?: string): Vault {
		return new Vault(path.join(tmpDir, 'vault.json'), key)
	}

	describe('store and get', () => {
		it('stores a value and retrieves it', async () => {
			const vault = createVault()
			await vault.init()

			const ok = await vault.store('api-key', 'secret-123')
			expect(ok).toBe(true)

			const value = await vault.get('api-key')
			expect(value).toBe('secret-123')
		})

		it('returns false for duplicate key (write-once)', async () => {
			const vault = createVault()
			await vault.init()

			await vault.store('key', 'value-1')
			const ok = await vault.store('key', 'value-2')
			expect(ok).toBe(false)

			// Original value preserved
			const value = await vault.get('key')
			expect(value).toBe('value-1')
		})

		it('returns null for unknown key', async () => {
			const vault = createVault()
			await vault.init()

			const value = await vault.get('nonexistent')
			expect(value).toBeNull()
		})
	})

	describe('list', () => {
		it('returns keys without values', async () => {
			const vault = createVault()
			await vault.init()

			await vault.store('key-a', 'secret-a')
			await vault.store('key-b', 'secret-b')

			const list = await vault.list()
			expect(list).toHaveLength(2)
			expect(list.map((e) => e.key)).toEqual(['key-a', 'key-b'])
			// Values should not be in the list
			for (const entry of list) {
				expect(entry).not.toHaveProperty('value')
			}
		})

		it('includes metadata', async () => {
			const vault = createVault()
			await vault.init()

			await vault.store('key', 'val', 'brain', { service: 'github' })
			const list = await vault.list()
			expect(list[0].meta).toEqual({ service: 'github' })
			expect(list[0].source).toBe('brain')
			expect(list[0].createdAt).toBeTypeOf('number')
		})
	})

	describe('delete', () => {
		it('removes a key', async () => {
			const vault = createVault()
			await vault.init()

			await vault.store('to-delete', 'value')
			const ok = await vault.delete('to-delete')
			expect(ok).toBe(true)

			const value = await vault.get('to-delete')
			expect(value).toBeNull()
		})

		it('returns false for unknown key', async () => {
			const vault = createVault()
			await vault.init()

			const ok = await vault.delete('nonexistent')
			expect(ok).toBe(false)
		})
	})

	describe('encryption', () => {
		it('encrypts values when key is set', async () => {
			const vault = createVault('my-encryption-key')
			await vault.init()

			await vault.store('secret', 'plaintext-value')

			// Read the raw file to verify it's not plain text
			const raw = await fs.readFile(path.join(tmpDir, 'vault.json'), 'utf-8')
			const data = JSON.parse(raw)
			expect(data['secret'].value).not.toBe('plaintext-value')
			// Encrypted format: iv:authTag:encrypted
			expect(data['secret'].value.split(':')).toHaveLength(3)
		})

		it('encrypted values can be decrypted', async () => {
			const vault = createVault('my-encryption-key')
			await vault.init()

			await vault.store('secret', 'plaintext-value')
			const value = await vault.get('secret')
			expect(value).toBe('plaintext-value')
		})

		it('stores values as plain text without key', async () => {
			const vault = createVault()
			await vault.init()

			await vault.store('secret', 'plaintext-value')

			const raw = await fs.readFile(path.join(tmpDir, 'vault.json'), 'utf-8')
			const data = JSON.parse(raw)
			expect(data['secret'].value).toBe('plaintext-value')
		})
	})

	describe('persistence', () => {
		it('saves to disk on store', async () => {
			const vault = createVault()
			await vault.init()

			await vault.store('key', 'value')

			const raw = await fs.readFile(path.join(tmpDir, 'vault.json'), 'utf-8')
			const data = JSON.parse(raw)
			expect(data['key']).toBeDefined()
			expect(data['key'].value).toBe('value')
		})

		it('saves to disk on delete', async () => {
			const vault = createVault()
			await vault.init()

			await vault.store('key', 'value')
			await vault.delete('key')

			const raw = await fs.readFile(path.join(tmpDir, 'vault.json'), 'utf-8')
			const data = JSON.parse(raw)
			expect(data['key']).toBeUndefined()
		})

		it('loads existing data on init', async () => {
			// Create a vault and store something
			const vault1 = createVault()
			await vault1.init()
			await vault1.store('persistent', 'data')

			// Create a new vault instance pointing to same file
			const vault2 = createVault()
			await vault2.init()
			const value = await vault2.get('persistent')
			expect(value).toBe('data')
		})

		it('starts fresh when file does not exist', async () => {
			const vault = new Vault(path.join(tmpDir, 'nonexistent', 'vault.json'))
			await vault.init()
			const list = await vault.list()
			expect(list).toHaveLength(0)
		})
	})
})
