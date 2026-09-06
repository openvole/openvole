import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sessionKey } from '../src/config.js'
import { Inbox, MAX_MESSAGES } from '../src/inbox.js'

/**
 * One log, a cursor per reader.
 *
 * The identity is per machine, so several editor sessions share it — which is the point, since
 * pairing once is why an identity exists. What they must not share is being *caught up*: one
 * session opening its inbox marking the messages seen for every other session is the bug these
 * are here to prevent.
 */

const dir = async () => fs.mkdtemp(path.join(os.tmpdir(), 'volenet-mcp-'))
const msg = (over: Partial<Parameters<Inbox['add']>[0]> = {}) => ({
	peerId: 'p1',
	peerName: 'agent-b',
	dir: 'in' as const,
	text: 'hello',
	ts: 1000,
	id: 'm1',
	...over,
})

describe('Inbox', () => {
	it('keeps what arrived, across restarts, without duplicating a replay', async () => {
		const d = await dir()
		const box = new Inbox(d, 'a')
		await box.load()

		expect(await box.add(msg())).toBe(true)
		expect(await box.add(msg())).toBe(false) // same signed id — a flush or replay, not a message
		expect(box.size).toBe(1)

		const reopened = new Inbox(d, 'a')
		await reopened.load()
		expect(reopened.history('p1')).toHaveLength(1)
		expect(reopened.history('p1')[0]?.text).toBe('hello')
	})

	it('shows what this session has not seen, once', async () => {
		const box = new Inbox(await dir(), 'a')
		await box.load()
		await box.add(msg({ id: 'm1', ts: 1000 }))
		await box.add(msg({ id: 'm2', ts: 2000, text: 'again' }))
		await box.add(msg({ id: 'out', ts: 3000, dir: 'out', text: 'mine' }))

		expect(box.unread().map((m) => m.text)).toEqual(['hello', 'again'])
		await box.markRead()
		expect(box.unread()).toHaveLength(0)

		await box.add(msg({ id: 'm3', ts: 4000, text: 'later' }))
		expect(box.unread().map((m) => m.text)).toEqual(['later'])
	})

	it('does not consume another session’s messages', async () => {
		const d = await dir()
		const one = new Inbox(d, 'project-one')
		const two = new Inbox(d, 'project-two')
		await one.load()
		await two.load()

		await one.add(msg({ id: 'm1', ts: 1000, text: 'for everyone' }))
		await one.markRead()
		expect(one.unread()).toHaveLength(0)

		// The other session was never told, so it still has it waiting.
		await two.refresh()
		expect(two.unread().map((m) => m.text)).toEqual(['for everyone'])
		await two.markRead()
		expect(two.unread()).toHaveLength(0)
	})

	it('sees what another session appended, without losing its own', async () => {
		const d = await dir()
		const one = new Inbox(d, 'one')
		const two = new Inbox(d, 'two')
		await one.load()
		await two.load()

		// Concurrent writers: an append cannot lose the other's line the way a rewrite would.
		await one.add(msg({ id: 'a', ts: 1000, text: 'from one' }))
		await two.add(msg({ id: 'b', ts: 2000, text: 'from two' }))

		await one.refresh()
		expect(one.history('p1').map((m) => m.text)).toEqual(['from one', 'from two'])
		expect(two.history('p1').map((m) => m.text)).toEqual(['from one', 'from two'])
	})

	it('reads a cursor back from disk, so a restart does not replay the inbox', async () => {
		const d = await dir()
		const box = new Inbox(d, 'a')
		await box.load()
		await box.add(msg())
		await box.markRead()

		const reopened = new Inbox(d, 'a')
		await reopened.load()
		expect(reopened.unread()).toHaveLength(0)
	})

	it('summarises peers by recency, counting only what this session has not seen', async () => {
		const box = new Inbox(await dir(), 'a')
		await box.load()
		await box.add(msg({ id: 'a', ts: 1000, peerId: 'p1', peerName: 'agent-b' }))
		await box.add(msg({ id: 'b', ts: 5000, peerId: 'p2', peerName: 'peer' }))
		await box.add(msg({ id: 'c', ts: 6000, peerId: 'p2', peerName: 'peer' }))

		const list = box.peers()
		expect(list.map((p) => p.peerName)).toEqual(['peer', 'agent-b'])
		expect(list[0]?.unread).toBe(2)
	})

	it('drops the oldest rather than growing without limit', async () => {
		const box = new Inbox(await dir(), 'a')
		await box.load()
		for (let i = 0; i < MAX_MESSAGES + 5; i++) {
			await box.add(msg({ id: `m${i}`, ts: i + 1 }))
		}
		expect(box.size).toBeLessThanOrEqual(MAX_MESSAGES)
		expect(box.history('p1', MAX_MESSAGES).at(-1)?.id).toBe(`m${MAX_MESSAGES + 4}`)
	})
})

