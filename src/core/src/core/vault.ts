import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createLogger } from './logger.js'

const logger = createLogger('vault')

export interface VaultEntry {
	value: string // encrypted if VOLE_VAULT_KEY is set, plain text otherwise
	source: 'user' | 'tool' | 'brain'
	createdAt: number
	/** Optional metadata — context about the stored value (service, handle, url, etc.) */
	meta?: Record<string, string>
}

export class Vault {
	private entries: Map<string, VaultEntry> = new Map()
	private vaultPath: string
	private encryptionKey?: Buffer

	constructor(vaultPath: string, encryptionKey?: string) {
		this.vaultPath = vaultPath
		if (encryptionKey) {
			// Derive a 32-byte key from the provided string using SHA-256
			this.encryptionKey = crypto.createHash('sha256').update(encryptionKey).digest()
		}
	}

	async init(): Promise<void> {
		if (!this.encryptionKey) {
			logger.debug('VOLE_VAULT_KEY not set — vault values will be stored in plain text')
		}

		try {
			const raw = await fs.readFile(this.vaultPath, 'utf-8')
			const data = JSON.parse(raw) as Record<string, VaultEntry>
			this.entries = new Map(Object.entries(data))
		} catch {
			// File doesn't exist or is invalid — start fresh
			this.entries = new Map()
		}
	}

	async store(
		key: string,
		value: string,
		source = 'brain',
		meta?: Record<string, string>,
	): Promise<boolean> {
		if (this.entries.has(key)) {
			return false // write-once
		}

		const entry: VaultEntry = {
			value: this.encrypt(value),
			source: source as VaultEntry['source'],
			createdAt: Date.now(),
			...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
		}
		this.entries.set(key, entry)
		await this.save()
		return true
	}

	async get(key: string): Promise<string | null> {
		const entry = this.entries.get(key)
		if (!entry) return null
		return this.decrypt(entry.value)
	}

	async list(): Promise<
		Array<{ key: string; source: string; createdAt: number; meta?: Record<string, string> }>
	> {
		const result: Array<{
			key: string
			source: string
			createdAt: number
			meta?: Record<string, string>
		}> = []
		for (const [key, entry] of this.entries) {
			result.push({ key, source: entry.source, createdAt: entry.createdAt, meta: entry.meta })
		}
		return result
	}

	async delete(key: string): Promise<boolean> {
		if (!this.entries.has(key)) return false
		this.entries.delete(key)
		await this.save()
		return true
	}

	private async save(): Promise<void> {
		const dir = path.dirname(this.vaultPath)
		await fs.mkdir(dir, { recursive: true })
		const obj: Record<string, VaultEntry> = Object.fromEntries(this.entries)
		await fs.writeFile(this.vaultPath, JSON.stringify(obj, null, 2) + '\n', 'utf-8')
	}

	private encrypt(value: string): string {
		if (!this.encryptionKey) return value

		const iv = crypto.randomBytes(12)
		const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv)
		const encrypted = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()])
		const authTag = cipher.getAuthTag()

		return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
	}

	private decrypt(value: string): string {
		if (!this.encryptionKey) return value

		// Check if value looks like encrypted format (iv:authTag:encrypted)
		const parts = value.split(':')
		if (parts.length !== 3) return value // not encrypted, return as-is

		const [ivB64, authTagB64, encryptedB64] = parts
		const iv = Buffer.from(ivB64, 'base64')
		const authTag = Buffer.from(authTagB64, 'base64')
		const encrypted = Buffer.from(encryptedB64, 'base64')

		const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv)
		decipher.setAuthTag(authTag)
		return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8')
	}
}
