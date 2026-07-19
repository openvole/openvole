import * as http from 'node:http'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager } from '../../src/net/index.js'
import { generateKeyPair } from '../../src/net/keys.js'

/**
 * End-to-end proof of `net.publicUrl`: a hub listening on a raw port behind a real
 * prefix-stripping reverse proxy (HTTP + WebSocket upgrade, exactly what the docs'
 * nginx config does), advertising the PROXY url. The joiner only ever configured the
 * proxy URL — it must end up knowing the hub by its advertised (proxied) endpoint,
 * with a live connection, never touching the raw port directly.
 */

const HUB_RAW = 19741
const PROXY = 19742
const JOINER = 19743
const PUBLIC_URL = `http://127.0.0.1:${PROXY}/mesh`

let hub: VoleNetManager
let joiner: VoleNetManager
let proxy: http.Server

/** Minimal nginx stand-in: strips the /mesh prefix, forwards HTTP and WS upgrades. */
function startProxy(): Promise<http.Server> {
	const strip = (u: string | undefined) => (u ?? '/').replace(/^\/mesh\/?/, '/') || '/'
	const srv = http.createServer((req, res) => {
		const fwd = http.request(
			{
				host: '127.0.0.1',
				port: HUB_RAW,
				path: strip(req.url),
				method: req.method,
				headers: req.headers,
			},
			(r) => {
				res.writeHead(r.statusCode ?? 502, r.headers)
				r.pipe(res)
			},
		)
		fwd.on('error', () => res.destroy())
		req.pipe(fwd)
	})
	srv.on('upgrade', (req, socket, head) => {
		const up = net.connect(HUB_RAW, '127.0.0.1', () => {
			const headers = Object.entries(req.headers)
				.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
				.join('\r\n')
			up.write(`GET ${strip(req.url)} HTTP/1.1\r\n${headers}\r\n\r\n`)
			if (head?.length) up.write(head)
			socket.pipe(up)
			up.pipe(socket)
		})
		up.on('error', () => socket.destroy())
		socket.on('error', () => up.destroy())
	})
	return new Promise((resolve) => srv.listen(PROXY, () => resolve(srv)))
}

async function until(cond: () => boolean, ms = 18000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error('condition not met in time')
		await new Promise((r) => setTimeout(r, 100))
	}
}

beforeAll(async () => {
	const root = await import('node:fs/promises').then(async (fs) => {
		const d = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-publicurl-'))
		await fs.mkdir(path.join(d, 'hub/.openvole/net'), { recursive: true })
		await fs.mkdir(path.join(d, 'joiner/.openvole/net'), { recursive: true })
		return d
	})
	const hubDir = path.join(root, 'hub')
	const joinerDir = path.join(root, 'joiner')

	// Keys + mutual trust (what `vole net trust` / `vole net join` set up).
	const hubKeys = await generateKeyPair(path.join(hubDir, '.openvole/net'), 'hub')
	const joinerKeys = await generateKeyPair(path.join(joinerDir, '.openvole/net'), 'joiner')
	const { trustPeer } = await import('../../src/net/keys.js')
	await trustPeer(path.join(hubDir, '.openvole/net'), joinerKeys.publicKeyString)
	await trustPeer(path.join(joinerDir, '.openvole/net'), hubKeys.publicKeyString)

	proxy = await startProxy()

	// The hub listens on the raw port but ADVERTISES the proxy URL.
	hub = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'hub',
			role: 'coordinator',
			port: HUB_RAW,
			publicUrl: PUBLIC_URL,
		},
		hubDir,
	)
	await hub.start()

	// The joiner is configured with the proxy URL only — it must never need the raw port.
	joiner = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'joiner',
			role: 'peer',
			port: JOINER,
			peers: [{ url: PUBLIC_URL, trust: 'full' }],
		},
		joinerDir,
	)
	await joiner.start()
}, 20000)

afterAll(async () => {
	await joiner?.stop?.()
	await hub?.stop?.()
	await new Promise((r) => proxy?.close(r))
})

describe('publicUrl end-to-end (hub behind a prefix-stripping reverse proxy)', () => {
	it(
		'joiner discovers the hub THROUGH the proxy and records the advertised (proxied) endpoint',
		{ timeout: 20000 },
		async () => {
			await until(() => joiner.getInstances().some((i) => i.name === 'hub'))
			const hubSeen = joiner.getInstances().find((i) => i.name === 'hub')
			expect(hubSeen?.endpoint).toBe(PUBLIC_URL)
		},
	)

	it(
		'hub learns the joiner from traffic that arrived via the proxy',
		{ timeout: 20000 },
		async () => {
			await until(() => hub.getInstances().some((i) => i.name === 'joiner'))
			expect(hub.getInstances().find((i) => i.name === 'joiner')).toBeTruthy()
		},
	)

	it(
		'the transport-level peer entry uses the proxied endpoint, not the raw port',
		{ timeout: 20000 },
		async () => {
			// biome-ignore lint/suspicious/noExplicitAny: reaching into the transport is the point of the test
			const transport = (joiner as any).transport
			await until(() => transport.getPeers().length > 0)
			const peer = transport.getPeers()[0]
			expect(peer.endpoint).toBe(PUBLIC_URL)
			expect(peer.endpoint).not.toContain(String(HUB_RAW))
		},
	)

	it(
		'a live connection is established through the proxy (WebSocket upgrade or HTTP fallback)',
		{ timeout: 20000 },
		async () => {
			// biome-ignore lint/suspicious/noExplicitAny: reaching into the transport is the point of the test
			const transport = (joiner as any).transport
			await until(() => transport.getPeers().some((p: { connected: boolean }) => p.connected))
			expect(transport.getPeers()[0].connected).toBe(true)
		},
	)
})
