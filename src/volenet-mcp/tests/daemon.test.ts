import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { connect, remoteNet, serve, socketPath } from '../src/daemon.js'
import { Inbox } from '../src/inbox.js'
import type { NetLike } from '../src/net-api.js'
import { startLocal } from '../src/node.js'

/**
 * A node that outlives the session that wanted it.
 *
 * The point of a daemon is presence: an identity that only exists while an editor is open is
 * offline most of the time, so senders hold their messages and nothing arrives until you come
 * back. These check that a session can attach to a node it did not start, act through it, and go
 * away without taking it with them.
 */

const servers: Array<{ close: () => void }> = []
afterEach(() => {
	for (const s of servers.splice(0)) s.close()
})

async function daemonOn(dir: string): Promise<NetLike> {
	const inbox = new Inbox(dir, 'daemon')
	await inbox.load()
	const node = await startLocal({ name: 'daemon', dir, port: 0, session: 'daemon' }, inbox)
	const server = await serve(dir, node.net)
	servers.push({
		close: () => {
			server.close()
			void node.stop()
		},
	})
	return node.net
}

describe('the daemon', () => {
	it('answers a session that did not start it, and keeps its identity', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-daemon-'))
		const local = await daemonOn(dir)
		const mine = await local.identity()

		// A session attaches over the socket and sees the same node.
		const conn = await connect(dir)
		expect(conn).not.toBeNull()
		const remote = remoteNet(conn!)
		expect((await remote.identity())?.instanceId).toBe(mine?.instanceId)
		expect(await remote.instances()).toEqual([])
		expect(await remote.listPairRequests()).toEqual([])

		// The session goes away. The node does not.
		conn?.destroy()
		await new Promise((r) => setTimeout(r, 100))
		expect((await local.identity())?.instanceId).toBe(mine?.instanceId)

		// And another session can attach afterwards.
		const second = await connect(dir)
		expect(second).not.toBeNull()
		expect((await remoteNet(second!).identity())?.instanceId).toBe(mine?.instanceId)
		second?.destroy()
	}, 40000)

	it('reports a failure as a failure rather than hanging the caller', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-daemon-err-'))
		await daemonOn(dir)
		const remote = remoteNet((await connect(dir))!)
		// Nothing is listening there, so the probe fails — and must come back, not hang.
		const res = await remote.probePair('http://127.0.0.1:1')
		expect(res.ok).toBe(false)
		expect(res.error).toBeTruthy()
	}, 40000)

	it('is not there when nothing is serving, so a session can fall back', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-daemon-none-'))
		expect(await connect(dir)).toBeNull()
		// A stale socket file from a dead daemon must not read as a live one either.
		await fs.writeFile(socketPath(dir), '')
		expect(await connect(dir)).toBeNull()
	}, 20000)
})
