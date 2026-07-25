/**
 * RelayBlobStore — hub-side ciphertext storage for VoleDrop relay transfers.
 *
 * When two NAT'd relay members exchange a file, the hub stores the encrypted frames
 * between the sender's upload and the receiver's download. The hub NEVER holds keys:
 * blobs are opaque chacha20-poly1305 frames (file-crypto.ts), and the only metadata
 * kept is routing (from, to, transferId, size, age) — the same visibility the hub
 * already has for relayed chat envelopes.
 *
 * Layout: `<dir>/<blobId>` (completed), `<dir>/<blobId>.part` (uploading),
 * `<dir>/<blobId>.meta.json` (sidecar). create() is idempotent per (from, transferId):
 * a retry after a died upload truncates the partial and reuses the same blobId, so a
 * hub restart mid-transfer converges via the sender's ordinary retry path.
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createLogger } from '../core/logger.js'

const logger = createLogger('volenet-files')

export interface BlobMeta {
	blobId: string
	from: string
	to: string
	transferId: string
	cipherSize: number
	createdAt: number
	complete: boolean
}

export interface BlobStoreOptions {
	dir: string
	/** Max stored ciphertext bytes per (from,to) pair. */
	quotaBytes: number
	/** Stored blob lifetime before the sweep deletes it. */
	ttlMs: number
	/** Max single blob size (ciphertext). */
	maxBlobBytes: number
}

export class RelayBlobStore {
	private metas = new Map<string, BlobMeta>()

	constructor(private opts: BlobStoreOptions) {
		fs.mkdirSync(opts.dir, { recursive: true })
		this.loadExisting()
	}

	/** Rehydrate metadata sidecars after a restart (sweep prunes stale ones). */
	private loadExisting(): void {
		for (const name of fs.readdirSync(this.opts.dir)) {
			if (!name.endsWith('.meta.json')) continue
			try {
				const meta = JSON.parse(fs.readFileSync(path.join(this.opts.dir, name), 'utf8')) as BlobMeta
				if (meta?.blobId) this.metas.set(meta.blobId, meta)
			} catch {
				/* corrupt sidecar — the sweep removes orphans */
			}
		}
	}

	private blobPath(blobId: string, part = false): string {
		return path.join(this.opts.dir, part ? `${blobId}.part` : blobId)
	}

	private writeMeta(meta: BlobMeta): void {
		fs.writeFileSync(path.join(this.opts.dir, `${meta.blobId}.meta.json`), JSON.stringify(meta))
	}

	/** Stored bytes attributed to a sender→receiver pair (quota accounting). */
	pairUsage(from: string, to: string): number {
		let total = 0
		for (const m of this.metas.values()) {
			if (m.from === from && m.to === to) total += m.cipherSize
		}
		return total
	}

	create(
		from: string,
		to: string,
		transferId: string,
		cipherSize: number,
	): { blobId: string } | { error: 'quota' | 'too-large' } {
		if (cipherSize > this.opts.maxBlobBytes) return { error: 'too-large' }
		// Idempotent per (from, transferId): a retried create reuses the allocation.
		for (const m of this.metas.values()) {
			if (m.from === from && m.transferId === transferId) {
				try {
					fs.rmSync(this.blobPath(m.blobId, true), { force: true })
					fs.rmSync(this.blobPath(m.blobId), { force: true })
				} catch {
					/* best effort */
				}
				m.complete = false
				m.cipherSize = cipherSize
				m.createdAt = Date.now()
				this.writeMeta(m)
				return { blobId: m.blobId }
			}
		}
		if (this.pairUsage(from, to) + cipherSize > this.opts.quotaBytes) return { error: 'quota' }
		const blobId = crypto.randomBytes(16).toString('hex')
		const meta: BlobMeta = {
			blobId,
			from,
			to,
			transferId,
			cipherSize,
			createdAt: Date.now(),
			complete: false,
		}
		this.metas.set(blobId, meta)
		this.writeMeta(meta)
		return { blobId }
	}

	get(blobId: string): BlobMeta | undefined {
		return this.metas.get(blobId)
	}

	openWrite(blobId: string): fs.WriteStream | null {
		if (!this.metas.has(blobId)) return null
		return fs.createWriteStream(this.blobPath(blobId, true))
	}

	/** Mark an upload finished: rename .part into place. */
	complete(blobId: string): boolean {
		const meta = this.metas.get(blobId)
		if (!meta) return false
		try {
			fs.renameSync(this.blobPath(blobId, true), this.blobPath(blobId))
		} catch {
			return false
		}
		meta.complete = true
		this.writeMeta(meta)
		return true
	}

	openRead(blobId: string, byteOffset = 0): fs.ReadStream | null {
		const meta = this.metas.get(blobId)
		if (!meta?.complete) return null
		try {
			return fs.createReadStream(this.blobPath(blobId), { start: byteOffset })
		} catch {
			return null
		}
	}

	storedPath(blobId: string): string | null {
		const meta = this.metas.get(blobId)
		return meta?.complete ? this.blobPath(blobId) : null
	}

	delete(blobId: string): void {
		this.metas.delete(blobId)
		for (const p of [
			this.blobPath(blobId),
			this.blobPath(blobId, true),
			path.join(this.opts.dir, `${blobId}.meta.json`),
		]) {
			try {
				fs.rmSync(p, { force: true })
			} catch {
				/* best effort */
			}
		}
	}

	/** TTL cleanup + orphan `.part`/sidecar removal. Called on start and periodically. */
	sweep(now = Date.now()): number {
		let removed = 0
		for (const meta of [...this.metas.values()]) {
			if (now - meta.createdAt > this.opts.ttlMs) {
				this.delete(meta.blobId)
				removed++
			}
		}
		// Orphans on disk with no live meta (crashed uploads, corrupt sidecars).
		for (const name of fs.readdirSync(this.opts.dir)) {
			const id = name.replace(/\.(part|meta\.json)$/, '')
			if (!this.metas.has(id)) {
				try {
					fs.rmSync(path.join(this.opts.dir, name), { force: true })
					removed++
				} catch {
					/* best effort */
				}
			}
		}
		if (removed > 0) logger.info(`[volenet-files] blob sweep removed ${removed} item(s)`)
		return removed
	}
}
