import { describe, expect, it } from 'vitest'
import { SERVER_NAME, addArgs, install, launchCommand } from '../src/install.js'

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
