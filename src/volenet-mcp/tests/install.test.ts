import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	SERVER_NAME,
	addArgs,
	install,
	installHooks,
	launchCommand,
	pluginMarketplace,
	removeHooks,
	uninstall,
} from '../src/install.js'

/** A stdout that can be read back, so the installer's output is an assertion rather than a guess. */
const capture = () => {
	const lines: string[] = []
	return { sink: { write: (s: string) => lines.push(s) }, text: () => lines.join('') }
}

/**
 * A config directory of our own, for every test in this file.
 *
 * The installer reads the real one to find out whether the plugin is installed, and a developer
 * who has it would otherwise see these fail on their machine and nowhere else.
 */
let config: string
let previousConfig: string | undefined

beforeEach(() => {
	config = fs.mkdtempSync(path.join(os.tmpdir(), 'volenet-config-'))
	previousConfig = process.env.CLAUDE_CONFIG_DIR
	process.env.CLAUDE_CONFIG_DIR = config
})

afterEach(() => {
	if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
	else process.env.CLAUDE_CONFIG_DIR = previousConfig
	fs.rmSync(config, { recursive: true, force: true })
})

/** Record this plugin as installed, so the installer sees it. */
const withPlugin = (key: string) => {
	fs.mkdirSync(path.join(config, 'plugins'), { recursive: true })
	fs.writeFileSync(
		path.join(config, 'plugins', 'installed_plugins.json'),
		JSON.stringify({ version: 2, plugins: { [key]: [{ scope: 'user' }] } }),
	)
}

describe('install', () => {
	it('launches an installed copy by name, never by its path', () => {
		const npx = ['npx', '-y', '@openvole/volenet-mcp']
		// npx runs a real .js file — out of a cache npm may evict. Registering that path would
		// work until it silently did not, which is the worst kind of first-run bug.
		expect(
			launchCommand('/home/u/.npm/_npx/ab12/node_modules/@openvole/volenet-mcp/dist/index.js'),
		).toEqual(npx)
		expect(
			launchCommand('/usr/local/lib/node_modules/@openvole/volenet-mcp/dist/index.js'),
		).toEqual(npx)
		expect(launchCommand('/usr/local/bin/volenet-mcp')).toEqual(npx)
		expect(launchCommand(undefined)).toEqual(npx)
	})

	it('launches a working-tree build by path, since there is nothing published to resolve', () => {
		expect(launchCommand('/repo/src/volenet-mcp/dist/index.js')).toEqual([
			'node',
			'/repo/src/volenet-mcp/dist/index.js',
		])
	})

	it('registers under the asked-for scope, with no configuration', () => {
		const args = addArgs('user', ['npx', '-y', '@openvole/volenet-mcp'])
		expect(args).toEqual([
			'mcp',
			'add',
			SERVER_NAME,
			'-s',
			'user',
			'--',
			'npx',
			'-y',
			'@openvole/volenet-mcp',
		])
		// The whole point: nothing about a name, a hub or a port is set at install time.
		expect(args.join(' ')).not.toMatch(/VOLENET_MCP|-e /)
	})

	it('defaults to user scope, because the identity it installs is per machine', () => {
		const { sink, text } = capture()
		const path = process.env.PATH
		process.env.PATH = '/nonexistent'
		try {
			install([], sink as NodeJS.WriteStream)
			expect(text()).toContain('-s user')
			const local = capture()
			install(['--local'], local.sink as NodeJS.WriteStream)
			expect(local.text()).toContain('-s local')
		} finally {
			process.env.PATH = path
		}
	})

	it('replaces a registration that points somewhere else', () => {
		// Moving from a working-tree build to the published package runs exactly this command;
		// "already registered" would leave the old path in place.
		const calls: string[][] = []
		const out = capture()
		const fake = (args: string[]) => {
			calls.push(args)
			return args[1] === 'list'
				? { stdout: '  volenet: node /somewhere/dist/index.js - ✔ Connected\n', status: 0 }
				: { stdout: '', status: 0 }
		}
		install([], out.sink as NodeJS.WriteStream, fake as never)
		expect(out.text()).toContain('Replacing')
		expect(calls.some((c) => c[1] === 'remove')).toBe(true)
		expect(calls.some((c) => c[1] === 'add')).toBe(true)
	})

	it('leaves an identical registration alone', () => {
		const out = capture()
		const fake = () => ({
			stdout: '  volenet: npx -y @openvole/volenet-mcp - ✔ Connected\n',
			status: 0,
		})
		install([], out.sink as NodeJS.WriteStream, fake as never)
		expect(out.text()).toContain('unchanged')
	})

	it('prints the line to paste when the CLI is missing, rather than guessing at its config', () => {
		const { sink, text } = capture()
		const path = process.env.PATH
		process.env.PATH = '/nonexistent'
		try {
			expect(install([], sink as NodeJS.WriteStream)).toBe(1)
		} finally {
			process.env.PATH = path
		}
		expect(text()).toContain('not on PATH')
		expect(text()).toContain(`claude mcp add ${SERVER_NAME}`)
	})
})

