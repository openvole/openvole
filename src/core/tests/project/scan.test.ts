import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanProjectRoot } from '../../src/project/scan.js'
import { ProjectRootError } from '../../src/project/types.js'

/**
 * Scanning is what lets an agent describe a project from evidence instead of guessing, so the two
 * properties that matter are: it writes nothing (a scan of someone's repo must leave no trace),
 * and it honours the same sandbox as project creation — otherwise `project_scan` is a
 * read-anything primitive wearing a helpful name.
 */

describe('scanProjectRoot', () => {
	let dir: string
	let repo: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-scan-'))
		repo = path.join(dir, 'repo')
		await fs.mkdir(repo, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('detects a node/pnpm/typescript/vitest repo', async () => {
		await fs.writeFile(
			path.join(repo, 'package.json'),
			JSON.stringify({
				name: 'openvole',
				scripts: { test: 'vitest run' },
				devDependencies: { vitest: '^4', '@biomejs/biome': '^1', typescript: '^5' },
			}),
			'utf-8',
		)
		await fs.writeFile(path.join(repo, 'tsconfig.json'), '{}', 'utf-8')
		await fs.writeFile(path.join(repo, 'pnpm-lock.yaml'), '', 'utf-8')
		await fs.mkdir(path.join(repo, '.git'), { recursive: true })
		await fs.writeFile(path.join(repo, 'README.md'), '# openvole', 'utf-8')
		await fs.writeFile(path.join(repo, 'CLAUDE.md'), 'conventions', 'utf-8')

		const result = await scanProjectRoot(repo, [dir])

		expect(result.kind).toBe('code')
		expect(result.name).toBe('openvole')
		expect(new Set(result.stack)).toEqual(
			new Set(['git', 'node', 'typescript', 'pnpm', 'vitest', 'biome']),
		)
		expect(result.suggestedTools).toContain('shell_exec')
		// Docs come back in read-priority order — conventions before the readme.
		expect(result.readFirst[0]).toBe('CLAUDE.md')
		expect(result.readFirst).toContain('README.md')
		expect(result.summary).toContain('openvole')
	})

	it('always suggests writing CONTEXT.md first', async () => {
		await fs.writeFile(path.join(repo, 'README.md'), '# thing', 'utf-8')
		const result = await scanProjectRoot(repo, [dir])
		expect(result.suggestedTasks[0]).toMatch(/CONTEXT\.md/)
		expect(result.suggestedTasks[0]).toContain('README.md')
	})

	it('recognizes other ecosystems', async () => {
		await fs.writeFile(path.join(repo, 'Cargo.toml'), '[package]', 'utf-8')
		await fs.writeFile(path.join(repo, 'Dockerfile'), 'FROM node', 'utf-8')
		const result = await scanProjectRoot(repo, [dir])
		expect(result.kind).toBe('code')
		expect(result.stack).toContain('rust')
		expect(result.stack).toContain('docker')
	})

	it('falls back to media and writing shapes', async () => {
		const media = path.join(dir, 'footage')
		await fs.mkdir(media, { recursive: true })
		await fs.writeFile(path.join(media, 'take-1.mov'), '', 'utf-8')
		expect((await scanProjectRoot(media, [dir])).kind).toBe('media')

		const prose = path.join(dir, 'book')
		await fs.mkdir(prose, { recursive: true })
		await fs.writeFile(path.join(prose, 'chapter-1.md'), '# one', 'utf-8')
		expect((await scanProjectRoot(prose, [dir])).kind).toBe('writing')
	})

	it('handles an empty directory without inventing a stack', async () => {
		const empty = path.join(dir, 'empty')
		await fs.mkdir(empty, { recursive: true })
		const result = await scanProjectRoot(empty, [dir])
		expect(result.kind).toBe('general')
		expect(result.stack).toEqual([])
		expect(result.summary).toContain('no recognizable stack markers')
	})

	it('survives a malformed package.json', async () => {
		await fs.writeFile(path.join(repo, 'package.json'), '{ not json', 'utf-8')
		const result = await scanProjectRoot(repo, [dir])
		expect(result.kind).toBe('general')
	})

	it('writes nothing', async () => {
		await fs.writeFile(path.join(repo, 'package.json'), '{"name":"x"}', 'utf-8')
		await fs.writeFile(path.join(repo, 'README.md'), '# x', 'utf-8')

		const before = await fs.readdir(repo)
		const stats = await Promise.all(
			before.map(async (f) => [f, (await fs.stat(path.join(repo, f))).mtimeMs] as const),
		)

		await scanProjectRoot(repo, [dir])

		expect(await fs.readdir(repo)).toEqual(before)
		for (const [file, mtime] of stats) {
			expect((await fs.stat(path.join(repo, file))).mtimeMs).toBe(mtime)
		}
	})

	it('refuses a root outside the allowed paths — scanning is not a way around the sandbox', async () => {
		const outside = path.join(dir, 'not-granted')
		await fs.mkdir(outside, { recursive: true })
		await expect(scanProjectRoot(outside, [repo])).rejects.toThrow(ProjectRootError)
	})
})
