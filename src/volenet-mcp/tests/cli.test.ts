import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/cli.js'
import { loadStored } from '../src/config.js'
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
		const inbox = new Inbox(path.join(dir, 'inbox.json'))
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

	it('refuses an unknown command', async () => {
		const { code, text } = await call('frobnicate')
		expect(code).toBe(1)
		expect(text).toContain('Unknown command')
	})
})
