/**
 * `npx @openvole/volenet-mcp install` — register this server with Claude Code.
 *
 * Setup used to be a line carrying three environment flags whose values a new user had no way to
 * know yet: their name on the mesh, a hub, a port. None of that belongs in an install command. The
 * name has a sensible default, the port only matters to peers that can dial you, and the hub is a
 * decision better made from inside a session, where `volenet_hub` joins one and remembers it.
 *
 * So this takes no configuration. It shells out to the `claude` CLI when that is on PATH, and
 * otherwise prints the line to paste — guessing at another tool's config file is how you corrupt
 * one. It never inherits stdin: an installer that can block on a prompt is not a one-shot command.
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export const SERVER_NAME = 'volenet'
const PACKAGE = '@openvole/volenet-mcp'

/**
 * How this server should be launched, from wherever `install` was itself run.
 *
 * Not simply "is this a .js file": run through `npx`, the entry *is* a .js file, but one living
 * in a transient cache that npm is free to evict — registering that path would work until it
 * suddenly did not. What distinguishes the cases is `node_modules`: an installed copy is always
 * under one and should be launched by package name, while a build in a working tree is not and
 * has to be launched by path, since there is nothing published to resolve.
 */
export function launchCommand(entry = process.argv[1]): string[] {
	const installed =
		!entry || !entry.endsWith('.js') || entry.includes(`${path.sep}node_modules${path.sep}`)
	return installed ? ['npx', '-y', PACKAGE] : ['node', entry]
}

/** The `claude mcp add` arguments, as a pure value so a test can check them without running one. */
export function addArgs(scope: 'user' | 'local', command: string[]): string[] {
	return ['mcp', 'add', SERVER_NAME, '-s', scope, '--', ...command]
}

/**
 * The hooks that make a session hear anything.
 *
 * Without these, installing the server gives a session tools it will only reach for when asked: a
 * message arrives and nothing says so. These are what turn it into something you are actually
 * *on* — told what you missed when a session opens, told about arrivals while you work, and asked
 * to start the one thing that can reach a session sitting idle.
 *
 * `SessionStart` asks rather than acts, because nothing outside a session can wake one, and the
 * thing that can — a background task the client is tracking — only the session can start.
 */
const HOOKS: Record<string, string> = {
	SessionStart: 'session-start',
	UserPromptSubmit: 'inbox --read --quiet',
	PostToolUse: 'inbox --read --quiet',
}

/** Where Claude Code keeps user settings, honouring CLAUDE_CONFIG_DIR when it is set. */
function settingsPath(): string {
	const dir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude')
	return path.join(dir, 'settings.json')
}

/**
 * Add the hooks, leaving everything else in the file as it was.
 *
 * Backed up first, and idempotent: an entry this installer wrote before is replaced rather than
 * duplicated, and hooks belonging to anything else are never touched.
 */
/**
 * What the hooks should run, which is not what the server should.
 *
 * The server is spawned once per session, so `npx` resolving the package each time costs nothing.
 * A hook is spawned after *every tool call* — and `npx` takes about 2.3 seconds against 0.13 for a
 * binary already on PATH. Eighteen times over, on every tool, is not a tax worth paying for
 * tidiness: a resolvable binary wins, and npx is the fallback.
 */
export function hookCommand(command: string[]): string[] {
	const onPath = spawnSync('which', ['volenet-mcp'], { stdio: ['ignore', 'pipe', 'ignore'] })
	return onPath.status === 0 ? ['volenet-mcp'] : command
}

export function installHooks(command: string[], out: { write: (s: string) => unknown }): string[] {
	const file = settingsPath()
	let settings: Record<string, unknown> = {}
	try {
		settings = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
	} catch {
		// no settings yet, or unreadable — a fresh object is the right starting point
	}
	if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-volenet`)

	const hooks = (settings.hooks ?? {}) as Record<string, Array<Record<string, unknown>>>
	const runner = hookCommand(command)
	const added: string[] = []
	for (const [event, args] of Object.entries(HOOKS)) {
		const line = `${runner.join(' ')} ${args}`
		const kept = (hooks[event] ?? []).filter((e) => !JSON.stringify(e).includes('volenet-mcp'))
		kept.push({ hooks: [{ type: 'command', command: line }] })
		hooks[event] = kept
		added.push(event)
	}
	settings.hooks = hooks
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
	out.write(
		`Hooks added to ${file} (${added.join(', ')}), running \`${runner.join(' ')}\`; ` +
			'the previous file is kept as .bak-volenet.\n' +
			(runner[0] === 'volenet-mcp'
				? ''
				: 'Tip: `npm i -g @openvole/volenet-mcp` makes these hooks about eighteen times faster, ' +
					'which matters because one of them runs after every tool call.\n'),
	)
	return added
}

