import { describe, expect, it } from 'vitest'
import { SERVER_NAME, addArgs, install, launchCommand } from '../src/install.js'

/** A stdout that can be read back, so the installer's output is an assertion rather than a guess. */
const capture = () => {
	const lines: string[] = []
	return { sink: { write: (s: string) => lines.push(s) }, text: () => lines.join('') }
}

describe('install', () => {
	it('launches the published binary, or the local build when run from one', () => {
		expect(launchCommand('/somewhere/dist/index.js')).toEqual(['node', '/somewhere/dist/index.js'])
		expect(launchCommand('/usr/local/bin/volenet-mcp')).toEqual([
			'npx',
			'-y',
			'@openvole/volenet-mcp',
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
