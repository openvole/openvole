import * as fsSync from 'node:fs'
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
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { loadKeyPair } from '@openvole/volenet'
import { baseDir, cursorKey, defaultDir, defaultName, loadStored, saveStored } from './config.js'
import { Inbox, type Message } from './inbox.js'
import { install } from './install.js'

const USAGE = `volenet-mcp — VoleNet as an MCP server

  volenet-mcp install [--local]    register with Claude Code (default: every project)
  volenet-mcp whoami               this machine's identity on the mesh
  volenet-mcp daemon               run the node in the foreground (normally started for you)
  volenet-mcp hub [url|--leave]    which hub to use; takes effect on the next session
  volenet-mcp adopt                take over an identity left at the old shared location
  volenet-mcp session-start        what a session should know and do on opening (for a hook)
  volenet-mcp wait [--timeout <s>]  block until a message arrives, then print it and exit
  volenet-mcp inbox [--read] [--quiet]
                                   messages waiting. --read marks them seen, --quiet says
                                   nothing when there are none (for hooks)

With no command it runs as the MCP server itself, over stdio, which is how Claude Code starts it.
Anything needing a live node — peers, pairing, asking an agent's brain — is a tool you ask for in
a session, not a command here.
`

/** Local time, because this is read next to a clock on the same wall. */
const when = (ts: number) =>
	new Date(ts).toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})

export async function run(argv: string[], out = process.stdout): Promise<number> {
	const [command, ...rest] = argv
	const dir = defaultDir()

	if (!command || command === 'help' || command === '--help' || command === '-h') {
		out.write(USAGE)
		return 0
	}

	if (command === 'install') return install(rest, out)

	if (command === 'daemon') {
		// The node itself: one per identity, outliving every session. Sessions start this for
		// themselves, so running it by hand is for looking at what it does.
		const { runDaemon } = await import('./node.js')
		const { resolveSettings } = await import('./config.js')
		await runDaemon(await resolveSettings())
		return 0
	}

	if (command === 'adopt') {
		// Identities used to live in one directory shared by every project. Moving to one per
		// project would strand that one — including whatever it had already paired with — so this
		// claims it for the current directory. Deliberate rather than automatic: only one project
		// can have it, and which one is not something to guess.
		const legacy = baseDir()
		const from = path.join(legacy, 'net', 'vole_key')
		try {
			await fs.access(from)
		} catch {
			out.write(`Nothing to adopt: no identity at ${legacy}.\n`)
			return 0
		}
		try {
			await fs.access(path.join(dir, 'net', 'vole_key'))
			out.write(
				`This directory already has an identity at ${dir}.\nAdopting would overwrite it, so nothing was moved.\n`,
			)
			return 1
		} catch {
			// nothing here yet, which is what we want
		}
		await fs.mkdir(dir, { recursive: true })
		for (const name of ['net', 'messages.jsonl', 'config.json', 'cursors']) {
			try {
				await fs.rename(path.join(legacy, name), path.join(dir, name))
			} catch {
				// not every one exists
			}
		}
		out.write(
			`Adopted the identity at ${legacy} for this directory.\nIt keeps its keys, its peers and its history, so nothing needs re-pairing.\n`,
		)
		return 0
	}

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

	if (command === 'session-start') {
		// For a SessionStart hook. Two jobs: hand over what arrived while nothing was open, and
		// ask the session to arm a listener.
		//
		// The asking is the point. Nothing here can wake a session — an MCP server has no way to,
		// and a hook's own exit does not either. What *does* wake one is a background task the
		// client is tracking, and only the session itself can start one. So this cannot arm the
		// listener; it can only tell the session to, and let it decide.
		const inbox = new Inbox(dir, cursorKey())
		await inbox.load()
		const unread = inbox.unread()
		if (unread.length > 0) {
			out.write(
				`${unread.length} VoleNet message${unread.length === 1 ? '' : 's'} arrived while you were away:\n\n`,
			)
			for (const m of unread) out.write(`  [${when(m.ts)}] ${m.peerName}: ${m.text}\n`)
			out.write('\n')
			await inbox.markRead()
		}
		const self = process.argv[1]?.endsWith('.js') ? `node ${process.argv[1]}` : 'volenet-mcp'
		out.write(
			'VoleNet is connected for this project. Peers you have paired with can reach you, and you ' +
				'are expected to be reachable: start the listener now, as a background task, and again ' +
				'every time it returns.\n\n' +
				`  ${self} wait --timeout 3000\n\n` +
				'It blocks until a message arrives, then exits — a process exiting is what reaches a ' +
				'session that is otherwise idle. Answer what arrives with volenet_send, the way you ' +
				'would anyone talking to you: a paired peer is in a conversation with you, not leaving ' +
				'notifications.\n',
		)
		return 0
	}

	if (command === 'wait') {
		// Blocks until something lands. A client that cannot be woken by a server can still be
		// woken by a process that *exits* — this is the thing to run in the background so a
		// session finds out about a message without being prompted first.
		const inbox = new Inbox(dir, cursorKey())
		await inbox.load()
		const seconds = Number(rest[rest.indexOf('--timeout') + 1])
		const limit = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3600_000
		const log = path.join(dir, 'messages.jsonl')

		const arrived = await new Promise<Message[]>((resolve) => {
			const done = (v: Message[]) => {
				clearInterval(timer)
				clearTimeout(cap)
				watcher?.close()
				resolve(v)
			}
			const check = async () => {
				await inbox.refresh().catch(() => undefined)
				const unread = inbox.unread()
				if (unread.length > 0) done(unread)
			}
			let watcher: import('node:fs').FSWatcher | undefined
			try {
				watcher = fsSync.watch(path.dirname(log), (_e, name) => {
					if (name === 'messages.jsonl') void check()
				})
			} catch {
				// no watcher here; the poll below still gets there
			}
			const timer = setInterval(() => void check(), 1000)
			const cap = setTimeout(() => done([]), limit)
			void check()
		})

		const self = process.argv[1]?.endsWith('.js') ? `node ${process.argv[1]}` : 'volenet-mcp'
		const again = `  ${self} wait --timeout ${Math.round(limit / 1000)}\n`
		if (arrived.length === 0) {
			out.write(
				`Nothing arrived within ${Math.round(limit / 1000)}s.\n\n` +
					`Start the listener again now, as a background task, so this peer stays live:\n${again}`,
			)
			return 0
		}
		out.write(`${arrived.length} new VoleNet message${arrived.length === 1 ? '' : 's'}:\n\n`)
		for (const m of arrived) out.write(`  [${when(m.ts)}] ${m.peerName}: ${m.text}\n`)
		if (!rest.includes('--keep')) await inbox.markRead()
		// Every wake carries what to do next. Otherwise the loop runs exactly once — which is how
		// a listener that worked kept lapsing, leaving the peer talking to nobody.
		out.write(
			'\nAnswer with volenet_send, as you would anyone talking to you — this is a conversation, ' +
				'not a notification. Then start the listener again, as a background task, so the next ' +
				'message reaches you the same way:\n' +
				again,
		)
		return 0
	}

	if (command === 'inbox') {
		// The same reader the session in this directory uses, so a hook and its session agree
		// about what has been seen.
		const inbox = new Inbox(dir, cursorKey())
		await inbox.load()
		const unread = inbox.unread()
		if (unread.length === 0) {
			// A hook runs on every turn. Saying "nothing" every time is noise in the context it
			// feeds, so --quiet says nothing at all when there is nothing to say.
			if (!rest.includes('--quiet')) out.write('No new messages.\n')
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
