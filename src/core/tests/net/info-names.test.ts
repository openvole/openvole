import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair, trustPeer } from '../../src/net/keys.js'

/**
 * Opt-in name publishing on /volenet/info. External tooling (e.g. the club wall generator) can read
 * live announced names from the endpoint it already fetches — but only when net.publishNames is set,
 * since names are an enumeration surface. Default off: the field is absent.
 */

const A = 19861 // publishes names
const B = 19862 // does not

let a: VoleNetManager
let b: VoleNetManager

async function until(cond: () => boolean, ms = 15000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error('condition not met in time')
		await new Promise((r) => setTimeout(r, 100))
	}
}
// biome-ignore lint/suspicious/noExplicitAny: reading a manager's own instanceId in-test
const id8 = (m: VoleNetManager) => ((m as any).keyPair.instanceId as string).substring(0, 8)

async function info(port: number): Promise<{ peers: Array<{ id: string; name?: string }> }> {
	return (await fetch(`http://127.0.0.1:${port}/volenet/info`).then((r) => r.json())) as {
		peers: Array<{ id: string; name?: string }>
	}
}

beforeAll(async () => {
	const fsp = await import('node:fs/promises')
	const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vole-infonames-'))
	const dirs: Record<string, string> = {}
	const k: Record<string, Awaited<ReturnType<typeof generateKeyPair>>> = {}
	for (const n of ['a', 'b']) {
		dirs[n] = path.join(root, n)
		await fsp.mkdir(path.join(dirs[n], '.openvole/net'), { recursive: true })
		k[n] = await generateKeyPair(path.join(dirs[n], '.openvole/net'), n)
	}
	await trustPeer(path.join(dirs.a, '.openvole/net'), k.b.publicKeyString)
	await trustPeer(path.join(dirs.b, '.openvole/net'), k.a.publicKeyString)

	a = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'member-a',
			role: 'peer',
			port: A,
			publishNames: true,
			peers: [{ url: `http://127.0.0.1:${B}`, trust: 'full' }],
		},
		dirs.a,
	)
	b = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'member-b',
			role: 'peer',
			port: B,
			// publishNames omitted → default off
			peers: [{ url: `http://127.0.0.1:${A}`, trust: 'full' }],
		},
		dirs.b,
	)
	await a.start()
	await b.start()
	await until(() => a.getInstances().some((i) => i.name === 'member-b'))
	await until(() => b.getInstances().some((i) => i.name === 'member-a'))
}, 40000)

afterAll(async () => {
	await a?.stop?.()
	await b?.stop?.()
})

describe('/volenet/info name publishing', () => {
	it('publishes the peer display name when net.publishNames is on', async () => {
		const peers = (await info(A)).peers
		const peerB = peers.find((p) => p.id === id8(b))
		expect(peerB).toBeTruthy()
		expect(peerB?.name).toBe('member-b') // the live announced instanceName
	})

	it('omits the name field by default (enumeration surface stays closed)', async () => {
		const peers = (await info(B)).peers
		const peerA = peers.find((p) => p.id === id8(a))
		expect(peerA).toBeTruthy()
		expect('name' in (peerA ?? {})).toBe(false)
	})
})
