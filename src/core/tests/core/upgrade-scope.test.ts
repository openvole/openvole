import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findAgentRegistry } from '../../src/cli.js'

/**
 * `vole upgrade` means "this agent" inside an agent directory and "every agent" at a server root.
 *
 * Paws are installed per agent, so a fix published to npm reaches an agent only when someone
 * upgrades that directory — on a multi-agent server the natural outcome was agents quietly sitting
 * on old paws, which reads as a live bug rather than a missed upgrade.
 *
 * The rule that matters here: standing inside an agent must never walk the whole server. Agent
 * directories live *underneath* the server root, so a naive upward search would upgrade every
 * sibling when you asked for one.
 */

describe('vole upgrade scope detection', () => {
	let dir: string
	let serverRoot: string
	let agentDir: string
	const originalHome = process.env.VOLE_HOME

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-upgrade-scope-'))
		serverRoot = path.join(dir, 'server')
		agentDir = path.join(serverRoot, 'agents', 'alpha')
		await fs.mkdir(agentDir, { recursive: true })
		await fs.writeFile(
			path.join(serverRoot, 'agents.json'),
			JSON.stringify({ agents: [{ id: 'alpha', name: 'Alpha', path: agentDir }] }),
			'utf-8',
		)
		await fs.writeFile(path.join(agentDir, 'vole.config.json'), '{}', 'utf-8')
		process.env.VOLE_HOME = path.join(dir, 'nowhere')
	})

	afterEach(async () => {
		// biome-ignore lint/performance/noDelete: restoring an unset env var needs the key gone,
		// not set to "undefined" — process.env stringifies everything assigned to it.
		if (originalHome === undefined) delete process.env.VOLE_HOME
		else process.env.VOLE_HOME = originalHome
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('walks the server when standing at a server root', async () => {
		expect(await findAgentRegistry(serverRoot)).toBe(path.join(serverRoot, 'agents.json'))
	})

	it('upgrades only this agent when standing inside one', async () => {
		// The agent lives under the server root, so this is the case a parent-directory search
		// would get wrong — asking for one agent and upgrading all of them.
		expect(await findAgentRegistry(agentDir)).toBeNull()
	})

	it('reads the legacy spaces.json registry', async () => {
		const legacy = path.join(dir, 'legacy')
		await fs.mkdir(legacy, { recursive: true })
		await fs.writeFile(path.join(legacy, 'spaces.json'), JSON.stringify({ spaces: [] }), 'utf-8')
		expect(await findAgentRegistry(legacy)).toBe(path.join(legacy, 'spaces.json'))
	})

	it('falls back to VOLE_HOME from an unrelated directory', async () => {
		const home = path.join(dir, 'nowhere')
		await fs.mkdir(home, { recursive: true })
		await fs.writeFile(path.join(home, 'agents.json'), JSON.stringify({ agents: [] }), 'utf-8')

		const elsewhere = path.join(dir, 'elsewhere')
		await fs.mkdir(elsewhere, { recursive: true })
		expect(await findAgentRegistry(elsewhere)).toBe(path.join(home, 'agents.json'))
	})

	it('cwd beats VOLE_HOME — upgrading at a server root means that server', async () => {
		const home = path.join(dir, 'nowhere')
		await fs.mkdir(home, { recursive: true })
		await fs.writeFile(path.join(home, 'agents.json'), JSON.stringify({ agents: [] }), 'utf-8')

		expect(await findAgentRegistry(serverRoot)).toBe(path.join(serverRoot, 'agents.json'))
	})

	it('returns null when there is no registry anywhere', async () => {
		const bare = path.join(dir, 'bare')
		await fs.mkdir(bare, { recursive: true })
		process.env.VOLE_HOME = path.join(dir, 'missing')
		expect(await findAgentRegistry(bare)).toBeNull()
	})
})
