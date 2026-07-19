import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMessageBus } from '../../src/core/bus.js'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair, trustPeer } from '../../src/net/keys.js'
import { ToolRegistry } from '../../src/tool/registry.js'

/**
 * The exact club shape: a hub sharing tools to a guest trusted only via authorized_voles (no
 * net.peers entry — how a publicJoin guest is trusted). Covers both grant paths:
 *   - `share.tools: true` delivers; `false` (no publicJoin) delivers nothing — the live club now.
 *   - `publicJoin.trustLevel: "tool"` grants tools even without share.tools (bug fix); `"read"` does not.
 * `share.toolAllow` curates which tools in every case.
 */

const HUB = 19811
const GUEST = 19812

let hub: VoleNetManager
let guest: VoleNetManager
let guestReg: ToolRegistry

async function until(cond: () => boolean, ms = 12000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) return
		await new Promise((r) => setTimeout(r, 150))
	}
}

async function boot(shareTools: boolean, publicJoinTrust?: 'read' | 'tool') {
	const fsp = await import('node:fs/promises')
	const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vole-share-'))
	const hubDir = path.join(root, 'hub')
	const guestDir = path.join(root, 'guest')
	await fsp.mkdir(path.join(hubDir, '.openvole/net'), { recursive: true })
	await fsp.mkdir(path.join(guestDir, '.openvole/net'), { recursive: true })
	const hk = await generateKeyPair(path.join(hubDir, '.openvole/net'), 'club')
	const gk = await generateKeyPair(path.join(guestDir, '.openvole/net'), 'guest')
	// authorized_voles only — the guest is NOT in the hub's net.peers (publicJoin trust shape)
	await trustPeer(path.join(hubDir, '.openvole/net'), gk.publicKeyString)
	await trustPeer(path.join(guestDir, '.openvole/net'), hk.publicKeyString)

	const hubReg = new ToolRegistry(createMessageBus())
	hubReg.register(
		'paw-club',
		[
			{
				name: 'club_read',
				description: 'Read the wall',
				// biome-ignore lint/suspicious/noExplicitAny: minimal tool stub
				parameters: { parse: () => ({}) } as any,
				execute: async () => ({ ok: true }),
			},
		],
		false,
	)
	const h = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'club',
			role: 'coordinator',
			port: HUB,
			// toolAllow curates regardless; `tools` and publicJoin.trustLevel are the two ways
			// a guest is granted tool access.
			share: { tools: shareTools, toolAllow: ['club_*'], memory: false },
			...(publicJoinTrust ? { publicJoin: { enabled: true, trustLevel: publicJoinTrust } } : {}),
		},
		hubDir,
	)
	await h.start(hubReg)

	const gReg = new ToolRegistry(createMessageBus())
	const g = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'guest',
			role: 'peer',
			port: GUEST,
			peers: [{ url: `http://127.0.0.1:${HUB}`, trust: 'full' }],
		},
		guestDir,
	)
	await g.start(gReg)
	return { h, g, gReg }
}

describe('tool sharing to a publicJoin-style guest (the club regression)', () => {
	describe('share.tools: true', () => {
		beforeAll(async () => {
			const b = await boot(true)
			hub = b.h
			guest = b.g
			guestReg = b.gReg
			await until(() => (guest.getRemoteTools?.() ?? []).length > 0)
		}, 30000)
		afterAll(async () => {
			await guest?.stop?.()
			await hub?.stop?.()
		})

		it('the guest receives the hub club_read tool', () => {
			expect((guest.getRemoteTools?.() ?? []).map((t) => t.name)).toContain('club_read')
		})
		it('and it lands in the guest local registry (remote tools become local)', () => {
			expect(guestReg.list().some((t) => t.name === 'club_read')).toBe(true)
		})
	})

	describe('share.tools: false, no publicJoin — the hub declines (the live club right now)', () => {
		beforeAll(async () => {
			const b = await boot(false)
			hub = b.h
			guest = b.g
			// give discovery + tool:list a fair chance; expect it to stay empty
			await new Promise((r) => setTimeout(r, 6000))
		}, 30000)
		afterAll(async () => {
			await guest?.stop?.()
			await hub?.stop?.()
		})

		it('the guest connects but receives NO tools', () => {
			expect(guest.getInstances().some((i) => i.name === 'club')).toBe(true) // connected
			expect(guest.getRemoteTools?.() ?? []).toHaveLength(0) // but nothing shared
		})
	})

	describe('publicJoin trustLevel "tool" grants tools WITHOUT share.tools (the bug fix)', () => {
		beforeAll(async () => {
			const b = await boot(false, 'tool')
			hub = b.h
			guest = b.g
			await until(() => (guest.getRemoteTools?.() ?? []).length > 0)
		}, 30000)
		afterAll(async () => {
			await guest?.stop?.()
			await hub?.stop?.()
		})

		it('the guest receives club_read via its granted trustLevel, curated by toolAllow', () => {
			expect((guest.getRemoteTools?.() ?? []).map((t) => t.name)).toContain('club_read')
		})
	})

	describe('publicJoin trustLevel "read" does NOT grant tools', () => {
		beforeAll(async () => {
			const b = await boot(false, 'read')
			hub = b.h
			guest = b.g
			await new Promise((r) => setTimeout(r, 6000))
		}, 30000)
		afterAll(async () => {
			await guest?.stop?.()
			await hub?.stop?.()
		})

		it('a read-only guest gets no tools', () => {
			expect(guest.getInstances().some((i) => i.name === 'club')).toBe(true)
			expect(guest.getRemoteTools?.() ?? []).toHaveLength(0)
		})
	})
})
