import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Inbox, MAX_MESSAGES } from '../src/inbox.js'

const tmp = async () =>
	path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-mcp-')), 'inbox.json')
const msg = (over: Partial<Parameters<Inbox['add']>[0]> = {}) => ({
	peerId: 'p1',
	peerName: 'alice',
	dir: 'in' as const,
	text: 'hello',
	ts: 1000,
	id: 'm1',
	...over,
})

describe('Inbox', () => {
	it('keeps what arrived, across restarts, without duplicating a replay', async () => {
		const file = await tmp()
		const box = new Inbox(file)
		await box.load()

		expect(await box.add(msg())).toBe(true)
		expect(await box.add(msg())).toBe(false) // same signed id — a flush or replay, not a message
		expect(box.size).toBe(1)

		const reopened = new Inbox(file)
		await reopened.load()
		expect(reopened.history('p1')).toHaveLength(1)
		expect(reopened.history('p1')[0]?.text).toBe('hello')
	})

	it('shows what the session has not seen, once', async () => {
		const box = new Inbox(await tmp())
		await box.load()
		await box.add(msg({ id: 'm1', ts: 1000 }))
		await box.add(msg({ id: 'm2', ts: 2000, text: 'again' }))
		await box.add(msg({ id: 'out', ts: 3000, dir: 'out', text: 'mine' }))

		expect(box.unread().map((m) => m.text)).toEqual(['hello', 'again'])
		await box.markRead()
		expect(box.unread()).toHaveLength(0)

		// Something newer arrives after the read, and only that is new.
		await box.add(msg({ id: 'm3', ts: 4000, text: 'later' }))
		expect(box.unread().map((m) => m.text)).toEqual(['later'])
	})

	it('reads a read cursor back from disk, so a restart does not replay the inbox', async () => {
		const file = await tmp()
		const box = new Inbox(file)
		await box.load()
		await box.add(msg())
		await box.markRead()

		const reopened = new Inbox(file)
		await reopened.load()
		expect(reopened.unread()).toHaveLength(0)
	})

	it('summarises peers by recency, counting only what is unread', async () => {
		const box = new Inbox(await tmp())
		await box.load()
		await box.add(msg({ id: 'a', ts: 1000, peerId: 'p1', peerName: 'alice' }))
		await box.add(msg({ id: 'b', ts: 5000, peerId: 'p2', peerName: 'bob' }))
		await box.add(msg({ id: 'c', ts: 6000, peerId: 'p2', peerName: 'bob' }))

		const list = box.peers()
		expect(list.map((p) => p.peerName)).toEqual(['bob', 'alice'])
		expect(list[0]?.unread).toBe(2)
	})

	it('drops the oldest rather than growing without limit', async () => {
		const box = new Inbox(await tmp())
		await box.load()
		for (let i = 0; i < MAX_MESSAGES + 5; i++) {
			await box.add(msg({ id: `m${i}`, ts: i + 1 }))
		}
		expect(box.size).toBe(MAX_MESSAGES)
		expect(box.history('p1', MAX_MESSAGES)[0]?.id).toBe('m5')
	})
})
