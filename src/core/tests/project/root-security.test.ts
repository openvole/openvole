import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, validateProjectRoot } from '../../src/project/store.js'
import { ProjectRootError } from '../../src/project/types.js'

/**
 * A project `root` points the agent at files outside its workspace, so it is a privilege
 * boundary — not a convenience field. The property under test: an agent can never widen its own
 * filesystem reach by creating a project. Granting a path stays a human action in
 * vole.config.json, and the refusal has to name the path so the human knows what to grant.
 *
 * Symlinks are the interesting attack: a link created *inside* the workspace (which the agent can
 * write freely) pointing at /etc would otherwise smuggle access past a naive prefix check.
 */

describe('project root authorization', () => {
	let dir: string
	let agentRoot: string
	let outside: string
	let granted: string
	let store: ProjectStore

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-root-sec-'))
		agentRoot = path.join(dir, 'agent')
		outside = path.join(dir, 'outside')
		granted = path.join(dir, 'granted-repo')
		await fs.mkdir(path.join(agentRoot, '.openvole', 'workspace'), { recursive: true })
		await fs.mkdir(outside, { recursive: true })
		await fs.mkdir(granted, { recursive: true })

		store = new ProjectStore(path.join(agentRoot, '.openvole', 'workspace'), {
			agentRoot,
			allowedPaths: [granted],
		})
		await store.init()
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('accepts a root inside an allowed path', async () => {
		const nested = path.join(granted, 'packages', 'core')
		await fs.mkdir(nested, { recursive: true })

		const project = await store.create({ id: 'repo', root: nested })
		expect(project.root).toBe(await fs.realpath(nested))
	})

	it('accepts a root inside the agent directory itself', async () => {
		const inside = path.join(agentRoot, 'notes')
		await fs.mkdir(inside, { recursive: true })
		await expect(store.create({ id: 'inside', root: inside })).resolves.toBeTruthy()
	})

	it('refuses a root outside every allowed path, naming what to grant', async () => {
		await expect(store.create({ id: 'sneaky', root: outside })).rejects.toThrow(ProjectRootError)

		try {
			await store.create({ id: 'sneaky', root: outside })
			throw new Error('should have thrown')
		} catch (err) {
			const message = (err as Error).message
			expect(message).toContain(await fs.realpath(outside))
			expect(message).toContain('security.allowedPaths')
		}
	})

	it('leaves no directory behind when a root is refused', async () => {
		await expect(store.create({ id: 'refused', root: outside })).rejects.toThrow()
		await expect(
			fs.access(path.join(agentRoot, '.openvole', 'workspace', 'refused')),
		).rejects.toThrow()
		expect(await store.list()).toEqual([])
	})

	it('refuses traversal out of an allowed path', async () => {
		await expect(
			validateProjectRoot(path.join(granted, '..', 'outside'), [granted]),
		).rejects.toThrow(ProjectRootError)
	})

	it('refuses a symlink that escapes an allowed path', async () => {
		const link = path.join(granted, 'escape-hatch')
		await fs.symlink(outside, link, 'dir')

		// The prefix check alone would pass — the link's *path* is inside the granted root.
		// Resolving it first is what makes this a refusal.
		await expect(store.create({ id: 'escaped', root: link })).rejects.toThrow(ProjectRootError)
	})

	it('refuses a root that does not exist or is a file', async () => {
		await expect(validateProjectRoot(path.join(granted, 'ghost'), [granted])).rejects.toThrow(
			/does not exist/,
		)
		const file = path.join(granted, 'a-file.txt')
		await fs.writeFile(file, 'x', 'utf-8')
		await expect(validateProjectRoot(file, [granted])).rejects.toThrow(/not a directory/)
	})

	it('refuses everything external when no paths are granted', async () => {
		const strict = new ProjectStore(path.join(agentRoot, '.openvole', 'workspace'), { agentRoot })
		await expect(strict.create({ id: 'nope', root: granted })).rejects.toThrow(ProjectRootError)
		// Self-contained projects still work — the default is usable, just not external.
		await expect(strict.create({ id: 'fine' })).resolves.toBeTruthy()
	})

	it('re-authorizes on update — a root change is not a bypass', async () => {
		await store.create({ id: 'moving', root: granted })
		await expect(store.update('moving', { root: outside })).rejects.toThrow(ProjectRootError)

		const unchanged = await store.get('moving')
		expect(unchanged?.root).toBe(await fs.realpath(granted))
	})
})
