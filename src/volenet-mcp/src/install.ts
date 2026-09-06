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

const NEXT_STEPS =
	'\nRestart Claude Code — MCP servers load at startup — then:\n\n' +
	'  volenet_whoami             who you are on the mesh (an identity is made on first run)\n' +
	'  volenet_hub url:"..."      join a hub, to be reachable from anywhere\n' +
	'  volenet_connect url:"..."  or pair directly with an agent you can dial\n\n' +
	'Nothing else needs configuring.\n'

export function install(argv: string[], out = process.stdout): number {
	const scope = argv.includes('--user') ? 'user' : 'local'
	const command = launchCommand()
	const paste = `claude mcp add ${SERVER_NAME} -s ${scope} -- ${command.join(' ')}`

	// Never inherit stdin: if the CLI asks something, this would hang instead of installing.
	const run = (args: string[]) =>
		spawnSync('claude', args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			encoding: 'utf-8',
			timeout: 30_000,
		})

	const listed = run(['mcp', 'list'])
	if (listed.error) {
		out.write(
			`The \`claude\` CLI is not on PATH. Run this once, in the project you want it in:\n\n  ${paste}\n\n`,
		)
		return 1
	}
	if (listed.stdout?.includes(`${SERVER_NAME}:`)) {
		out.write(`${SERVER_NAME} is already registered — nothing to do.\n${NEXT_STEPS}`)
		return 0
	}

	const added = run(addArgs(scope, command))
	if (added.status !== 0) {
		out.write(
			`Could not register it automatically${added.stderr ? `: ${added.stderr.trim()}` : ''}\n\n` +
				`Run this once instead:\n\n  ${paste}\n\n`,
		)
		return added.status ?? 1
	}
	out.write(`Registered ${SERVER_NAME} (${scope} scope).\n${NEXT_STEPS}`)
	return 0
}