const NEXT_STEPS =
	'\nRestart Claude Code — MCP servers load at startup — then:\n\n' +
	'  volenet_whoami             who you are on the mesh (an identity is made on first run)\n' +
	'  volenet_hub url:"..."      join a hub, to be reachable from anywhere\n' +
	'  volenet_connect url:"..."  or pair directly with an agent you can dial\n\n' +
	'Nothing else needs configuring.\n'

/** One run of the `claude` CLI. Injectable so a test can check what would be done, not do it. */
export interface ClaudeRun {
	stdout?: string
	stderr?: string
	status?: number | null
	error?: Error
}
export type ClaudeExec = (args: string[]) => ClaudeRun

/** Never inherits stdin: an installer that can block on a prompt is not a one-shot command. */
const spawnClaude: ClaudeExec = (args) =>
	spawnSync('claude', args, {
		stdio: ['ignore', 'pipe', 'pipe'],
		encoding: 'utf-8',
		timeout: 30_000,
	})

/** Where Claude Code records the plugins it has installed. */
function installedPluginsPath(): string {
	const dir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude')
	return path.join(dir, 'plugins', 'installed_plugins.json')
}

/**
 * The marketplace this identity's plugin came from, if the plugin is installed.
 *
 * The plugin registers this same server, the same seven prompts and its own SessionStart hook. A
 * second registration alongside it is not a fallback, it is a duplicate: two entries in the tool
 * list, two copies of every slash command, and two nodes wanting one identity. So installing has
 * to know the plugin exists.
 */
export function pluginMarketplace(): string | null {
	try {
		const file = JSON.parse(fs.readFileSync(installedPluginsPath(), 'utf-8')) as {
			plugins?: Record<string, unknown>
		}
		for (const key of Object.keys(file.plugins ?? {})) {
			const [name, marketplace] = key.split('@')
			if (name === SERVER_NAME && marketplace) return marketplace
		}
	} catch {
		// no plugins file, or unreadable — treat as not installed
	}
	return null
}