describe('upgrading from the single-cursor format', () => {
	it('carries the messages over, and does not carry the old read state', async () => {
		const d = await dir()
		// What an earlier version wrote: messages and one read state for every session.
		await fs.writeFile(
			path.join(d, 'inbox.json'),
			JSON.stringify({
				messages: [msg({ id: 'old', ts: 1000, text: 'said before the upgrade' })],
				readAt: { p1: 9999 },
			}),
		)

		const box = new Inbox(d, 'a')
		await box.load()
		expect(box.history('p1').map((m) => m.text)).toEqual(['said before the upgrade'])
		// The old cursor covered every session at once, so honouring it would mark this seen for
		// sessions that never saw it. Unread is the safe direction.
		expect(box.unread()).toHaveLength(1)

		// The old file is kept, renamed, rather than deleted.
		await expect(fs.access(path.join(d, 'inbox.json.migrated'))).resolves.toBeUndefined()
		// And a second load does not import it twice.
		const again = new Inbox(d, 'b')
		await again.load()
		expect(again.history('p1')).toHaveLength(1)
	})
})

describe('sessionKey', () => {
	it('is stable for a directory and different between them', () => {
		expect(sessionKey('/home/u/project-one')).toBe(sessionKey('/home/u/project-one'))
		expect(sessionKey('/home/u/project-one')).not.toBe(sessionKey('/home/u/project-two'))
		// Same basename, different place — the hash is what keeps them apart.
		expect(sessionKey('/a/work')).not.toBe(sessionKey('/b/work'))
		expect(sessionKey('/a/work')).toMatch(/^work-[0-9a-f]{8}$/)
	})
})

describe('a cursor moved by another process', () => {
	it('is picked up, because a hook marks read in a process of its own', async () => {
		const d = await dir()
		const server = new Inbox(d, 'shared')
		await server.load()
		await server.add(msg({ id: 'm1', ts: 1000 }))
		expect(server.unread()).toHaveLength(1)

		// What the hook does: same session key, its own process, marks them seen.
		const hook = new Inbox(d, 'shared')
		await hook.load()
		await hook.markRead()

		// The long-lived server must notice, or it reports as unread what has been shown already.
		await server.refresh()
		expect(server.unread()).toHaveLength(0)
	})

	it('never moves a cursor backwards', async () => {
		const d = await dir()
		const a = new Inbox(d, 'shared')
		await a.load()
		await a.add(msg({ id: 'm1', ts: 1000 }))
		await a.add(msg({ id: 'm2', ts: 2000 }))
		await a.markRead() // a is at 2000

		const b = new Inbox(d, 'shared')
		await b.load()
		await b.add(msg({ id: 'm3', ts: 3000 }))
		await b.markRead() // b writes 3000

		// a re-reading must take the later of the two, not fall back to what it held.
		await a.refresh()
		expect(a.unread()).toHaveLength(0)
	})
})
