import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isOlder } from '../../src/skill/volehub.js'

/**
 * `vole upgrade` refreshes VoleHub skills alongside the paws.
 *
 * Skills come from a different registry than paws — files fetched from VoleHub, not npm packages —
 * so `npm install` never touched them and an agent could sit on a year-old skill with nothing to
 * say so. The load-bearing rule is *which* skills may be rewritten: a hub-installed one under
 * `skills/volehub/` is ours to manage, while a skill directly in `skills/<name>` is somebody's own
 * work and overwriting it would repeat the `BRAIN.md` mistake this release just fixed.
 */

const CLI = path.resolve(__dirname, '../../src/cli.ts')

async function readCli(): Promise<string> {
	return fs.readFile(CLI, 'utf-8')
}

function extract(source: string, name: string): string {
	const start = source.indexOf(`function ${name}(`)
	if (start === -1) throw new Error(`${name} not found in cli.ts`)
	const open = source.indexOf('{', start)
	let depth = 0
	for (let i = open; i < source.length; i++) {
		if (source[i] === '{') depth++
		else if (source[i] === '}' && --depth === 0) return source.substring(start, i + 1)
	}
	throw new Error(`${name} is unbalanced`)
}

describe('vole upgrade — skills', () => {
	let dir: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-skill-upgrade-'))
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('runs as part of an agent upgrade, not as a separate command', async () => {
		const cli = await readCli()
		// If this ever stops being called, skills silently stop upgrading and nothing fails.
		expect(extract(cli, 'upgradeAgentDir')).toContain('await upgradeSkills(projectRoot)')
	})

	it('rewrites hub-installed skills and never a local one', async () => {
		const body = extract(await readCli(), 'upgradeSkills')
		// Hub-managed skills are refreshed in place.
		expect(body).toContain('hub.install(name, projectRoot)')
		// Local ones are reported and left alone — the install call must not be reachable for them.
		const localLoop = body.substring(body.indexOf('for (const name of local)'))
		expect(localLoop).not.toContain('hub.install')
		expect(localLoop).toContain('kept (yours')
	})

	it('treats an unreachable registry as a note, not a failure', async () => {
		const body = extract(await readCli(), 'upgradeSkills')
		// A paw upgrade that already succeeded must not be reported as failed because the
		// skill registry was down.
		expect(body).toMatch(/catch[\s\S]{0,200}VoleHub unreachable/)
		expect(body).toContain('return notes')
	})

	it('compares versions numerically, not as strings', async () => {
		// The case string comparison gets wrong: "0.9.0" > "0.10.0" lexically.
		expect(isOlder('0.9.0', '0.10.0')).toBe(true)
		expect(isOlder('0.10.0', '0.9.0')).toBe(false)
		expect(isOlder('0.7.0', '0.7.0')).toBe(false)
		expect(isOlder('1.0.0', '1.0.1')).toBe(true)
		// Shorter versions are padded, not treated as newer.
		expect(isOlder('1.2', '1.2.1')).toBe(true)
		expect(isOlder('2', '1.9.9')).toBe(false)
	})

	it('reads the version out of a SKILL.md frontmatter block', async () => {
		const cli = await readCli()
		const body = extract(cli, 'skillVersion')
		const re = body.match(/head\.match\((\/.*?\/m)\)/)?.[1]
		expect(re, 'version regex not found').toBeTruthy()
		const rx = new RegExp((re as string).slice(1, -2), 'm')
		const md = '---\nname: demo\ndescription: "x"\nversion: 0.7.0\ntags:\n  - a\n---\n# Demo\n'
		expect(md.match(rx)?.[1]).toBe('0.7.0')
		// A quoted version and a body mention must not confuse it.
		expect('---\nversion: "1.2.3"\n---\nversion: 9.9.9\n'.match(rx)?.[1]).toBe('1.2.3')
	})
})
