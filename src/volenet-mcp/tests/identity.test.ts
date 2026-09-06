import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { baseDir, defaultDir, defaultName, sessionKey } from '../src/config.js'
import { startNode } from '../src/node.js'

/**
 * One identity per project directory.
 *
 * Pairing is per identity, so sharing one across projects makes every session the same
 * participant: the peer you paired with cannot tell them apart, and each reads the others'
 * conversations. Two projects are two correspondents. Two sessions in one project are one.
 */

let saved: Record<string, string | undefined>
beforeEach(() => {
	saved = { dir: process.env.VOLENET_MCP_DIR, nodaemon: process.env.VOLENET_MCP_NO_DAEMON }
	process.env.VOLENET_MCP_NO_DAEMON = '1'
	delete process.env.VOLENET_MCP_DIR
})
afterEach(() => {
	for (const [k, v] of [
		['VOLENET_MCP_DIR', saved.dir],
		['VOLENET_MCP_NO_DAEMON', saved.nodaemon],
	] as const) {
		if (v === undefined) delete process.env[k]
		else process.env[k] = v
	}
})

describe('identity is per directory', () => {
	it('gives two projects two directories, and one project one', () => {
		const a = defaultDir('/home/u/project-one')
		const b = defaultDir('/home/u/project-two')
		expect(a).not.toBe(b)
		expect(defaultDir('/home/u/project-one')).toBe(a)
		expect(a.startsWith(baseDir())).toBe(true)

		// Same basename in different places must not collide, or two projects share an identity.
		expect(defaultDir('/a/work')).not.toBe(defaultDir('/b/work'))
		expect(sessionKey('/a/work')).toMatch(/^work-[0-9a-f]{8}$/)
	})

	it('names the peer after the project, not the machine', () => {
		// A hostname says nothing useful to whoever is on the other end, and puts a laptop's name
		// on other people's rosters.
		expect(defaultName('/home/u/my-project')).toBe('claude-my-project')
		expect(defaultName('/home/u/Odd Name!')).toBe('claude-odd-name-')
	})

	it('lets an override share one identity deliberately', () => {
		process.env.VOLENET_MCP_DIR = '/tmp/shared'
		expect(defaultDir('/home/u/one')).toBe('/tmp/shared')
		expect(defaultDir('/home/u/two')).toBe('/tmp/shared')
	})

	it('really is a different keypair, and a different conversation', async () => {
		const base = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-ident-'))
		const one = await startNode({
			name: 'one',
			dir: path.join(base, 'one'),
			port: 0,
			session: 'session',
		})
		const two = await startNode({
			name: 'two',
			dir: path.join(base, 'two'),
			port: 0,
			session: 'session',
		})
		try {
			const a = await one.net.identity()
			const b = await two.net.identity()
			expect(a?.instanceId).toBeTruthy()
			// Different peers: whoever pairs with one has not paired with the other.
			expect(a?.instanceId).not.toBe(b?.instanceId)

			// And a message to one is not in the other's history.
			await one.inbox.add({
				peerId: 'p',
				peerName: 'agent-b',
				dir: 'in',
				text: 'for project one only',
				ts: 1000,
				id: 'm1',
			})
			await two.inbox.refresh()
			expect(one.inbox.unread().map((m) => m.text)).toEqual(['for project one only'])
			expect(two.inbox.unread()).toEqual([])
		} finally {
			await one.stop()
			await two.stop()
		}
	}, 40000)
})

describe('a peer learned by pairing', () => {
	it('is remembered and dialled again, so a restart does not go dark', async () => {
		const { loadStored, rememberPeer } = await import('../src/config.js')
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-peers-'))

		// Pairing records the address. Trust lives in the keystore; this is only where to find them.
		await rememberPeer(dir, 'http://10.0.0.5:9700/')
		expect((await loadStored(dir)).peers).toEqual(['http://10.0.0.5:9700'])

		// Idempotent — re-pairing must not grow the list.
		await rememberPeer(dir, 'http://10.0.0.5:9700')
		expect((await loadStored(dir)).peers).toHaveLength(1)

		await rememberPeer(dir, 'http://10.0.0.6:9700')
		expect((await loadStored(dir)).peers).toHaveLength(2)
	})
})
