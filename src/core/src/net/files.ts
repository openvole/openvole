/**
 * VoleDrop — E2E-encrypted file transfer over VoleNet (`net.files`).
 *
 * Control/data split: control messages (`file:*`, `relay:blob:*`) ride the ordinary
 * signed message channel (auto-sealed when net.encrypt is on); the bulk bytes stream
 * over `/volenet/blob/*` as chacha20-poly1305 frames (file-crypto.ts). The per-transfer
 * key is ALWAYS sealed with the PQ-hybrid seal — file confidentiality never depends on
 * net.encrypt or TLS.
 *
 * Direction is chosen once by the receiver at accept time:
 *   relay-received offer → relay · sender endpoint reachable → pull ·
 *   receiver has endpoint → push · common hub → relay · else reject 'no-route'.
 * The hub stores ciphertext only (RelayBlobStore), with per-pair quotas and TTL.
 *
 * Consent: `files.acceptFrom` ('*' | name/id-prefix list) auto-accepts; everything else
 * waits as 'pending' for an explicit acceptFile/rejectFile. Inbox writes are sanitized
 * basenames, atomically renamed only after the sha256 verifies. Never executed.
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import type * as http from 'node:http'
import * as path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createLogger } from '../core/logger.js'
import { RelayBlobStore } from './blob-store.js'
import {
	CHUNK_BYTES_DEFAULT,
	ChunkDecryptStream,
	ChunkEncryptStream,
	FRAME_OVERHEAD,
	cipherSizeFor,
	scanFrameOffset,
	totalChunksFor,
} from './file-crypto.js'
import type { VoleKeyPair } from './keys.js'
import { type VoleNetInstance, type VoleNetMessage, createMessage } from './protocol.js'
import { type SealedBox, seal, unseal } from './seal.js'
import type { VoleNetTransport } from './transport.js'

const logger = createLogger('volenet-files')

export interface VoleNetFilesConfig {
	enabled?: boolean
	inboxDir?: string
	/**
	 * Largest file this node will accept over a direct transfer. Default 2 GiB; `0` means no
	 * limit. Transfers are chunked, resumable and streamed to disk, so size costs nothing but
	 * disk — which is exactly why a limit exists at all: it is the only thing standing between a
	 * peer (or a buggy sender) and a full disk. Relayed transfers are bounded separately by
	 * `relayMaxBytes`, because there the bytes land on somebody else's disk.
	 */
	maxBytes?: number
	acceptFrom?: '*' | string[]
	maxConcurrent?: number
	offerTtlMinutes?: number
	chunkBytes?: number
	/** Largest single blob this node will host when acting as a relay hub. Default 512 MiB. */
	relayMaxBytes?: number
	relayQuotaBytes?: number
	relayTtlHours?: number
}

/** 2 GiB — generous enough for video and disk images, bounded enough to be a safety net. */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024
/** A relay hub stores other people's bytes, so it stays capped regardless of endpoint limits. */
const DEFAULT_RELAY_MAX_BYTES = 512 * 1024 * 1024

