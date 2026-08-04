import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMessageBus } from '../../src/core/bus.js'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair, trustPeer } from '../../src/net/keys.js'
import { createMessage } from '../../src/net/protocol.js'
import { ToolRegistry } from '../../src/tool/registry.js'

/**
 * Regression: two peers sharing the SAME tool name (every agent runs paw-memory, so
 * memory_* collides mesh-wide) made every 15s discovery cycle re-register remote tools:
 *   - tool:registered bus spam on each cycle (dashboard Live Events flooded),
 *   - registry conflict auto-prefix minting mangled "__volenet:x___x/tool" names,
 *   - the plain-name alias re-renamed to whichever peer announced last (wrong owner).
 * Fixed by: same-paw re-registration replaces silently (registry), rename-once with the
 * recorded owner only, and idempotent prefixed registration (net).
 */

const A = 19911
const B = 19912
const V = 19913

let a: VoleNetManager
let b: VoleNetManager
let v: VoleNetManager
let vReg: ToolRegistry
let registeredEvents: Array<{ toolName: string; pawName: string }>

async function until(cond: () => boolean, ms = 15000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		// Throw, never return silently: a swallowed timeout here let a slow suite setup
		// masquerade as an instant assertion failure in the first test (the roster wait gave
		// up quietly, then sendFile failed fast) — a flake with a misleading stack.
		if (Date.now() - t0 > ms) throw new Error(`until(): not met within ${ms}ms — ${cond}`)
		await new Promise((r) => setTimeout(r, 150))
	}
}

function memoryTool() {
	return [
		{
			name: 'memory_read',
			description: 'Read memory',
			// biome-ignore lint/suspicious/noExplicitAny: minimal tool stub
			parameters: { parse: () => ({}) } as any,
			execute: async () => ({ ok: true }),
		},
	]
}

/** Ask a peer for its tool list — the exact request every discovery cycle repeats. */
async function requestTools(from: VoleNetManager, toId: string) {
	// biome-ignore lint/suspicious/noExplicitAny: test reaches into internals to drive a cycle
	const m = from as any
	await m.transport.sendToPeer(
		toId,
		createMessage(
			'tool:list',
			m.keyPair.instanceId,
			toId,
			{},
			m.keyPair.privateKey,
			m.keyPair.pqPrivateKey,
		),
	)
}

beforeAll(async () => {
	const fsp = await import('node:fs/promises')
	const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vole-dedup-'))
	const dirs = { a: path.join(root, 'a'), b: path.join(root, 'b'), v: path.join(root, 'v') }
	for (const d of Object.values(dirs)) await fsp.mkdir(path.join(d, '.openvole/net'), { recursive: true })
	const ka = await generateKeyPair(path.join(dirs.a, '.openvole/net'), 'peer-a')
	const kb = await generateKeyPair(path.join(dirs.b, '.openvole/net'), 'peer-b')
	const kv = await generateKeyPair(path.join(dirs.v, '.openvole/net'), 'viewer')
	// full mutual trust
	for (const [dir, keys] of [
		[dirs.a, [kb, kv]],
		[dirs.b, [ka, kv]],
		[dirs.v, [ka, kb]],
	] as const) {
		for (const k of keys) await trustPeer(path.join(dir, '.openvole/net'), k.publicKeyString)
	}

	const regA = new ToolRegistry(createMessageBus())
	regA.register('paw-memory', memoryTool(), false)
	a = new VoleNetManager(
		{ enabled: true, instanceName: 'peer-a', role: 'peer', port: A, share: { tools: true } },
		dirs.a,
	)
	await a.start(regA)

	const regB = new ToolRegistry(createMessageBus())
	regB.register('paw-memory', memoryTool(), false)
	b = new VoleNetManager(
		{ enabled: true, instanceName: 'peer-b', role: 'peer', port: B, share: { tools: true } },
		dirs.b,
	)
	await b.start(regB)

	const vBus = createMessageBus()
	registeredEvents = []
	vBus.on('tool:registered', (e) => {
		const ev = e as { toolName: string; pawName: string }
		if (ev.pawName.startsWith('__volenet')) registeredEvents.push(ev)
	})
	vReg = new ToolRegistry(vBus)
	v = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'viewer',
			role: 'peer',
			port: V,
			peers: [
				{ url: `http://127.0.0.1:${A}`, trust: 'full' },
				{ url: `http://127.0.0.1:${B}`, trust: 'full' },
			],
		},
		dirs.v,
	)
	await v.start(vReg)

	// Wait until the viewer has registered remote tools from BOTH peers (initial cycle).
	await until(() => {
		const names = vReg.list().map((t) => t.name)
		return names.includes('peer-a/memory_read') && names.includes('peer-b/memory_read')
	})
}, 40000)

afterAll(async () => {
	await Promise.all([a?.stop(), b?.stop(), v?.stop()])
})

describe('remote tool dedup across discovery cycles', () => {
	it('converges: both peers prefixed, plain load-balanced alias, correct owners', () => {
		const names = vReg.list().map((t) => t.name)
		expect(names).toContain('peer-a/memory_read')
		expect(names).toContain('peer-b/memory_read')
		expect(names).toContain('memory_read') // plain alias lives on, load-balanced
	})

	it('re-announcements are silent: no new registrations, no mangled names', async () => {
		// biome-ignore lint/suspicious/noExplicitAny: internals for the test drive
		const aId = (a as any).keyPair.instanceId as string
		// biome-ignore lint/suspicious/noExplicitAny: internals for the test drive
		const bId = (b as any).keyPair.instanceId as string

		const before = registeredEvents.length
		// Drive three full extra announce cycles — what the 15s ticker does in production.
		for (let i = 0; i < 3; i++) {
			await requestTools(v, aId)
			await requestTools(v, bId)
			await new Promise((r) => setTimeout(r, 400))
		}

		expect(registeredEvents.length).toBe(before) // zero new tool:registered events

		const names = vReg.list().map((t) => t.name)
		// No registry-conflict mangles like "__volenet:peer_a___peer-a/memory_read"
		expect(names.filter((n) => n.startsWith('__volenet'))).toEqual([])
		// No cross-owner mislabels: peer-a's prefix belongs to peer-a's paw label, etc.
		const tools = vReg.list()
		const pa = tools.find((t) => t.name === 'peer-a/memory_read')
		const pb = tools.find((t) => t.name === 'peer-b/memory_read')
		expect(pa?.pawName).toBe('__volenet:peer-a__')
		expect(pb?.pawName).toBe('__volenet:peer-b__')
		// And the tool set is stable — exactly one plain alias + one per peer.
		const memoryNames = names.filter((n) => n.includes('memory_read'))
		expect(memoryNames.sort()).toEqual(['memory_read', 'peer-a/memory_read', 'peer-b/memory_read'])
	})
})
