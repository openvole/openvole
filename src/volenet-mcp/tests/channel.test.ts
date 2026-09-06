import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Inbox, type Message } from '../src/inbox.js'
import { createServer, startChannel } from '../src/index.js'
import type { Node } from '../src/node.js'
import { waitForMessages, watchInbox } from '../src/watch.js'

/**
 * The channel is the only thing here that reaches a session nobody is typing in.
 *
 * Everything else — a hook, a background task that exits — gets a word in at a moment somebody
 * else chose. So what matters in these tests is that an arriving message turns into a push without
 * anything asking, that our own sent messages do not come back at us, and that a failed push
 * leaves the message unread rather than dropping it.
 */

let dir: string

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-channel-'))
})

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true })
})

const message = (over: Partial<Message> = {}): Message => ({
	peerId: 'p1',
	peerName: 'agent-b',
	dir: 'in',
	text: 'are you there',
	ts: Date.now(),
	id: `m${Math.random().toString(36).slice(2)}`,
	...over,
})

/** Enough of a Node for the channel, which only ever touches the inbox and the directory. */
const fakeNode = (inbox: Inbox): Node => ({ inbox, options: { dir } }) as unknown as Node

/** A server stand-in that records what was pushed, and can be made to fail. */
const recorder = () => {
	const sent: Array<{ content: string; meta: Record<string, string> }> = []
	let fail = false
	return {
		sent,
		breakIt: () => {
			fail = true
		},
		mendIt: () => {
			fail = false
		},
		server: {
			notification: async (n: {
				method: string
				params: { content: string; meta: Record<string, string> }
			}) => {
				if (fail) throw new Error('transport closed')
				expect(n.method).toBe('notifications/claude/channel')
				sent.push(n.params)
			},
			// biome-ignore lint/suspicious/noExplicitAny: a stand-in for the SDK's Server
		} as any,
	}
}

const settle = () => new Promise((r) => setTimeout(r, 60))

describe('the channel capability', () => {
	it('declares claude/channel, which is what makes the client listen', () => {
		const inbox = new Inbox(dir, 'session')
		const server = createServer(fakeNode(inbox))
		const caps = server.getCapabilities?.() as
			| { experimental?: Record<string, unknown> }
			| undefined
		expect(caps?.experimental?.['claude/channel']).toEqual({})
	})

	it('tells the session a peer is talking to it, not leaving a notification', () => {
		const inbox = new Inbox(dir, 'session')
		const server = createServer(fakeNode(inbox))
		// The instructions are how the model learns to answer rather than acknowledge, so they are
		// part of the contract, not a comment.
		const text = (server as unknown as { _instructions?: string })._instructions ?? ''
		expect(text).toContain('volenet_send')
		expect(text).toContain('not an alert')
	})
})

describe('pushing arrivals into a session', () => {
	it('pushes a message that arrives, with the peer as an attribute', async () => {
		const inbox = new Inbox(dir, 'session')
		await inbox.load()
		const { server, sent } = recorder()
		const stop = startChannel(server, fakeNode(inbox))

		await inbox.add(message({ text: 'hello' }))
		await settle()
		stop()

		expect(sent).toHaveLength(1)
		expect(sent[0].content).toBe('hello')
		expect(sent[0].meta).toEqual({ peer: 'agent-b', peer_id: 'p1' })
	})

	it('never pushes back what we sent, which would have it answering itself', async () => {
		const inbox = new Inbox(dir, 'session')
		await inbox.load()
		const { server, sent } = recorder()
		const stop = startChannel(server, fakeNode(inbox))

		await inbox.add(message({ dir: 'out', text: 'my own reply' }))
		await settle()
		stop()

		expect(sent).toHaveLength(0)
	})

	it('marks pushed messages read, so a hook does not show them a second time', async () => {
		const inbox = new Inbox(dir, 'session')
		await inbox.load()
		const { server } = recorder()
		const stop = startChannel(server, fakeNode(inbox))

		await inbox.add(message())
		await settle()
		stop()

		await inbox.refresh()
		expect(inbox.unread()).toHaveLength(0)
	})

	it('leaves a message unread when the push fails, and delivers it on the next tick', async () => {
		const inbox = new Inbox(dir, 'session')
		await inbox.load()
		const { server, sent, breakIt, mendIt } = recorder()
		breakIt()
		const stop = startChannel(server, fakeNode(inbox))

		await inbox.add(message({ text: 'do not lose me' }))
		await settle()
		expect(sent).toHaveLength(0)
		await inbox.refresh()
		expect(inbox.unread()).toHaveLength(1)

		mendIt()
		await new Promise((r) => setTimeout(r, 1200))
		stop()
		expect(sent.map((s) => s.content)).toEqual(['do not lose me'])
	})
})

describe('watching the inbox', () => {
	it('waits until something lands, then resolves with it', async () => {
		const inbox = new Inbox(dir, 'session')
		await inbox.load()
		const pending = waitForMessages(inbox, dir, 5000)

		await new Promise((r) => setTimeout(r, 30))
		await inbox.add(message({ text: 'landed' }))

		const got = await pending
		expect(got.map((m) => m.text)).toEqual(['landed'])
	})

	it('gives up empty-handed at the timeout rather than hanging', async () => {
		const inbox = new Inbox(dir, 'session')
		await inbox.load()
		expect(await waitForMessages(inbox, dir, 150)).toEqual([])
	})

	it('leaves messages unread when asked to only peek', async () => {
		const inbox = new Inbox(dir, 'session')
		await inbox.load()
		const pending = waitForMessages(inbox, dir, 5000, { markRead: false })
		await inbox.add(message())
		await pending

		await inbox.refresh()
		expect(inbox.unread()).toHaveLength(1)
	})

	it('does not hand the same message to two overlapping deliveries', async () => {
		const inbox = new Inbox(dir, 'session')
		await inbox.load()
		const seen: string[] = []
		// A slow handler is where a double delivery would show up: the poll fires again while the
		// first call is still running, and the cursor has not moved yet.
		const stop = watchInbox(inbox, dir, async (messages) => {
			for (const m of messages) seen.push(m.text)
			await new Promise((r) => setTimeout(r, 300))
		})

		await inbox.add(message({ text: 'once' }))
		await new Promise((r) => setTimeout(r, 900))
		stop()

		expect(seen).toEqual(['once'])
	})
})
