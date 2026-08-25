import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../../src/project/store.js'
import { TaskStore } from '../../src/project/tasks.js'
import { createProjectTools } from '../../src/project/tools.js'
import type { ProjectContextInfo } from '../../src/project/types.js'
import type { ToolContext, ToolDefinition } from '../../src/tool/types.js'

/**
 * The agent's own file tools for the project it is working on.
 *
 * Before these existed the dashboard could browse and edit a project's attached root while the
 * agent could not — `workspace_*` is hard-scoped to `.openvole/workspace/`, so working in a repo
 * meant installing a filesystem paw and granting it the path, which then had the run of the whole
 * grant. These close that gap and, because every path is resolved against *this task's* project,
 * an agent with two attached projects cannot reach from one into the other.
 *
 * The scope arrives per call rather than being captured when the tools are built: task
 * concurrency is configurable, and a shared "current project" would answer for whichever task
 * started last.
 */

describe('project-scoped file tools', () => {
	let dir: string
	let workspace: string
	let repoA: string
	let repoB: string
	let store: ProjectStore
	let tools: Map<string, ToolDefinition>

	/** The context core builds for a task belonging to `id`. */
	function ctxFor(id: string, root?: string): ToolContext {
		return {
			project: {
				id,
				name: id,
				kind: 'code',
				dir: path.join(workspace, id),
				...(root ? { root } : {}),
			} as ProjectContextInfo,
		}
	}

	const call = (name: string, params: unknown, ctx?: ToolContext) =>
		tools.get(name)?.execute(params, ctx) as Promise<Record<string, unknown>>

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-scoped-'))
		workspace = path.join(dir, '.openvole', 'workspace')
		repoA = path.join(dir, 'repo-a')
		repoB = path.join(dir, 'repo-b')
		await fs.mkdir(repoA, { recursive: true })
		await fs.mkdir(repoB, { recursive: true })
		await fs.writeFile(path.join(repoA, 'README.md'), 'project a')
		await fs.writeFile(path.join(repoB, 'SECRET.md'), 'project b')

		store = new ProjectStore(workspace, { agentRoot: dir })
		await store.init()
		await store.create({ id: 'alpha', name: 'Alpha', kind: 'code', root: repoA })
		await store.create({ id: 'beta', name: 'Beta', kind: 'code', root: repoB })
		await store.create({ id: 'solo', name: 'Solo', kind: 'writing' })

		tools = new Map(
			createProjectTools({ projects: store, tasks: new TaskStore(store) }).map((t) => [t.name, t]),
		)
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('registers the five file verbs', () => {
		for (const name of [
			'project_file_list',
			'project_file_read',
			'project_file_write',
			'project_file_move',
			'project_file_delete',
		]) {
			expect(tools.has(name), `${name} is missing`).toBe(true)
		}
	})

	it('reads and writes the attached root, which workspace_* cannot reach', async () => {
		const read = await call('project_file_read', { path: 'README.md' }, ctxFor('alpha', repoA))
		expect(read.ok).toBe(true)
		expect(read.content).toBe('project a')

		const written = await call(
			'project_file_write',
			{ path: 'src/index.ts', content: 'export {}' },
			ctxFor('alpha', repoA),
		)
		expect(written.ok).toBe(true)
		expect(await fs.readFile(path.join(repoA, 'src/index.ts'), 'utf-8')).toBe('export {}')
	})

	it('defaults to the attached root, and takes workspace on request', async () => {
		await fs.writeFile(path.join(workspace, 'alpha', 'CONTEXT.md'), '# alpha')

		const files = await call('project_file_list', {}, ctxFor('alpha', repoA))
		expect((files.entries as Array<{ name: string }>).map((e) => e.name)).toContain('README.md')

		const notes = await call('project_file_list', { root: 'workspace' }, ctxFor('alpha', repoA))
		expect((notes.entries as Array<{ name: string }>).map((e) => e.name)).toContain('CONTEXT.md')
	})

	it('a self-contained project defaults to its own folder', async () => {
		await fs.writeFile(path.join(workspace, 'solo', 'draft.md'), 'words')
		const listed = await call('project_file_list', {}, ctxFor('solo'))
		expect((listed.entries as Array<{ name: string }>).map((e) => e.name)).toContain('draft.md')
	})

	describe('isolation', () => {
		it('cannot reach another project, even by absolute path', async () => {
			// This is the property the feature is for: working on alpha, beta is unreachable.
			const byPath = await call(
				'project_file_read',
				{ path: path.join(repoB, 'SECRET.md') },
				ctxFor('alpha', repoA),
			)
			expect(byPath.ok).toBe(false)

			const byTraversal = await call(
				'project_file_read',
				{ path: '../repo-b/SECRET.md' },
				ctxFor('alpha', repoA),
			)
			expect(byTraversal.ok).toBe(false)
			expect(String(byTraversal.error)).toMatch(/escapes/)
		})

		it('cannot write into another project', async () => {
			const res = await call(
				'project_file_write',
				{ path: '../repo-b/pwned.md', content: 'x' },
				ctxFor('alpha', repoA),
			)
			expect(res.ok).toBe(false)
			expect(await fs.readdir(repoB)).toEqual(['SECRET.md'])
		})

		it('the same tool answers for whichever project the call carries', async () => {
			// Scope is per call, not captured at build time — at concurrency > 1 two tasks share
			// these tool objects, and a remembered "current project" would cross them.
			const a = await call('project_file_read', { path: 'README.md' }, ctxFor('alpha', repoA))
			const b = await call('project_file_read', { path: 'SECRET.md' }, ctxFor('beta', repoB))
			expect(a.content).toBe('project a')
			expect(b.content).toBe('project b')

			// And neither can see the other's file.
			const crossed = await call('project_file_read', { path: 'SECRET.md' }, ctxFor('alpha', repoA))
			expect(crossed.ok).toBe(false)
		})

		it('refuses every verb when no project is in scope', async () => {
			for (const [name, params] of [
				['project_file_list', {}],
				['project_file_read', { path: 'README.md' }],
				['project_file_write', { path: 'x.md', content: 'x' }],
				['project_file_move', { path: 'a', to: 'b' }],
				['project_file_delete', { path: 'x.md' }],
			] as const) {
				const res = await call(name, params, {})
				expect(res.ok, `${name} acted without a project`).toBe(false)
				expect(String(res.error)).toMatch(/No project is in scope/)
			}
		})
	})

	it('keeps the ledger files off limits', async () => {
		const written = await call(
			'project_file_write',
			{ path: 'tasks.jsonl', content: '', root: 'workspace' },
			ctxFor('alpha', repoA),
		)
		expect(written.ok).toBe(false)
		expect(String(written.error)).toMatch(/managed by the project/)
	})

	it('moves and deletes within the project', async () => {
		await call('project_file_write', { path: 'a.md', content: 'x' }, ctxFor('alpha', repoA))
		const moved = await call(
			'project_file_move',
			{ path: 'a.md', to: 'docs/b.md' },
			ctxFor('alpha', repoA),
		)
		expect(moved.ok).toBe(true)
		expect(await fs.readFile(path.join(repoA, 'docs/b.md'), 'utf-8')).toBe('x')

		const removed = await call('project_file_delete', { path: 'docs' }, ctxFor('alpha', repoA))
		expect(removed.ok).toBe(true)
		expect(removed.kind).toBe('dir')
		expect(await fs.stat(path.join(repoA, 'docs')).catch(() => null)).toBeNull()
	})

	it('reports a binary or oversized file rather than returning noise', async () => {
		await fs.writeFile(path.join(repoA, 'blob.bin'), Buffer.from([1, 0, 2]))
		const bin = await call('project_file_read', { path: 'blob.bin' }, ctxFor('alpha', repoA))
		expect(bin.ok).toBe(false)
		expect(String(bin.error)).toMatch(/binary/)

		await fs.writeFile(path.join(repoA, 'big.txt'), 'a'.repeat(600 * 1024))
		const big = await call('project_file_read', { path: 'big.txt' }, ctxFor('alpha', repoA))
		expect(big.ok).toBe(false)
		expect(String(big.error)).toMatch(/too large/)
	})

	it('refuses a root the project does not have', async () => {
		const res = await call('project_file_list', { root: 'root' }, ctxFor('solo'))
		expect(res.ok).toBe(false)
		expect(String(res.error)).toMatch(/has no root/)
	})
})
