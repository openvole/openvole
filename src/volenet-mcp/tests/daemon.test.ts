import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { connect, remoteNet, serve, socketPath } from '../src/daemon.js'
import { Inbox } from '../src/inbox.js'
import type { NetLike } from '../src/net-api.js'
import { lingerMs, startLocal } from '../src/node.js'

/**
 * A node that outlives the session that wanted it.
 *
 * The point of a daemon is that several sessions share one identity, and that quitting one does not
 * take the node down with it. It does not outlive all of them: an identity still listed as online
 * with nobody there to answer is a worse lie than being away. These check both halves — a session
 * can attach to a node it did not start and leave without ending it, and the daemon is told when
 * the last one has gone.
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

describe('leaving when the last session does', () => {
	it('reports the first attach and the last detach', async () => {
		// What the roster shows other people depends on this: a daemon that never leaves means an
		// identity that is online long after there is anybody there to answer.
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-idle-'))
		const inbox = new Inbox(dir, 'daemon')
		await inbox.load()
		const node = await startLocal({ name: 'daemon', dir, port: 0, session: 'daemon' }, inbox)
		const events: string[] = []
		const server = await serve(dir, node.net, {
			onBusy: () => events.push('busy'),
			onIdle: () => events.push('idle'),
		})
		servers.push({
			close: () => {
				server.close()
				void node.stop()
			},
		})

		const first = await connect(dir)
		const second = await connect(dir)
		expect(events).toEqual(['busy', 'busy'])

		// One session going does not empty the house.
		first?.destroy()
		await new Promise((r) => setTimeout(r, 80))
		expect(events).toEqual(['busy', 'busy'])

		second?.destroy()
		await new Promise((r) => setTimeout(r, 80))
		expect(events).toEqual(['busy', 'busy', 'idle'])
	})

	it('reads how long to linger, and honours a request to stay', () => {
		expect(lingerMs(undefined)).toBe(20_000)
		expect(lingerMs('')).toBe(20_000)
		expect(lingerMs('5')).toBe(5000)
		expect(lingerMs('0')).toBe(0)
		// The machine whose whole job is being reachable.
		expect(lingerMs('forever')).toBeNull()
		// Nonsense falls back rather than leaving instantly.
		expect(lingerMs('soon')).toBe(20_000)
		expect(lingerMs('-3')).toBe(20_000)
	})
})

describe('a daemon that goes away under a live session', () => {
	it('fails a call made after the line died, instead of hanging on it', async () => {
		// The shape of a real hang: the daemon leaves, the session stays, and the next tool call
		// waits for an answer nobody is going to send.
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-dead-'))
		const inbox = new Inbox(dir, 'daemon')
		await inbox.load()
		const node = await startLocal({ name: 'daemon', dir, port: 0, session: 'daemon' }, inbox)
		const server = await serve(dir, node.net)
		const conn = await connect(dir)
		if (!conn) throw new Error('no connection')
		// No dir passed: nowhere to reconnect to, so it must fail rather than wait.
		const net = remoteNet(conn)

		server.close()
		await node.stop()
		conn.destroy()
		await new Promise((r) => setTimeout(r, 50))

		await expect(net.identity()).rejects.toThrow()
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('reopens the line when it knows where to look', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-again-'))
		const inbox = new Inbox(dir, 'daemon')
		await inbox.load()
		const node = await startLocal({ name: 'daemon', dir, port: 0, session: 'daemon' }, inbox)
		const first = await serve(dir, node.net)
		const conn = await connect(dir)
		if (!conn) throw new Error('no connection')
		const net = remoteNet(conn, dir)
		expect(await net.identity()).toBeTruthy()

		// The daemon goes. A second one comes up on the same socket, as a restart would.
		first.close()
		conn.destroy()
		await new Promise((r) => setTimeout(r, 50))
		const second = await serve(dir, node.net)
		servers.push({
			close: () => {
				second.close()
				void node.stop()
			},
		})

		// Same handle, new line underneath, no reconnect asked for by the caller.
		expect(await net.identity()).toBeTruthy()
		await fs.rm(dir, { recursive: true, force: true })
	})
})

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
