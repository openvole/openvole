import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/cli.js'
import { loadStored, sessionKey } from '../src/config.js'
import { Inbox } from '../src/inbox.js'

/**
 * The command line does file work only — no node, no port, no dialling.
 *
 * That is what makes it safe to run while the MCP server is up, and safe for a SessionStart hook
 * that fires every time a session opens.
 */

const capture = () => {
	const lines: string[] = []
	return { sink: { write: (s: string) => lines.push(s) }, text: () => lines.join('') }
}

let dir: string
let prev: string | undefined

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'volenet-cli-'))
	prev = process.env.VOLENET_MCP_DIR
	process.env.VOLENET_MCP_DIR = dir
})

afterEach(() => {
	if (prev === undefined) delete process.env.VOLENET_MCP_DIR
	else process.env.VOLENET_MCP_DIR = prev
})

const call = async (...argv: string[]) => {
	const { sink, text } = capture()
	const code = await run(argv, sink as NodeJS.WriteStream)
	return { code, text: text() }
}

describe('volenet-mcp CLI', () => {
	it('explains itself, and says which things are tools rather than commands', async () => {
		const { code, text } = await call()
		expect(code).toBe(0)
		expect(text).toContain('volenet-mcp install')
		expect(text).toContain('not a command here')
	})

	it('sets, reports and clears the hub without starting anything', async () => {
		expect((await call('hub')).text).toContain('No hub set')

		const set = await call('hub', 'https://hub.example.com/mesh/')
		expect(set.text).toContain('next time the server starts')
		expect((await loadStored(dir)).hub).toBe('https://hub.example.com/mesh')
		expect((await call('hub')).text.trim()).toBe('https://hub.example.com/mesh')

		expect((await call('hub', '--leave')).text).toContain('Left')
		expect(await loadStored(dir)).toEqual({})
	})

	it('says plainly when there is no identity yet, rather than inventing one', async () => {
		const { text } = await call('whoami')
		expect(text).toContain('No identity yet')
		expect(text).toContain('generated the first time')
	})

	it('reads the inbox, and only marks it read when asked', async () => {
		// The same reader the CLI uses for this directory, so a hook and its session agree.
		const inbox = new Inbox(dir, sessionKey())
		await inbox.load()
		await inbox.add({
			peerId: 'p1',
			peerName: 'agent-b',
			dir: 'in',
			text: 'hello',
			ts: Date.now(),
			id: 'm1',
		})

		const glance = await call('inbox')
		expect(glance.text).toContain('agent-b: hello')
		// A glance must not hide it from the session that opens next.
		expect((await call('inbox')).text).toContain('agent-b: hello')

		await call('inbox', '--read')
		expect((await call('inbox')).text).toContain('No new messages')
	})

	it('says nothing at all when quiet and there is nothing', async () => {
		// This runs on every turn from a hook; "No new messages" each time is noise in the very
		// context it exists to feed.
		expect((await call('inbox', '--quiet')).text).toBe('')
		expect((await call('inbox')).text).toContain('No new messages')
	})

	it('hands over what arrived while nothing was open, and asks for a listener', async () => {
		const inbox = new Inbox(dir, sessionKey())
		await inbox.load()
		await inbox.add({
			peerId: 'p1',
			peerName: 'agent-b',
			dir: 'in',
			text: 'are you there',
			ts: Date.now(),
			id: 'm1',
		})

		const { text } = await call('session-start')
		expect(text).toContain('agent-b: are you there')
		expect(text).toContain('wait --timeout')
	})

	it('under --catch-up it reports and stops, because something else is listening', async () => {
		// The plugin form. A channel push or a monitor is already carrying messages in, so asking
		// the session to arm a background waiter would only produce a second listener.
		const inbox = new Inbox(dir, sessionKey())
		await inbox.load()
		await inbox.add({
			peerId: 'p1',
			peerName: 'agent-b',
			dir: 'in',
			text: 'are you there',
			ts: Date.now(),
			id: 'm1',
		})

		const { text } = await call('session-start', '--catch-up')
		expect(text).toContain('agent-b: are you there')
		expect(text).toContain('volenet_send')
		expect(text).not.toContain('wait --timeout')
		expect(text).not.toContain('background task')
	})

	it('says nothing under --catch-up when nothing was missed', async () => {
		expect((await call('session-start', '--catch-up')).text).toBe('')
	})

	it('lists listen as the monitor form and wait as the fallback', async () => {
		const { text } = await call()
		expect(text).toContain('volenet-mcp listen')
		expect(text).toContain('for a monitor')
	})

	it('listen delivers the backlog too, so a race with the hook cannot lose it', async () => {
		// Which of the SessionStart hook and the monitor starts first is the client's business, and
		// they share one read cursor. If listen skipped what was already there, every race it won
		// would silently discard the night's messages.
		const inbox = new Inbox(dir, sessionKey())
		await inbox.load()
		await inbox.add({
			peerId: 'p1',
			peerName: 'agent-b',
			dir: 'in',
			text: 'arrived\novernight',
			ts: Date.now(),
			id: 'm1',
		})
		await inbox.add({
			peerId: 'p2',
			peerName: 'agent-b',
			dir: 'out',
			text: 'my own reply',
			ts: Date.now(),
			id: 'm2',
		})

		// It never returns by design, so let it run and read what it wrote.
		const { sink, text } = capture()
		void run(['listen'], sink as NodeJS.WriteStream)
		await new Promise((r) => setTimeout(r, 400))

		// One line per message — a newline is what ends a notification — and nothing we sent.
		expect(text()).toBe('agent-b: arrived overnight\n')
	})

	it('refuses an unknown command', async () => {
		const { code, text } = await call('frobnicate')
		expect(code).toBe(1)
		expect(text).toContain('Unknown command')
	})
})
