import { describe, expect, it } from 'vitest'
import { SERVER_NAME, addArgs, install, installHooks, launchCommand } from '../src/install.js'

/** A stdout that can be read back, so the installer's output is an assertion rather than a guess. */
const capture = () => {
	const lines: string[] = []
	return { sink: { write: (s: string) => lines.push(s) }, text: () => lines.join('') }
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