export function install(
	argv: string[],
	out = process.stdout,
	exec: ClaudeExec = spawnClaude,
): number {
	// The plugin is the whole of this, packaged. Installing on top of it is the one case where
	// doing what was asked leaves things worse than before.
	const marketplace = pluginMarketplace()
	if (marketplace && !argv.includes('--anyway')) {
		out.write(
			`The ${SERVER_NAME} plugin is already installed (${SERVER_NAME}@${marketplace}), and it ` +
				'registers this server itself.\n\n' +
				'Installing again would add a second copy: every tool and slash command twice, and two ' +
				'nodes wanting one identity. Nothing was changed.\n\n' +
				'  volenet-mcp uninstall           remove a registration added before the plugin\n' +
				'  volenet-mcp install --anyway    register anyway, if you know you want both\n',
		)
		return 0
	}
	// User scope by default, because the identity is: one keypair per machine, in the home
	// directory, shared by every session. Registering per project meant installing once and then
	// finding no tools in the next directory you opened — the identity was global, the
	// registration was not. `--local` is there for anyone who wants it in one project only.
	const scope = argv.includes('--local') ? 'local' : 'user'
	const command = launchCommand()
	const paste = `claude mcp add ${SERVER_NAME} -s ${scope} -- ${command.join(' ')}`

	const run = exec

	const listed = run(['mcp', 'list'])
	if (listed.error) {
		out.write(
			`The \`claude\` CLI is not on PATH. Run this once, in the project you want it in:\n\n  ${paste}\n\n`,
		)
		return 1
	}
	// Already there — but registered to *what*? Someone moving from a working-tree build to the
	// published package runs exactly this command, and reporting "nothing to do" would leave them
	// pointed at a path that may not survive. Same command: leave it. Different: replace it.
	const existing = listed.stdout
		?.split('\n')
		.find((l) => l.trimStart().startsWith(`${SERVER_NAME}:`))
	if (existing) {
		if (existing.includes(command.join(' '))) {
			out.write(`${SERVER_NAME} is already registered, unchanged.\n`)
			// Still ensure the hooks: a registration from before they existed has none, and this
			// is the command someone runs when the thing is not behaving as advertised.
			if (!argv.includes('--no-hooks')) {
				try {
					installHooks(command, out as NodeJS.WriteStream)
				} catch {
					// reported below by NEXT_STEPS; never worth failing an install over
				}
			}
			out.write(NEXT_STEPS)
			return 0
		}
		out.write(`Replacing the existing ${SERVER_NAME} registration:\n  was: ${existing.trim()}\n`)
		run(['mcp', 'remove', SERVER_NAME, '-s', scope])
		// The old one may have been in the other scope; clear that too so one is left, not two.
		run(['mcp', 'remove', SERVER_NAME, '-s', scope === 'user' ? 'local' : 'user'])
	}

	const added = run(addArgs(scope, command))
	if (added.status !== 0) {
		out.write(
			`Could not register it automatically${added.stderr ? `: ${added.stderr.trim()}` : ''}\n\n` +
				`Run this once instead:\n\n  ${paste}\n\n`,
		)
		return added.status ?? 1
	}
	out.write(
		`Registered ${SERVER_NAME} (${scope} scope${scope === 'user' ? ' — available in every project' : ', this project only'}).\n`,
	)
	// Hooks are what make a session hear anything, so they are part of installing rather than a
	// separate thing to remember. --no-hooks for anyone who manages their own.
	if (!argv.includes('--no-hooks')) {
		try {
			installHooks(command, out as NodeJS.WriteStream)
		} catch (err) {
			out.write(
				`Could not add the hooks (${err instanceof Error ? err.message : String(err)}).\n` +
					'Everything still works; you will hear about messages when you next use a tool.\n',
			)
		}
	}
	out.write(NEXT_STEPS)
	return 0
}

/**
 * Undo an install: the registration in both scopes, and the hooks this installer wrote.
 *
 * Mostly for the person who installed the server, then installed the plugin, and now has each
 * thing twice. Nothing else is touched — the identity, its keys, its peers and its history all
 * live in the store directory and are none of this command's business.
 */
export function uninstall(
	argv: string[],
	out = process.stdout,
	exec: ClaudeExec = spawnClaude,
): number {
	const removed: string[] = []
	for (const scope of ['user', 'local'] as const) {
		if (exec(['mcp', 'remove', SERVER_NAME, '-s', scope]).status === 0) removed.push(scope)
	}
	const events = argv.includes('--keep-hooks') ? [] : removeHooks()
	out.write(
		(removed.length
			? `Removed the ${SERVER_NAME} registration (${removed.join(', ')} scope).\n`
			: `No ${SERVER_NAME} registration to remove.\n`) +
			(events.length ? `Removed the hooks it wrote (${events.join(', ')}).\n` : '') +
			'Your identity is untouched: keys, peers and history live in the store directory.\n',
	)
	return 0
}

/** Take out only the hook entries this installer wrote, leaving anyone else's alone. */
export function removeHooks(): string[] {
	const file = settingsPath()
	let settings: Record<string, unknown>
	try {
		settings = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
	} catch {
		return []
	}
	fs.copyFileSync(file, `${file}.bak-volenet`)
	const hooks = (settings.hooks ?? {}) as Record<string, Array<Record<string, unknown>>>
	const cleared: string[] = []
	for (const event of Object.keys(hooks)) {
		const kept = (hooks[event] ?? []).filter((e) => !JSON.stringify(e).includes('volenet-mcp'))
		if (kept.length === (hooks[event] ?? []).length) continue
		cleared.push(event)
		if (kept.length) hooks[event] = kept
		// An event left with nothing in it is noise in a file someone reads; drop it.
		else hooks[event] = undefined as unknown as Array<Record<string, unknown>>
	}
	if (cleared.length === 0) return []
	const left = Object.fromEntries(Object.entries(hooks).filter(([, v]) => v !== undefined))
	if (Object.keys(left).length) settings.hooks = left
	else settings.hooks = undefined
	fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
	return cleared
}
