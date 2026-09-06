import * as path from 'node:path'
/**
 * The command line, for the things you want before a session exists — or without one.
 *
 * Everything here works on files alone: no node is started, no port is bound, nothing dials out.
 * That is deliberate. The MCP server may well be running while you type these, and a second node
 * on the same identity would fight it for the port; and a `SessionStart` hook has to be safe to
 * run every single time a session opens.
 *
 * So `hub` records a choice that the next node start acts on, and `inbox` reads what has already
 * been written. Anything that genuinely needs the network — the roster, pairing, asking a brain —
 * is a tool, because it needs a live node and a conversation to happen in.
 */
import { loadKeyPair } from '@openvole/volenet'
import { defaultDir, defaultName, loadStored, saveStored } from './config.js'
import { Inbox } from './inbox.js'
import { install } from './install.js'

const USAGE = `volenet-mcp — VoleNet as an MCP server

  volenet-mcp install [--local]    register with Claude Code (default: every project)
  volenet-mcp whoami               this machine's identity on the mesh
  volenet-mcp hub [url|--leave]    which hub to use; takes effect on the next session
  volenet-mcp inbox [--read]       messages waiting, for catching up or a SessionStart hook

With no command it runs as the MCP server itself, over stdio, which is how Claude Code starts it.
Anything needing a live node — peers, pairing, asking an agent's brain — is a tool you ask for in
a session, not a command here.
`

const when = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16)

export async function run(argv: string[], out = process.stdout): Promise<number> {
	const [command, ...rest] = argv
	const dir = defaultDir()

	if (!command || command === 'help' || command === '--help' || command === '-h') {
		out.write(USAGE)
		return 0
	}

	if (command === 'install') return install(rest, out)

	if (command === 'whoami') {
		const stored = await loadStored(dir)
		const keys = await loadKeyPair(path.join(dir, 'net')).catch(() => null)
		if (!keys) {
			out.write(
				`No identity yet at ${dir}.\nOne is generated the first time the server runs — start a session, or ask for volenet_whoami.\n`,
			)
			return 0
		}
		out.write(
			[
				`name        ${stored.name ?? defaultName()}`,
				`instanceId  ${keys.instanceId}`,
				`hub         ${stored.hub ?? '(none — set one with: volenet-mcp hub <url>)'}`,
				`store       ${dir}`,
				'',
				'That directory is your identity. Back it up; anyone who has it is you.',
				'',
			].join('\n'),
		)
		return 0
	}

	if (command === 'hub') {
		const stored = await loadStored(dir)
		if (rest.includes('--leave')) {
			if (!stored.hub) {
				out.write('Not on a hub.\n')
				return 0
			}
			await saveStored(dir, { hub: undefined })
			out.write(`Left ${stored.hub}. Your identity and direct pairings are untouched.\n`)
			return 0
		}
		const url = rest.find((a) => !a.startsWith('-'))
		if (!url) {
			out.write(stored.hub ? `${stored.hub}\n` : 'No hub set. Give one: volenet-mcp hub <url>\n')
			return 0
		}
		await saveStored(dir, { hub: url.replace(/\/$/, '') })
		out.write(
			`Hub set to ${url}.\nIt is joined the next time the server starts — restart Claude Code, or ask for volenet_hub to do it now.\n`,
		)
		return 0
	}

	if (command === 'inbox') {
		const inbox = new Inbox(path.join(dir, 'inbox.json'))
		await inbox.load()
		const unread = inbox.unread()
		if (unread.length === 0) {
			out.write('No new messages.\n')
			return 0
		}
		out.write(`${unread.length} new VoleNet message${unread.length === 1 ? '' : 's'}:\n\n`)
		for (const m of unread) {
			out.write(`  [${when(m.ts)}] ${m.peerName}: ${m.text}\n`)
		}
		// Marking is opt-in: a hook that puts these in context should mark them, an operator
		// glancing at the inbox should not silently hide them from the next session.
		if (rest.includes('--read')) await inbox.markRead()
		out.write('\n')
		return 0
	}

	out.write(`Unknown command: ${command}\n\n${USAGE}`)
	return 1
}