/** Human-readable size for operator-facing messages. */
function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`
	const units = ['KiB', 'MiB', 'GiB', 'TiB']
	let v = n / 1024
	let i = 0
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024
		i++
	}
	return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export type TransferState =
	| 'offered'
	| 'pending'
	| 'accepted'
	| 'transferring'
	| 'verifying'
	| 'done'
	| 'rejected'
	| 'failed'
	| 'cancelled'
	| 'expired'

export interface TransferInfo {
	transferId: string
	dir: 'send' | 'recv'
	peerId: string
	peerName: string
	name: string
	size: number
	sha256: string
	state: TransferState
	mode?: 'pull' | 'push' | 'relay'
	bytesDone: number
	error?: string
	note?: string
	savedPath?: string
	createdAt: number
	updatedAt: number
}

interface Transfer extends TransferInfo {
	chunkBytes: number
	totalChunks: number
	relayed: boolean
	viaHub?: string
	key?: Buffer
	keyBox?: SealedBox
	srcPath?: string
	partialPath?: string
	pull?: { url: string; token: string }
	push?: { url: string; token: string }
	hubId?: string
	blobId?: string
	lastProgressAt?: number
	active?: { destroy: () => void }
}

interface TokenEntry {
	id: string // transferId (peer transfers) or blobId (hub)
	peerId: string
	op: 'pull' | 'push' | 'upload' | 'download'
	expiresAt: number
}

interface ChatEntryLike {
	dir: 'in' | 'out'
	text: string
	fromName: string
	timestamp: number
	messageId: string
	relayed?: boolean
}

export interface VoleNetFilesOptions {
	config: VoleNetFilesConfig
	relayEnabled: boolean
	projectRoot: string
	netDir: string
	keyPair: VoleKeyPair
	transport: VoleNetTransport
	instanceName: string
	advertisedEndpoint: string
	bus?: { emit: (type: string, event: unknown) => void }
	getInstances: () => VoleNetInstance[]
	resolveRelayPeer: (
		ref: string,
	) =>
		| { instanceId: string; name: string; xPublicKey?: string; mlkemPublicKey?: string }
		| undefined
	getHubForMember: (peerId: string) => string | undefined
	sealToMemberViaRelay: (
		ref: string,
		type: VoleNetMessage['type'],
		payload: Record<string, unknown>,
	) => Promise<{ ok: boolean; delivered?: boolean; hubId?: string; error?: string }>
	appendChat: (peerId: string, entry: ChatEntryLike) => Promise<void>
}

const SWEEP_INTERVAL_MS = 60_000
const BLOB_SWEEP_INTERVAL_MS = 60 * 60_000
const PROGRESS_THROTTLE_MS = 500
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000]
const GRANT_TIMEOUT_MS = 15_000
const PROBE_TIMEOUT_MS = 4_000

function sanitizeFilename(name: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
	let base = path.basename(name || 'file').replace(/[\x00-\x1f/\\]/g, '')
	if (!base || base === '.' || base === '..') base = 'file'
	if (base.length > 200) {
		const ext = path.extname(base).slice(0, 20)
		base = base.slice(0, 200 - ext.length) + ext
	}
	return base
}

async function sha256File(filePath: string): Promise<string> {
	const hash = crypto.createHash('sha256')
	for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer)
	return hash.digest('hex')
}

/**
 * Byte-budget guard as a Transform INSIDE the pipeline. Never attach a bare
 * `req.on('data')` counter before pipeline() — that switches the stream to flowing
 * mode, and any await before the pipeline attaches silently drops bytes.
 */
function byteBudget(limit: number): Transform {
	let received = 0
	return new Transform({
		transform(chunk: Buffer, _enc, cb) {
			received += chunk.length
			if (received > limit) cb(new Error(`byte budget exceeded (${received} > ${limit})`))
			else cb(null, chunk)
		},
	})
}

function humanSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export class VoleNetFiles {
	private transfers = new Map<string, Transfer>()
	/** sha256(token) → entry. Tokens are never stored or logged in the clear. */
	private tokens = new Map<string, TokenEntry>()
	private blobStore: RelayBlobStore | null = null
	private activeStreams = 0
	private sweepTimer?: ReturnType<typeof setInterval>
	private blobSweepTimer?: ReturnType<typeof setInterval>
	/** Pending relay:blob grants keyed by transferId (sender) / blobId (receiver fetch). */
	private grantWaiters = new Map<
		string,
		{ resolve: (g: { blobId: string; token: string; url: string } | { deny: string }) => void }
	>()

	constructor(private opts: VoleNetFilesOptions) {
		if (opts.relayEnabled && opts.config.enabled !== false) {
			this.blobStore = new RelayBlobStore({
				dir: path.join(opts.netDir, 'blobs'),
				quotaBytes: opts.config.relayQuotaBytes ?? 512 * 1024 * 1024,
				ttlMs: (opts.config.relayTtlHours ?? 24) * 60 * 60_000,
				// Deliberately NOT derived from maxBytes: raising (or removing) what this node
				// accepts for itself must not turn its relay into unbounded storage for others.
				maxBlobBytes:
					(opts.config.relayMaxBytes ?? DEFAULT_RELAY_MAX_BYTES) + 1024 * FRAME_OVERHEAD,
			})
			this.blobStore.sweep()
			this.blobSweepTimer = setInterval(() => this.blobStore?.sweep(), BLOB_SWEEP_INTERVAL_MS)
		}
		this.sweepTimer = setInterval(() => this.sweepTransfers(), SWEEP_INTERVAL_MS)
		void this.sweepOutbox()
	}

	stop(): void {
		if (this.sweepTimer) clearInterval(this.sweepTimer)
		if (this.blobSweepTimer) clearInterval(this.blobSweepTimer)
		for (const t of this.transfers.values()) t.active?.destroy()
		this.tokens.clear()
		this.grantWaiters.clear()
	}

	// ── Small helpers ─────────────────────────────────────────────────────────

	private get me(): string {
		return this.opts.keyPair.instanceId
	}

	private get chunkBytes(): number {
		return this.opts.config.chunkBytes ?? CHUNK_BYTES_DEFAULT
	}

	/** Configured accept limit. `0` (or negative) means unlimited — checked via `overLimit`. */
	private get maxBytes(): number {
		return this.opts.config.maxBytes ?? DEFAULT_MAX_BYTES
	}

	private overLimit(size: number): boolean {
		const limit = this.maxBytes
		return limit > 0 && size > limit
	}

	/**
	 * Free bytes on the inbox's filesystem, or null when it can't be determined.
	 *
	 * With a generous (or disabled) size limit, the disk becomes the real boundary — and running
	 * it to zero takes the whole agent down, not just the transfer. Better to decline the offer
	 * than to accept and die halfway through.
	 */
	private async freeSpace(): Promise<number | null> {
		for (const dir of [this.inboxDir(), this.opts.netDir]) {
			try {
				const st = await fsp.statfs(dir)
				return Number(st.bavail) * Number(st.bsize)
			} catch {
				// dir may not exist yet — fall through to the next candidate
			}
		}
		return null
	}

	private get offerTtlMs(): number {
		return (this.opts.config.offerTtlMinutes ?? 60) * 60_000
	}

	private inboxDir(): string {
		return path.resolve(this.opts.projectRoot, this.opts.config.inboxDir ?? '.openvole/net/inbox')
	}

	private outboxDir(): string {
		return path.join(this.opts.netDir, 'files', 'outbox')
	}

	private touch(t: Transfer, state?: TransferState) {
		if (state) t.state = state
		t.updatedAt = Date.now()
	}

	private emit(type: string, event: Record<string, unknown>) {
		try {
			this.opts.bus?.emit(type, event)
		} catch {
			/* listeners must not break transfers */
		}
	}

	private emitProgress(t: Transfer) {
		const now = Date.now()
		if (t.lastProgressAt && now - t.lastProgressAt < PROGRESS_THROTTLE_MS) return
		t.lastProgressAt = now
		this.emit('volenet:file:progress', {
			transferId: t.transferId,
			dir: t.dir,
			bytes: t.bytesDone,
			totalBytes: t.size,
			pct: t.size > 0 ? Math.min(100, Math.round((t.bytesDone / t.size) * 100)) : 100,
		})
	}

	private mintToken(id: string, peerId: string, op: TokenEntry['op']): string {
		const token = crypto.randomBytes(32).toString('hex')
		const hash = crypto.createHash('sha256').update(token).digest('hex')
		this.tokens.set(hash, { id, peerId, op, expiresAt: Date.now() + this.offerTtlMs })
		return token
	}

	private lookupToken(presented: string | undefined): TokenEntry | null {
		if (!presented || typeof presented !== 'string' || presented.length > 128) return null
		const hash = crypto.createHash('sha256').update(presented).digest('hex')
		const hashBuf = Buffer.from(hash, 'hex')
		for (const [stored, entry] of this.tokens) {
			// Constant-time compare over fixed-length sha256 digests.
			if (crypto.timingSafeEqual(hashBuf, Buffer.from(stored, 'hex'))) {
				if (Date.now() > entry.expiresAt) {
					this.tokens.delete(stored)
					return null
				}
				return entry
			}
		}
		return null
	}

	private revokeTokensFor(id: string) {
		for (const [hash, entry] of this.tokens) if (entry.id === id) this.tokens.delete(hash)
	}

	/** Send a control message to the transfer's peer over its channel (direct or sealed relay). */
	private async sendCtl(
		t: { peerId: string; relayed: boolean },
		type: VoleNetMessage['type'],
		payload: Record<string, unknown>,
	): Promise<boolean> {
		if (t.relayed) {
			const r = await this.opts.sealToMemberViaRelay(t.peerId, type, payload)
			return r.ok && r.delivered !== false
		}
		const msg = createMessage(
			type,
			this.me,
			t.peerId,
			payload,
			this.opts.keyPair.privateKey,
			this.opts.keyPair.pqPrivateKey,
		)
		return this.opts.transport.sendToPeer(t.peerId, msg)
	}

	private directPeer(ref: string): VoleNetInstance | undefined {
		return this.opts
			.getInstances()
			.find((i) => i.id === ref || i.name === ref || i.id.startsWith(ref))
	}

	private isAutoAccepted(fromId: string, fromName?: string): boolean {
		const policy = this.opts.config.acceptFrom
		if (policy === '*') return true
		if (Array.isArray(policy)) {
			for (const raw of policy) {
				const trimmed = typeof raw === 'string' ? raw.trim() : ''
				if (!trimmed) continue
				if (trimmed === '*') return true
				if (trimmed === fromId || fromId.startsWith(trimmed)) return true
				if (fromName && trimmed === fromName) return true
			}
		}
		return false
	}

	// ── Public API ────────────────────────────────────────────────────────────

	listTransfers(): TransferInfo[] {
		return [...this.transfers.values()]
			.map((t) => this.publicInfo(t))
			.sort((a, b) => b.createdAt - a.createdAt)
	}

	getTransfer(transferId: string): TransferInfo | undefined {
		const t = this.transfers.get(transferId)
		return t ? this.publicInfo(t) : undefined
	}

	private publicInfo(t: Transfer): TransferInfo {
		return {
			transferId: t.transferId,
			dir: t.dir,
			peerId: t.peerId,
			peerName: t.peerName,
			name: t.name,
			size: t.size,
			sha256: t.sha256,
			state: t.state,
			mode: t.mode,
			bytesDone: t.bytesDone,
			error: t.error,
			note: t.note,
			savedPath: t.savedPath,
			createdAt: t.createdAt,
			updatedAt: t.updatedAt,
		}
	}

	async sendFile(
		peerRef: string,
		filePath: string,
		note?: string,
	): Promise<{ ok: boolean; transferId?: string; error?: string }> {
		if (this.opts.config.enabled === false) return { ok: false, error: 'net.files is disabled' }
		const abs = path.resolve(this.opts.projectRoot, filePath)
		let stat: fs.Stats
		try {
			stat = await fsp.stat(abs)
		} catch {
			return { ok: false, error: `file not found: ${abs}` }
		}
		if (!stat.isFile()) return { ok: false, error: `not a regular file: ${abs}` }

		// Resolve the peer: direct instance first, then hub roster.
		const direct = this.directPeer(peerRef)
		const relayMember = direct ? undefined : this.opts.resolveRelayPeer(peerRef)
		const peer = direct
			? { id: direct.id, name: direct.name, x: direct.xPublicKey, mlkem: direct.mlkemPublicKey }
			: relayMember
				? {
						id: relayMember.instanceId,
						name: relayMember.name,
						x: relayMember.xPublicKey,
						mlkem: relayMember.mlkemPublicKey,
					}
				: null
		if (!peer) return { ok: false, error: `no connected peer: "${peerRef}"` }
		if (!peer.x) return { ok: false, error: `peer "${peer.name}" announces no encryption key` }

		const transferId = crypto.randomUUID()
		const key = crypto.randomBytes(32)
		const keyBox = seal(peer.x, key, `${this.me}|${peer.id}|file:${transferId}`, peer.mlkem)
		if (!keyBox) return { ok: false, error: 'failed to seal transfer key' }
		const sha256 = await sha256File(abs)

		const t: Transfer = {
			transferId,
			dir: 'send',
			peerId: peer.id,
			peerName: peer.name,
			name: sanitizeFilename(path.basename(abs)),
			size: stat.size,
			sha256,
			state: 'offered',
			bytesDone: 0,
			note,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			chunkBytes: this.chunkBytes,
			totalChunks: totalChunksFor(stat.size, this.chunkBytes),
			relayed: !direct,
			key,
			srcPath: abs,
		}

		// Pull credentials whenever we have a reachable-looking endpoint to serve from.
		let pull: { url: string; token: string } | undefined
		if (this.opts.advertisedEndpoint && !t.relayed) {
			pull = {
				url: `${this.opts.advertisedEndpoint}/volenet/blob/${transferId}`,
				token: this.mintToken(transferId, peer.id, 'pull'),
			}
			t.pull = pull
		}

		this.transfers.set(transferId, t)
		const payload: Record<string, unknown> = {
			transferId,
			name: t.name,
			size: t.size,
			sha256,
			chunkBytes: t.chunkBytes,
			totalChunks: t.totalChunks,
			keyBox,
			fromName: this.opts.instanceName,
			...(note ? { note } : {}),
			...(pull ? { pull } : {}),
		}
		const sent = await this.sendCtl(t, 'file:offer', payload)
		if (!sent) {
			this.transfers.delete(transferId)
			this.revokeTokensFor(transferId)
			return { ok: false, error: `could not reach peer "${peer.name}"` }
		}
		void this.opts.appendChat(peer.id, {
			dir: 'out',
			text: `\u{1F4CE} ${t.name} (${humanSize(t.size)})${t.note ? ` \u2014 ${t.note}` : ''}`,
			fromName: this.opts.instanceName,
			timestamp: Date.now(),
			messageId: transferId,
			relayed: t.relayed,
		})
		return { ok: true, transferId }
	}

	async acceptFile(transferId: string): Promise<{ ok: boolean; error?: string }> {
		const t = this.transfers.get(transferId)
		if (!t || t.dir !== 'recv') return { ok: false, error: 'unknown transfer' }
		if (t.state !== 'pending' && t.state !== 'offered')
			return { ok: false, error: `transfer is ${t.state}` }
		return this.beginReceive(t)
	}

	async rejectFile(transferId: string, reason = 'denied'): Promise<{ ok: boolean }> {
		const t = this.transfers.get(transferId)
		if (!t || t.dir !== 'recv') return { ok: false }
		this.touch(t, 'rejected')
		this.revokeTokensFor(transferId)
		await this.sendCtl(t, 'file:reject', { transferId, reason })
		return { ok: true }
	}

	async cancelTransfer(transferId: string): Promise<{ ok: boolean }> {
		const t = this.transfers.get(transferId)
		if (!t) return { ok: false }
		t.active?.destroy()
		this.touch(t, 'cancelled')
		this.revokeTokensFor(transferId)
		if (t.partialPath) await fsp.rm(t.partialPath, { force: true }).catch(() => {})
		await this.sendCtl(t, 'file:cancel', { transferId }).catch(() => {})
		return { ok: true }
	}

	// ── Inbound control messages ──────────────────────────────────────────────

	handleMessage(msg: VoleNetMessage, ctx: { relayed?: boolean; viaHub?: string }): void {
		void this.handleMessageAsync(msg, ctx).catch((err) => {
			logger.warn(
				`[volenet-files] handler error for ${msg.type}: ${err instanceof Error ? err.message : String(err)}`,
			)
		})
	}

	private async handleMessageAsync(
		msg: VoleNetMessage,
		ctx: { relayed?: boolean; viaHub?: string },
	): Promise<void> {
		switch (msg.type) {
			case 'file:offer':
				return this.onOffer(msg, ctx)
			case 'file:accept':
				return this.onAccept(msg)
			case 'file:reject':
				return this.onReject(msg)
			case 'file:relay-ready':
				return this.onRelayReady(msg)
			case 'file:done':
				return this.onDone(msg)
			case 'file:error':
				return this.onPeerError(msg)
			case 'file:cancel':
				return this.onPeerCancel(msg)
			case 'relay:blob:create':
				return this.hubOnBlobCreate(msg)
			case 'relay:blob:fetch':
				return this.hubOnBlobFetch(msg)
			case 'relay:blob:done':
				return this.hubOnBlobDone(msg)
			case 'relay:blob:grant':
			case 'relay:blob:deny':
				return this.onBlobGrantOrDeny(msg)
			default:
				return
		}
	}

	private async onOffer(msg: VoleNetMessage, ctx: { relayed?: boolean; viaHub?: string }) {
		const p = msg.payload as {
			transferId?: string
			name?: string
			size?: number
			sha256?: string
			chunkBytes?: number
			totalChunks?: number
			keyBox?: SealedBox
			fromName?: string
			note?: string
			pull?: { url: string; token: string }
		}
		if (
			!p?.transferId ||
			typeof p.name !== 'string' ||
			typeof p.size !== 'number' ||
			p.size < 0 ||
			typeof p.sha256 !== 'string' ||
			!p.keyBox ||
			typeof p.chunkBytes !== 'number' ||
			p.chunkBytes < 1024 ||
			p.chunkBytes > 64 * 1024 * 1024
		)
			return
		if (this.transfers.has(p.transferId)) return // duplicate offer
		const fromName = p.fromName || msg.from.substring(0, 8)
		const reply = { peerId: msg.from, relayed: !!ctx.relayed }

		if (this.opts.config.enabled === false) {
			await this.sendCtl(reply, 'file:reject', { transferId: p.transferId, reason: 'disabled' })
			return
		}
		const free = await this.freeSpace()
		// 5% headroom: the partial file, its atomic rename, and whatever else the agent is doing.
		if (free !== null && p.size * 1.05 > free) {
			await this.sendCtl(reply, 'file:reject', {
				transferId: p.transferId,
				reason: `no-space: ${fmtBytes(p.size)} offered, ${fmtBytes(free)} free on the inbox filesystem`,
			})
			return
		}
		if (this.overLimit(p.size)) {
			// Say what the limit is. A bare "too-large" leaves the sender guessing whether to
			// retry, split the file, or ask the operator to raise net.files.maxBytes.
			await this.sendCtl(reply, 'file:reject', {
				transferId: p.transferId,
				reason: `too-large: ${fmtBytes(p.size)} exceeds this node's limit of ${fmtBytes(this.maxBytes)} (net.files.maxBytes)`,
			})
			return
		}

		const t: Transfer = {
			transferId: p.transferId,
			dir: 'recv',
			peerId: msg.from,
			peerName: fromName,
			name: sanitizeFilename(p.name),
			size: p.size,
			sha256: p.sha256,
			state: 'offered',
			bytesDone: 0,
			note: p.note,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			chunkBytes: p.chunkBytes,
			totalChunks: p.totalChunks ?? totalChunksFor(p.size, p.chunkBytes),
			relayed: !!ctx.relayed,
			viaHub: ctx.viaHub,
			keyBox: p.keyBox,
			pull: p.pull,
		}
		this.transfers.set(t.transferId, t)
		void this.opts.appendChat(msg.from, {
			dir: 'in',
			text: `\u{1F4CE} ${t.name} (${humanSize(t.size)})${t.note ? ` \u2014 ${t.note}` : ''}`,
			fromName,
			timestamp: msg.timestamp,
			messageId: t.transferId,
			relayed: t.relayed,
		})

		if (this.isAutoAccepted(msg.from, fromName)) {
			this.emit('volenet:file:offer', {
				transferId: t.transferId,
				from: msg.from,
				fromName,
				name: t.name,
				size: t.size,
				note: t.note,
				auto: true,
			})
			await this.beginReceive(t)
		} else {
			this.touch(t, 'pending')
			this.emit('volenet:file:offer', {
				transferId: t.transferId,
				from: msg.from,
				fromName,
				name: t.name,
				size: t.size,
				note: t.note,
				auto: false,
			})
		}
	}

	/** Unseal the key, pick the mode, tell the sender, and start (receiver side). */
	private async beginReceive(t: Transfer): Promise<{ ok: boolean; error?: string }> {
		if (!t.keyBox) return { ok: false, error: 'offer carries no key' }
		if (!this.opts.keyPair.xPrivateKey) {
			this.touch(t, 'failed')
			t.error = 'this instance has no X25519 key (regenerate with vole net init)'
			return { ok: false, error: t.error }
		}
		const key = unseal(
			this.opts.keyPair.xPrivateKey,
			t.keyBox,
			`${t.peerId}|${this.me}|file:${t.transferId}`,
			this.opts.keyPair.mlkemPrivateKey,
		)
		if (!key || key.length !== 32) {
			this.touch(t, 'failed')
			t.error = 'transfer key failed to unseal'
			await this.sendCtl(t, 'file:error', { transferId: t.transferId, code: 'io' })
			return { ok: false, error: t.error }
		}
		t.key = key

		// Mode selection (see module docstring).
		let mode: 'pull' | 'push' | 'relay' | null = null
		let hubId: string | undefined
		if (t.relayed) {
			mode = 'relay'
			hubId = t.viaHub ?? this.opts.getHubForMember(t.peerId)
			if (!hubId) mode = null
		} else {
			const sender = this.opts.getInstances().find((i) => i.id === t.peerId)
			if (t.pull && sender?.endpoint && (await this.probe(sender.endpoint))) mode = 'pull'
			else if (this.opts.advertisedEndpoint) mode = 'push'
			else {
				hubId = this.opts.getHubForMember(t.peerId)
				if (hubId) mode = 'relay'
			}
		}
		if (!mode) {
			this.touch(t, 'rejected')
			await this.sendCtl(t, 'file:reject', { transferId: t.transferId, reason: 'no-route' })
			return { ok: false, error: 'no route to receive the file' }
		}

		t.mode = mode
		t.hubId = hubId
		this.touch(t, 'accepted')
		const push =
			this.opts.advertisedEndpoint && mode !== 'relay'
				? {
						url: `${this.opts.advertisedEndpoint}/volenet/blob/${t.transferId}`,
						token: this.mintToken(t.transferId, t.peerId, 'push'),
					}
				: undefined
		if (push) t.push = push
		await this.sendCtl(t, 'file:accept', {
			transferId: t.transferId,
			mode,
			...(push ? { push } : {}),
			...(hubId ? { hubId } : {}),
		})

		if (mode === 'pull') void this.runPull(t)
		// push: we wait for the sender's POST against our blob endpoint.
		// relay: we wait for file:relay-ready.
		return { ok: true }
	}

	private async probe(endpoint: string): Promise<boolean> {
		try {
			const res = await fetch(`${endpoint}/health`, {
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
			})
			return res.ok
		} catch {
			return false
		}
	}

	private async onAccept(msg: VoleNetMessage) {
		const p = msg.payload as {
			transferId?: string
			mode?: 'pull' | 'push' | 'relay'
			push?: { url: string; token: string }
			hubId?: string
		}
		const t = p?.transferId ? this.transfers.get(p.transferId) : undefined
		if (!t || t.dir !== 'send' || t.peerId !== msg.from) return
		if (t.state !== 'offered') return
		t.mode = p.mode
		if (p.push) t.push = p.push
		if (p.hubId) t.hubId = p.hubId
		this.touch(t, p.mode === 'pull' ? 'transferring' : 'accepted')
		if (p.mode === 'push') void this.runPush(t)
		else if (p.mode === 'relay') void this.runRelayUpload(t)
		// pull: receiver drives; we serve GETs against our blob endpoint.
	}

	private async onReject(msg: VoleNetMessage) {
		const p = msg.payload as { transferId?: string; reason?: string }
		const t = p?.transferId ? this.transfers.get(p.transferId) : undefined
		if (!t || t.dir !== 'send' || t.peerId !== msg.from) return
		this.touch(t, 'rejected')
		t.error = p.reason ?? 'denied'
		this.revokeTokensFor(t.transferId)
		this.emit('volenet:file:rejected', {
			transferId: t.transferId,
			by: t.peerId,
			reason: t.error,
		})
	}

	private async onRelayReady(msg: VoleNetMessage) {
		const p = msg.payload as { transferId?: string; blobId?: string; hubId?: string }
		const t = p?.transferId ? this.transfers.get(p.transferId) : undefined
		if (!t || t.dir !== 'recv' || t.peerId !== msg.from || !p.blobId) return
		if (t.state !== 'accepted') return
		t.blobId = p.blobId
		if (p.hubId) t.hubId = p.hubId
		void this.runRelayDownload(t)
	}

	private async onDone(msg: VoleNetMessage) {
		const p = msg.payload as { transferId?: string; bytes?: number }
		const t = p?.transferId ? this.transfers.get(p.transferId) : undefined
		if (!t || t.dir !== 'send' || t.peerId !== msg.from) return
		this.touch(t, 'done')
		t.bytesDone = t.size
		this.revokeTokensFor(t.transferId)
		await this.cleanupOutboxSource(t)
		this.emit('volenet:file:sent', {
			transferId: t.transferId,
			to: t.peerId,
			toName: t.peerName,
			name: t.name,
			size: t.size,
		})
	}

	private async onPeerError(msg: VoleNetMessage) {
		const p = msg.payload as { transferId?: string; code?: string; detail?: string }
		const t = p?.transferId ? this.transfers.get(p.transferId) : undefined
		if (!t || t.peerId !== msg.from) return
		if (t.state === 'done' || t.state === 'failed') return
		// Sender-side fallback: the receiver couldn't pull from us — push if we got creds.
		if (t.dir === 'send' && p.code === 'pull-unreachable' && t.push) {
			t.mode = 'push'
			this.touch(t, 'accepted')
			void this.runPush(t)
			return
		}
		this.failTransfer(t, p.code ?? 'io', p.detail)
	}

	private async onPeerCancel(msg: VoleNetMessage) {
		const p = msg.payload as { transferId?: string }
		const t = p?.transferId ? this.transfers.get(p.transferId) : undefined
		if (!t || t.peerId !== msg.from) return
		t.active?.destroy()
		this.touch(t, 'cancelled')
		this.revokeTokensFor(t.transferId)
		if (t.partialPath) await fsp.rm(t.partialPath, { force: true }).catch(() => {})
	}

	private failTransfer(t: Transfer, code: string, detail?: string) {
		t.active?.destroy()
		this.touch(t, 'failed')
		t.error = detail ? `${code}: ${detail}` : code
		this.revokeTokensFor(t.transferId)
		this.emit('volenet:file:failed', {
			transferId: t.transferId,
			dir: t.dir,
			code,
			...(detail ? { detail } : {}),
		})
	}

	// ── Receiver: pull + shared finalization ──────────────────────────────────

	private async runPull(t: Transfer) {
		if (!t.pull || !t.key) return
		this.touch(t, 'transferring')
		await fsp.mkdir(path.join(this.inboxDir(), '.partial'), { recursive: true })
		t.partialPath = path.join(this.inboxDir(), '.partial', `${t.transferId}.part`)

		let fromChunk = 0
		for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
			try {
				const url = fromChunk > 0 ? `${t.pull.url}?from=${fromChunk}` : t.pull.url
				const res = await fetch(url, {
					headers: { 'x-vole-blob-token': t.pull.token },
					signal: AbortSignal.timeout(this.offerTtlMs),
				})
				if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
				await this.consumeCipherStream(t, res.body as unknown as NodeJS.ReadableStream, fromChunk)
				await this.finalizeReceive(t)
				return
			} catch (err) {
				if ((t.state as TransferState) === 'cancelled') return
				const dec = t.partialPath ? await this.countCompleteChunks(t) : 0
				fromChunk = dec
				if (attempt < RETRY_DELAYS_MS.length) {
					await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
					continue
				}
				logger.warn(
					`[volenet-files] pull failed for ${t.transferId.substring(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
				)
				await this.sendCtl(t, 'file:error', {
					transferId: t.transferId,
					code: 'pull-unreachable',
				})
				this.failTransfer(t, 'pull-unreachable')
				return
			}
		}
	}

	/** Pipe a ciphertext stream into the partial file (append from a chunk boundary). */
	private async consumeCipherStream(
		t: Transfer,
		body: NodeJS.ReadableStream,
		fromChunk: number,
		budget?: number,
	): Promise<void> {
		if (!t.key || !t.partialPath) throw new Error('transfer not initialized')
		if (fromChunk === 0) await fsp.rm(t.partialPath, { force: true })
		const decrypt = new ChunkDecryptStream(t.key, t.transferId, t.chunkBytes, fromChunk)
		const out = fs.createWriteStream(t.partialPath, { flags: fromChunk > 0 ? 'a' : 'w' })
		t.active = {
			destroy: () => {
				;(body as unknown as { destroy?: () => void }).destroy?.()
				out.destroy()
			},
		}
		t.bytesDone = fromChunk * t.chunkBytes
		decrypt.on('data', (chunk: Buffer) => {
			t.bytesDone += chunk.length
			this.emitProgress(t)
		})
		try {
			if (budget != null) await pipeline(body, byteBudget(budget), decrypt, out)
			else await pipeline(body, decrypt, out)
		} finally {
			t.active = undefined
		}
	}

	/** Count fully-written chunks in the partial (the resume cursor after an interrupt). */
	private async countCompleteChunks(t: Transfer): Promise<number> {
		if (!t.partialPath) return 0
		try {
			const stat = await fsp.stat(t.partialPath)
			const whole = Math.floor(stat.size / t.chunkBytes)
			// Truncate any trailing partial chunk so the append restarts on a boundary.
			await fsp.truncate(t.partialPath, whole * t.chunkBytes)
			return whole
		} catch {
			return 0
		}
	}

	private async finalizeReceive(t: Transfer) {
		if (!t.partialPath) return
		this.touch(t, 'verifying')
		const actualSha = await sha256File(t.partialPath)
		const stat = await fsp.stat(t.partialPath).catch(() => null)
		if (actualSha !== t.sha256 || !stat || stat.size !== t.size) {
			await fsp.rm(t.partialPath, { force: true }).catch(() => {})
			await this.sendCtl(t, 'file:error', {
				transferId: t.transferId,
				code: 'checksum-mismatch',
			})
			this.failTransfer(t, 'checksum-mismatch')
			return
		}
		// Collision-suffixed atomic landing.
		await fsp.mkdir(this.inboxDir(), { recursive: true })
		const ext = path.extname(t.name)
		const stem = t.name.slice(0, t.name.length - ext.length)
		let target = path.join(this.inboxDir(), t.name)
		for (let i = 1; ; i++) {
			try {
				await fsp.access(target)
				target = path.join(this.inboxDir(), `${stem} (${i})${ext}`)
			} catch {
				break
			}
		}
		await fsp.rename(t.partialPath, target)
		t.savedPath = target
		t.bytesDone = t.size
		this.touch(t, 'done')
		this.revokeTokensFor(t.transferId)
		await this.sendCtl(t, 'file:done', { transferId: t.transferId, bytes: t.size })
		if (t.blobId && t.hubId) {
			// Tell the hub it can free the blob now.
			await this.sendDirect(t.hubId, 'relay:blob:done', { blobId: t.blobId })
		}
		this.emit('volenet:file:received', {
			transferId: t.transferId,
			from: t.peerId,
			fromName: t.peerName,
			name: path.basename(target),
			path: target,
			size: t.size,
			sha256: t.sha256,
		})
	}

	// ── Sender: push + relay upload ───────────────────────────────────────────

	private async runPush(t: Transfer) {
		if (!t.push || !t.key || !t.srcPath) return
		this.touch(t, 'transferring')
		for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
			try {
				await this.streamCipherTo(t, t.push.url, t.push.token, { restart: attempt > 0 })
				// Receiver verifies + sends file:done; we stay 'transferring' until then.
				return
			} catch (err) {
				if ((t.state as TransferState) === 'cancelled') return
				if (attempt < RETRY_DELAYS_MS.length) {
					await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
					continue
				}
				logger.warn(
					`[volenet-files] push failed for ${t.transferId.substring(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
				)
				// Last resort: relay, when a common hub exists.
				const hubId = this.opts.getHubForMember(t.peerId)
				if (hubId) {
					t.hubId = hubId
					void this.runRelayUpload(t)
					return
				}
				await this.sendCtl(t, 'file:error', {
					transferId: t.transferId,
					code: 'push-unreachable',
				})
				this.failTransfer(t, 'push-unreachable')
				return
			}
		}
	}

	/** Stream the source file, encrypted, to a blob endpoint (push or hub upload). */
	private async streamCipherTo(
		t: Transfer,
		url: string,
		token: string,
		opts?: { restart?: boolean },
	): Promise<void> {
		if (!t.key || !t.srcPath) throw new Error('transfer not initialized')
		const src = fs.createReadStream(t.srcPath)
		const enc = new ChunkEncryptStream(t.key, t.transferId, t.chunkBytes)
		t.active = { destroy: () => src.destroy() }
		t.bytesDone = 0
		src.on('data', (chunk) => {
			t.bytesDone += (chunk as Buffer).length
			this.emitProgress(t)
		})
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'x-vole-blob-token': token,
					'content-type': 'application/octet-stream',
					...(opts?.restart ? { 'x-vole-restart': '1' } : {}),
				},
				// Node fetch streams request bodies only with duplex:'half'; the DOM lib
				// types don't know either option, hence the cast.
				// biome-ignore lint/suspicious/noExplicitAny: see above
				body: src.pipe(enc) as any,
				duplex: 'half',
				signal: AbortSignal.timeout(this.offerTtlMs),
			} as RequestInit)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
		} finally {
			t.active = undefined
		}
	}

	private async runRelayUpload(t: Transfer) {
		if (!t.key || !t.srcPath || !t.hubId) return
		this.touch(t, 'transferring')
		const grant = await this.requestGrant(t.hubId, 'relay:blob:create', {
			transferId: t.transferId,
			to: t.peerId,
			cipherSize: cipherSizeFor(t.size, t.chunkBytes),
		})
		if ('deny' in grant) {
			await this.sendCtl(t, 'file:error', { transferId: t.transferId, code: 'relay-denied' })
			this.failTransfer(t, 'relay-denied', grant.deny)
			return
		}
		t.blobId = grant.blobId
		try {
			await this.streamCipherTo(t, grant.url, grant.token, {})
		} catch (err) {
			this.failTransfer(t, 'io', err instanceof Error ? err.message : String(err))
			return
		}
		await this.sendCtl(t, 'file:relay-ready', {
			transferId: t.transferId,
			blobId: t.blobId,
			hubId: t.hubId,
		})
	}

	private async runRelayDownload(t: Transfer) {
		if (!t.key || !t.blobId || !t.hubId) return
		this.touch(t, 'transferring')
		const grant = await this.requestGrant(t.hubId, 'relay:blob:fetch', {
			transferId: t.transferId,
			blobId: t.blobId,
		})
		if ('deny' in grant) {
			this.failTransfer(t, 'relay-denied', grant.deny)
			return
		}
		await fsp.mkdir(path.join(this.inboxDir(), '.partial'), { recursive: true })
		t.partialPath = path.join(this.inboxDir(), '.partial', `${t.transferId}.part`)
		let fromChunk = 0
		for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
			try {
				const url = fromChunk > 0 ? `${grant.url}?from=${fromChunk}` : grant.url
				const res = await fetch(url, {
					headers: { 'x-vole-blob-token': grant.token },
					signal: AbortSignal.timeout(this.offerTtlMs),
				})
				if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
				await this.consumeCipherStream(t, res.body as unknown as NodeJS.ReadableStream, fromChunk)
				await this.finalizeReceive(t)
				return
			} catch (err) {
				if ((t.state as TransferState) === 'cancelled') return
				fromChunk = await this.countCompleteChunks(t)
				if (attempt < RETRY_DELAYS_MS.length) {
					await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
					continue
				}
				this.failTransfer(t, 'io', err instanceof Error ? err.message : String(err))
				return
			}
		}
	}

	/** Send a relay:blob request to the hub and await its grant/deny (direct message). */
	private async requestGrant(
		hubId: string,
		type: 'relay:blob:create' | 'relay:blob:fetch',
		payload: Record<string, unknown>,
	): Promise<{ blobId: string; token: string; url: string } | { deny: string }> {
		const key = String(payload.transferId ?? payload.blobId)
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.grantWaiters.delete(key)
				resolve({ deny: 'grant-timeout' })
			}, GRANT_TIMEOUT_MS)
			this.grantWaiters.set(key, {
				resolve: (g) => {
					clearTimeout(timer)
					this.grantWaiters.delete(key)
					resolve(g)
				},
			})
			void this.sendDirect(hubId, type, payload).then((sent) => {
				if (!sent) {
					clearTimeout(timer)
					this.grantWaiters.delete(key)
					resolve({ deny: 'hub-unreachable' })
				}
			})
		})
	}

	private async sendDirect(
		peerId: string,
		type: VoleNetMessage['type'],
		payload: Record<string, unknown>,
	): Promise<boolean> {
		const msg = createMessage(
			type,
			this.me,
			peerId,
			payload,
			this.opts.keyPair.privateKey,
			this.opts.keyPair.pqPrivateKey,
		)
		return this.opts.transport.sendToPeer(peerId, msg)
	}

	private onBlobGrantOrDeny(msg: VoleNetMessage) {
		const p = msg.payload as {
			transferId?: string
			blobId?: string
			token?: string
			url?: string
			reason?: string
		}
		const key = p?.transferId ?? p?.blobId
		const waiter = key ? this.grantWaiters.get(String(key)) : undefined
		if (!waiter) return
		if (msg.type === 'relay:blob:grant' && p.blobId && p.token && p.url) {
			waiter.resolve({ blobId: p.blobId, token: p.token, url: p.url })
		} else {
			waiter.resolve({ deny: p.reason ?? 'denied' })
		}
	}

	// ── Hub: relay-blob policy ────────────────────────────────────────────────

	private hubBlobWindows = new Map<string, number[]>()

	private async hubOnBlobCreate(msg: VoleNetMessage) {
		const p = msg.payload as { transferId?: string; to?: string; cipherSize?: number }
		const deny = (reason: string) =>
			this.sendDirect(msg.from, 'relay:blob:deny', {
				transferId: p?.transferId,
				reason,
			})
		if (!this.blobStore || this.opts.config.enabled === false) {
			await deny('disabled')
			return
		}
		if (!p?.transferId || !p.to || typeof p.cipherSize !== 'number' || p.cipherSize < 0) return
		// The receiver must be a currently-connected member (same rule as relay forwarding).
		const bound = this.opts.transport.getPeers().find((x) => x.peerId === p.to && x.connected)
		if (!bound) {
			await deny('peer-unknown')
			return
		}
		// Reuse the relay pair-rate shape: 6 creates/min/pair.
		const windowKey = `${msg.from}→${p.to}`
		const now = Date.now()
		const win = (this.hubBlobWindows.get(windowKey) ?? []).filter((ts) => now - ts < 60_000)
		if (win.length >= 6) {
			await deny('rate-limited')
			return
		}
		win.push(now)
		this.hubBlobWindows.set(windowKey, win)

		const created = this.blobStore.create(msg.from, p.to, p.transferId, p.cipherSize)
		if ('error' in created) {
			await deny(created.error)
			return
		}
		const token = this.mintToken(created.blobId, msg.from, 'upload')
		await this.sendDirect(msg.from, 'relay:blob:grant', {
			transferId: p.transferId,
			blobId: created.blobId,
			token,
			url: `${this.opts.advertisedEndpoint}/volenet/blob/${created.blobId}`,
			op: 'upload',
		})
	}

	private async hubOnBlobFetch(msg: VoleNetMessage) {
		const p = msg.payload as { transferId?: string; blobId?: string }
		const meta = p?.blobId ? this.blobStore?.get(p.blobId) : undefined
		if (!meta || !meta.complete || meta.to !== msg.from) {
			await this.sendDirect(msg.from, 'relay:blob:deny', {
				blobId: p?.blobId,
				transferId: p?.transferId,
				reason: 'peer-unknown',
			})
			return
		}
		const token = this.mintToken(meta.blobId, msg.from, 'download')
		await this.sendDirect(msg.from, 'relay:blob:grant', {
			transferId: p?.transferId,
			blobId: meta.blobId,
			token,
			url: `${this.opts.advertisedEndpoint}/volenet/blob/${meta.blobId}`,
			op: 'download',
		})
	}

	private hubOnBlobDone(msg: VoleNetMessage) {
		const p = msg.payload as { blobId?: string }
		const meta = p?.blobId ? this.blobStore?.get(p.blobId) : undefined
		if (!meta || meta.to !== msg.from) return
		this.revokeTokensFor(meta.blobId)
		this.blobStore?.delete(meta.blobId)
	}

	// ── The blob HTTP data plane ──────────────────────────────────────────────

	/** Returns true when the request was handled (matched + responded). */
	handleBlobRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		pathname: string,
	): boolean {
		const id = pathname.split('/')[3]
		if (!id || !/^[0-9a-f-]{16,64}$/i.test(id)) return false
		const entry = this.lookupToken(req.headers['x-vole-blob-token'] as string | undefined)
		if (!entry || entry.id !== id) {
			res.writeHead(404)
			res.end()
			return true
		}
		if (this.activeStreams >= (this.opts.config.maxConcurrent ?? 4)) {
			res.writeHead(503)
			res.end()
			return true
		}
		const done = () => {
			this.activeStreams = Math.max(0, this.activeStreams - 1)
		}
		this.activeStreams += 1

		const fail = (status: number) => {
			done()
			if (!res.headersSent) res.writeHead(status)
			res.end()
			return true
		}

		try {
			if (entry.op === 'pull' && req.method === 'GET') {
				void this.serveSenderPull(req, res, entry).finally(done)
				return true
			}
			if (entry.op === 'push' && req.method === 'POST') {
				void this.receivePushUpload(req, res, entry).finally(done)
				return true
			}
			if (entry.op === 'upload' && req.method === 'POST') {
				void this.hubReceiveUpload(req, res, entry).finally(done)
				return true
			}
			if (entry.op === 'download' && req.method === 'GET') {
				void this.hubServeDownload(req, res, entry).finally(done)
				return true
			}
			return fail(404)
		} catch {
			return fail(500)
		}
	}

	/** Sender serving a receiver's pull: encrypt-on-the-fly from a chunk boundary. */
	private async serveSenderPull(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		entry: TokenEntry,
	) {
		const t = this.transfers.get(entry.id)
		if (!t || t.dir !== 'send' || !t.key || !t.srcPath) {
			res.writeHead(404)
			res.end()
			return
		}
		const from = Math.max(
			0,
			Number(new URL(req.url ?? '/', 'http://x').searchParams.get('from') ?? 0) || 0,
		)
		if (from > t.totalChunks) {
			res.writeHead(404)
			res.end()
			return
		}
		this.touch(t, 'transferring')
		const remainingPlain = Math.max(0, t.size - from * t.chunkBytes)
		res.writeHead(200, {
			'content-type': 'application/octet-stream',
			'content-length': String(cipherSizeFor(remainingPlain, t.chunkBytes)),
		})
		const src = fs.createReadStream(t.srcPath, { start: from * t.chunkBytes })
		const enc = new ChunkEncryptStream(t.key, t.transferId, t.chunkBytes, from)
		t.bytesDone = from * t.chunkBytes
		src.on('data', (chunk) => {
			t.bytesDone += (chunk as Buffer).length
			this.emitProgress(t)
		})
		res.on('close', () => src.destroy())
		try {
			await pipeline(src, enc, res)
		} catch {
			/* client went away — its retry resumes via ?from= */
		}
	}

	/** Receiver accepting a sender's push POST. */
	private async receivePushUpload(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		entry: TokenEntry,
	) {
		const t = this.transfers.get(entry.id)
		if (!t || t.dir !== 'recv' || !t.key) {
			res.writeHead(404)
			res.end()
			return
		}
		await fsp.mkdir(path.join(this.inboxDir(), '.partial'), { recursive: true })
		t.partialPath = path.join(this.inboxDir(), '.partial', `${t.transferId}.part`)
		this.touch(t, 'transferring')
		try {
			await this.consumeCipherStream(t, req, 0, cipherSizeFor(t.size, t.chunkBytes) + 4096)
		} catch (err) {
			await fsp.rm(t.partialPath, { force: true }).catch(() => {})
			if (!res.headersSent) res.writeHead(400)
			res.end()
			logger.warn(
				`[volenet-files] push upload failed: ${err instanceof Error ? err.message : String(err)}`,
			)
			return
		}
		res.writeHead(201)
		res.end()
		await this.finalizeReceive(t)
	}

	/** Hub storing a sender's relay upload — opaque frames, byte-budgeted. */
	private async hubReceiveUpload(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		entry: TokenEntry,
	) {
		const meta = this.blobStore?.get(entry.id)
		const out = this.blobStore?.openWrite(entry.id)
		if (!meta || !out || meta.from !== entry.peerId) {
			res.writeHead(404)
			res.end()
			return
		}
		try {
			await pipeline(req, byteBudget(meta.cipherSize + 4096), out)
			if (!this.blobStore?.complete(entry.id)) throw new Error('finalize failed')
		} catch (err) {
			if (!res.headersSent) res.writeHead(400)
			res.end()
			logger.warn(
				`[volenet-files] hub upload failed: ${err instanceof Error ? err.message : String(err)}`,
			)
			return
		}
		this.revokeTokensFor(entry.id) // upload token is spent; download gets its own
		res.writeHead(201)
		res.end()
	}

	/** Hub serving the receiver's download from the stored blob. */
	private async hubServeDownload(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		entry: TokenEntry,
	) {
		const meta = this.blobStore?.get(entry.id)
		const storedPath = this.blobStore?.storedPath(entry.id)
		if (!meta || !storedPath || meta.to !== entry.peerId) {
			res.writeHead(404)
			res.end()
			return
		}
		const from = Math.max(
			0,
			Number(new URL(req.url ?? '/', 'http://x').searchParams.get('from') ?? 0) || 0,
		)
		let offset = 0
		try {
			offset = await scanFrameOffset(storedPath, from)
		} catch {
			res.writeHead(404)
			res.end()
			return
		}
		const stream = this.blobStore?.openRead(entry.id, offset)
		if (!stream) {
			res.writeHead(404)
			res.end()
			return
		}
		res.writeHead(200, {
			'content-type': 'application/octet-stream',
			'content-length': String(meta.cipherSize - offset),
		})
		res.on('close', () => stream.destroy())
		try {
			await pipeline(stream, res)
		} catch {
			/* receiver retries with ?from= */
		}
	}

	// ── Housekeeping ──────────────────────────────────────────────────────────

	private sweepTransfers() {
		const now = Date.now()
		for (const t of this.transfers.values()) {
			const terminal = ['done', 'rejected', 'failed', 'cancelled', 'expired'].includes(t.state)
			if (!terminal && now - t.createdAt > this.offerTtlMs) {
				t.active?.destroy()
				this.touch(t, 'expired')
				this.revokeTokensFor(t.transferId)
				if (t.partialPath) void fsp.rm(t.partialPath, { force: true }).catch(() => {})
				void this.sendCtl(t, 'file:error', {
					transferId: t.transferId,
					code: 'expired',
				}).catch(() => {})
			}
			// Drop terminal records after 24h so the list can't grow forever.
			if (terminal && now - t.updatedAt > 24 * 60 * 60_000) this.transfers.delete(t.transferId)
		}
	}

	/** Delete a sent file's source ONLY when it lives in our upload spool. */
	private async cleanupOutboxSource(t: Transfer) {
		if (!t.srcPath) return
		const outbox = this.outboxDir()
		if (t.srcPath.startsWith(outbox + path.sep)) {
			await fsp.rm(t.srcPath, { force: true }).catch(() => {})
		}
	}

	/** TTL sweep of the dashboard-upload spool (orphaned uploads). */
	private async sweepOutbox() {
		const outbox = this.outboxDir()
		try {
			const entries = await fsp.readdir(outbox)
			const now = Date.now()
			for (const name of entries) {
				const p = path.join(outbox, name)
				const stat = await fsp.stat(p).catch(() => null)
				if (stat?.isFile() && now - stat.mtimeMs > 24 * 60 * 60_000) {
					await fsp.rm(p, { force: true }).catch(() => {})
				}
			}
		} catch {
			/* no outbox yet */
		}
	}
}