describe('installing makes a session listen', () => {
	it('writes the hooks that turn arrival into something the session hears', async () => {
		const fs = await import('node:fs')
		const os = await import('node:os')
		const path = await import('node:path')
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volenet-hooks-'))
		const prev = process.env.CLAUDE_CONFIG_DIR
		process.env.CLAUDE_CONFIG_DIR = dir
		try {
			// Something already in the file must survive untouched.
			fs.writeFileSync(
				path.join(dir, 'settings.json'),
				JSON.stringify({
					theme: 'dark',
					hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] },
				}),
			)
			const out = capture()
			const added = installHooks(['volenet-mcp'], out.sink as NodeJS.WriteStream)
			expect(added).toEqual(['SessionStart', 'UserPromptSubmit', 'PostToolUse'])

			const s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8'))
			expect(s.theme).toBe('dark')
			// Somebody else's hook on the same event is not ours to remove.
			expect(JSON.stringify(s.hooks.PostToolUse)).toContain('other-tool')
			expect(JSON.stringify(s.hooks.SessionStart)).toContain('volenet-mcp session-start')
			expect(fs.existsSync(path.join(dir, 'settings.json.bak-volenet'))).toBe(true)

			// Running it twice must not stack duplicates of ours.
			installHooks(['volenet-mcp'], out.sink as NodeJS.WriteStream)
			const again = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8'))
			expect(
				again.hooks.PostToolUse.filter((e: unknown) => JSON.stringify(e).includes('volenet-mcp')),
			).toHaveLength(1)
		} finally {
			if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
			else process.env.CLAUDE_CONFIG_DIR = prev
		}
	})
})

describe('standing aside for the plugin', () => {
	it('finds the plugin and names the marketplace it came from', () => {
		expect(pluginMarketplace()).toBeNull()
		withPlugin('volenet@openvole')
		expect(pluginMarketplace()).toBe('openvole')
	})

	it('is not fooled by another plugin whose name merely contains ours', () => {
		withPlugin('volenet-extras@somebody')
		expect(pluginMarketplace()).toBeNull()
	})

	it('refuses to register a second copy, and says what to do instead', () => {
		withPlugin('volenet@openvole')
		const { sink, text } = capture()
		let ran = false
		const code = install([], sink as NodeJS.WriteStream, () => {
			ran = true
			return { status: 0, stdout: '', stderr: '' }
		})
		expect(code).toBe(0)
		// The point: it did not touch the config at all.
		expect(ran).toBe(false)
		expect(text()).toContain('volenet@openvole')
		expect(text()).toContain('uninstall')
	})

	it('registers anyway when told to', () => {
		withPlugin('volenet@openvole')
		const { sink } = capture()
		let ran = false
		install(['--anyway', '--no-hooks'], sink as NodeJS.WriteStream, () => {
			ran = true
			return { status: 0, stdout: '', stderr: '' }
		})
		expect(ran).toBe(true)
	})
})

describe('uninstall', () => {
	it("takes out our hooks and leaves everyone else's", () => {
		fs.writeFileSync(
			path.join(config, 'settings.json'),
			JSON.stringify({
				hooks: {
					SessionStart: [
						{ hooks: [{ type: 'command', command: 'volenet-mcp session-start' }] },
						{ hooks: [{ type: 'command', command: 'somebody-else --init' }] },
					],
					PostToolUse: [{ hooks: [{ type: 'command', command: 'volenet-mcp inbox --read' }] }],
				},
				other: 'kept',
			}),
		)

		expect(removeHooks().sort()).toEqual(['PostToolUse', 'SessionStart'])

		const after = JSON.parse(fs.readFileSync(path.join(config, 'settings.json'), 'utf-8'))
		expect(after.other).toBe('kept')
		// The event with somebody else's hook survives, holding only theirs.
		expect(after.hooks.SessionStart).toHaveLength(1)
		expect(JSON.stringify(after.hooks.SessionStart)).toContain('somebody-else')
		// The event that was only ours goes entirely, rather than being left empty.
		expect(after.hooks.PostToolUse).toBeUndefined()
	})

	it('removes the registration from both scopes and says the identity is safe', () => {
		const scopes: string[] = []
		const { sink, text } = capture()
		uninstall(['--keep-hooks'], sink as NodeJS.WriteStream, (args) => {
			if (args[0] === 'mcp' && args[1] === 'remove') scopes.push(args[args.indexOf('-s') + 1])
			return { status: 0, stdout: '', stderr: '' }
		})
		expect(scopes).toEqual(['user', 'local'])
		expect(text()).toContain('identity is untouched')
	})
})
