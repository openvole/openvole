import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectFiles } from '../../src/project/files.js'
import { ProjectStore } from '../../src/project/store.js'

/**
 * The project file manager reads and *writes*, so its boundary carries more weight than the
 * directory picker's: the picker only lists, and deliberately lists anywhere so you can grant a
 * path you have not granted yet. Here every path must land inside one of the project's own roots.
 *
 * Three escapes are tested separately because each defeats a different check — `..` is lexical, an
 * absolute path bypasses the join, and a symlink planted inside the root passes both and is caught
 * only by realpath.
 */

describe('ProjectFiles', () => {
	let dir: string
	let outside: string
	let workspace: string
	let store: ProjectStore
	let files: ProjectFiles

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-pfiles-'))
		outside = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-outside-'))
		workspace = path.join(dir, '.openvole', 'workspace')
		store = new ProjectStore(workspace, { agentRoot: dir })
		await store.init()
		await store.create({ id: 'demo', name: 'Demo', kind: 'general' })
		files = new ProjectFiles(store)
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
		await fs.rm(outside, { recursive: true, force: true })
	})

	describe('roots', () => {
		it('offers the project folder for a self-contained project', async () => {
			const roots = await files.roots('demo')
			expect(roots).toHaveLength(1)
			expect(roots[0].key).toBe('workspace')
			expect(roots[0].path).toBe(path.join(workspace, 'demo'))
		})

		it('offers the attached root as a second place to browse', async () => {
			const repo = path.join(dir, 'repo')
			await fs.mkdir(repo, { recursive: true })
			await store.create({ id: 'coded', name: 'Coded', kind: 'code', root: repo })

			const roots = await files.roots('coded')
			expect(roots.map((r) => r.key)).toEqual(['workspace', 'root'])
			expect(roots[1].label).toBe('repo')
		})

		it('drops a root that is no longer granted, rather than erroring on every click', async () => {
			// Created while the path was allowed…
			const permissive = new ProjectStore(workspace, { agentRoot: dir, allowedPaths: [outside] })
			await permissive.create({ id: 'ext', name: 'Ext', kind: 'code', root: outside })

			// …and browsed after the grant was withdrawn. `store` has no allowedPaths.
			const roots = await files.roots('ext')
			expect(roots.map((r) => r.key)).toEqual(['workspace'])
		})

		it('refuses a project that does not exist', async () => {
			await expect(files.roots('nope')).rejects.toThrow(/no such project/)
		})
	})

	describe('listing', () => {
		it('sorts directories first and reports sizes', async () => {
			const root = path.join(workspace, 'demo')
			await fs.writeFile(path.join(root, 'zeta.md'), 'hello')
			await fs.writeFile(path.join(root, 'CONTEXT.md'), '# ctx')
			await fs.mkdir(path.join(root, 'notes'))

			const listing = await files.list('demo', 'workspace')
			expect(listing.entries.map((e) => e.name)).toEqual([
				'notes',
				'.project.json',
				'CONTEXT.md',
				'zeta.md',
			])
			expect(listing.entries[0].kind).toBe('dir')
			expect(listing.entries.find((e) => e.name === 'zeta.md')?.size).toBe(5)
			expect(listing.parent).toBeNull()
		})

		it('marks the ledger files so the UI can show them as managed', async () => {
			// CONTEXT.md sits beside them and is very much editable — the distinction is the point.
			await fs.writeFile(path.join(workspace, 'demo', 'CONTEXT.md'), '# ctx')
			const listing = await files.list('demo', 'workspace')
			expect(listing.entries.find((e) => e.name === '.project.json')?.reserved).toBe(true)
			expect(listing.entries.find((e) => e.name === 'CONTEXT.md')).toBeDefined()
			expect(listing.entries.find((e) => e.name === 'CONTEXT.md')?.reserved).toBeUndefined()
		})

		it('reports a parent once you are below the root', async () => {
			await fs.mkdir(path.join(workspace, 'demo', 'a', 'b'), { recursive: true })

			const deep = await files.list('demo', 'workspace', 'a/b')
			expect(deep.rel).toBe('a/b')
			expect(deep.parent).toBe('a')

			const shallow = await files.list('demo', 'workspace', 'a')
			expect(shallow.parent).toBe('')
		})
	})

	describe('path boundary', () => {
		it('refuses a relative escape', async () => {
			await expect(files.list('demo', 'workspace', '../..')).rejects.toThrow(/escapes/)
			await expect(files.read('demo', 'workspace', '../.project.json')).rejects.toThrow(/escapes/)
		})

		it('treats an absolute path as relative to the root, never as itself', async () => {
			await fs.writeFile(path.join(outside, 'secret.txt'), 'nope')
			// Resolved inside the project, where it does not exist — not read from /tmp/…
			await expect(
				files.read('demo', 'workspace', path.join(outside, 'secret.txt')),
			).rejects.toThrow(/not found/)
		})

		it('refuses a symlink that points out of the project', async () => {
			await fs.writeFile(path.join(outside, 'secret.txt'), 'nope')
			await fs.symlink(outside, path.join(workspace, 'demo', 'escape'))

			await expect(files.list('demo', 'workspace', 'escape')).rejects.toThrow(/symlink/)
			await expect(files.read('demo', 'workspace', 'escape/secret.txt')).rejects.toThrow(/symlink/)
		})

		it('refuses to write through a symlink that leaves the project', async () => {
			await fs.symlink(outside, path.join(workspace, 'demo', 'escape'))
			await expect(files.write('demo', 'workspace', 'escape/pwned.txt', 'x')).rejects.toThrow(
				/symlink/,
			)
			expect(await fs.readdir(outside)).toEqual([])
		})
	})

	describe('reading', () => {
		it('returns text content', async () => {
			await fs.writeFile(path.join(workspace, 'demo', 'note.md'), '# hi\n')
			const file = await files.read('demo', 'workspace', 'note.md')
			expect(file.content).toBe('# hi\n')
			expect(file.binary).toBeUndefined()
		})

		it('flags a binary file instead of returning mojibake', async () => {
			await fs.writeFile(path.join(workspace, 'demo', 'blob.bin'), Buffer.from([1, 0, 2, 3]))
			const file = await files.read('demo', 'workspace', 'blob.bin')
			expect(file.binary).toBe(true)
			expect(file.content).toBeUndefined()
		})

		it('flags a file too large to edit', async () => {
			await fs.writeFile(path.join(workspace, 'demo', 'big.txt'), 'a'.repeat(600 * 1024))
			const file = await files.read('demo', 'workspace', 'big.txt')
			expect(file.tooLarge).toBe(true)
			expect(file.content).toBeUndefined()
		})

		it('refuses to read a directory as a file', async () => {
			await fs.mkdir(path.join(workspace, 'demo', 'sub'))
			await expect(files.read('demo', 'workspace', 'sub')).rejects.toThrow(/is a directory/)
		})
	})

	describe('writing', () => {
		it('creates a file and the folders above it', async () => {
			await files.write('demo', 'workspace', 'docs/deep/note.md', 'body')
			expect(await fs.readFile(path.join(workspace, 'demo', 'docs/deep/note.md'), 'utf-8')).toBe(
				'body',
			)
		})

		it('leaves no temp file behind', async () => {
			await files.write('demo', 'workspace', 'note.md', 'body')
			const names = await fs.readdir(path.join(workspace, 'demo'))
			expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
		})

		it('refuses the ledger files, which have their own editors', async () => {
			await expect(files.write('demo', 'workspace', '.project.json', '{}')).rejects.toThrow(
				/managed by the project/,
			)
			await expect(files.write('demo', 'workspace', 'tasks.jsonl', '')).rejects.toThrow(
				/managed by the project/,
			)
			// The manifest is intact — the refusal happened before any write.
			const manifest = JSON.parse(
				await fs.readFile(path.join(workspace, 'demo', '.project.json'), 'utf-8'),
			)
			expect(manifest.name).toBe('Demo')
		})

		it('allows a file that merely shares a name deeper in the tree', async () => {
			// The guard is about the project's own ledger, not the string ".project.json".
			await files.write('demo', 'workspace', 'fixtures/.project.json', '{}')
			expect(
				await fs.readFile(path.join(workspace, 'demo', 'fixtures/.project.json'), 'utf-8'),
			).toBe('{}')
		})

		it('refuses content past the write cap', async () => {
			await expect(
				files.write('demo', 'workspace', 'huge.txt', 'a'.repeat(3 * 1024 * 1024)),
			).rejects.toThrow(/too large/)
		})
	})

	describe('mkdir, rename and delete', () => {
		it('creates a folder', async () => {
			await files.mkdir('demo', 'workspace', 'assets/raw')
			expect((await fs.stat(path.join(workspace, 'demo', 'assets/raw'))).isDirectory()).toBe(true)
		})

		it('creates an empty file', async () => {
			await files.create('demo', 'workspace', 'fresh/new.md')
			expect(await fs.readFile(path.join(workspace, 'demo', 'fresh/new.md'), 'utf-8')).toBe('')
		})

		it('refuses to create over an existing file, rather than emptying it', async () => {
			// The New-file button sends this. An empty write here would destroy the file silently.
			await files.write('demo', 'workspace', 'keep.md', 'precious')
			await expect(files.create('demo', 'workspace', 'keep.md')).rejects.toThrow(/already exists/)
			expect(await fs.readFile(path.join(workspace, 'demo', 'keep.md'), 'utf-8')).toBe('precious')
		})

		it('refuses to create over the ledger files or the root', async () => {
			await expect(files.create('demo', 'workspace', 'tasks.jsonl')).rejects.toThrow(
				/managed by the project/,
			)
			await expect(files.create('demo', 'workspace', '')).rejects.toThrow(/refusing to overwrite/)
		})

		it('renames a file', async () => {
			await files.write('demo', 'workspace', 'old.md', 'x')
			const moved = await files.rename('demo', 'workspace', 'old.md', 'docs/new.md')
			expect(moved.rel).toBe('docs/new.md')
			expect(await fs.readFile(path.join(workspace, 'demo', 'docs/new.md'), 'utf-8')).toBe('x')
		})

		it('refuses a rename that would clobber an existing file', async () => {
			await files.write('demo', 'workspace', 'a.md', 'a')
			await files.write('demo', 'workspace', 'b.md', 'b')
			await expect(files.rename('demo', 'workspace', 'a.md', 'b.md')).rejects.toThrow(
				/already exists/,
			)
			expect(await fs.readFile(path.join(workspace, 'demo', 'b.md'), 'utf-8')).toBe('b')
		})

		it('refuses to rename the ledger files', async () => {
			await expect(files.rename('demo', 'workspace', 'tasks.jsonl', 'x.jsonl')).rejects.toThrow(
				/managed by the project/,
			)
		})

		it('deletes a file, and a folder with its contents', async () => {
			await files.write('demo', 'workspace', 'gone.md', 'x')
			expect((await files.remove('demo', 'workspace', 'gone.md')).kind).toBe('file')

			await files.write('demo', 'workspace', 'tree/deep/x.md', 'x')
			expect((await files.remove('demo', 'workspace', 'tree')).kind).toBe('dir')
			expect(await fs.stat(path.join(workspace, 'demo', 'tree')).catch(() => null)).toBeNull()
		})

		it('refuses to delete the project root — that is what archiving is for', async () => {
			await expect(files.remove('demo', 'workspace', '')).rejects.toThrow(/refusing to delete/)
			await expect(files.remove('demo', 'workspace', '.')).rejects.toThrow(/refusing to delete/)
			expect((await fs.stat(path.join(workspace, 'demo'))).isDirectory()).toBe(true)
		})

		it('refuses to delete the ledger files', async () => {
			await expect(files.remove('demo', 'workspace', '.project.json')).rejects.toThrow(
				/managed by the project/,
			)
			expect(await fs.stat(path.join(workspace, 'demo', '.project.json'))).toBeTruthy()
		})
	})

	describe('upload targets', () => {
		it('takes the basename and drops control characters', async () => {
			const picked = await files.uploadTarget('demo', 'workspace', '', '../../etc/pa\u0000sswd')
			expect(picked.rel).toBe('passwd')
		})

		it('suffixes around a collision rather than overwriting', async () => {
			await files.write('demo', 'workspace', 'photo.jpg', 'first')
			expect((await files.uploadTarget('demo', 'workspace', '', 'photo.jpg')).rel).toBe(
				'photo (1).jpg',
			)

			await files.write('demo', 'workspace', 'photo (1).jpg', 'second')
			expect((await files.uploadTarget('demo', 'workspace', '', 'photo.jpg')).rel).toBe(
				'photo (2).jpg',
			)
			// Neither existing file was touched by asking.
			expect(await fs.readFile(path.join(workspace, 'demo', 'photo.jpg'), 'utf-8')).toBe('first')
		})

		it('never hands back a ledger name', async () => {
			const picked = await files.uploadTarget('demo', 'workspace', '', 'tasks.jsonl')
			expect(picked.rel).toBe('tasks (1).jsonl')
		})

		it('lands in the folder being browsed', async () => {
			await files.mkdir('demo', 'workspace', 'assets/raw')
			expect((await files.uploadTarget('demo', 'workspace', 'assets/raw', 'a.mov')).rel).toBe(
				'assets/raw/a.mov',
			)
		})

		it('refuses a folder outside the project', async () => {
			await expect(files.uploadTarget('demo', 'workspace', '../..', 'x.txt')).rejects.toThrow(
				/escapes/,
			)
		})

		it('refuses a folder that is not there', async () => {
			await expect(files.uploadTarget('demo', 'workspace', 'nope', 'x.txt')).rejects.toThrow(
				/not a directory/,
			)
		})
	})

	describe('the attached root', () => {
		it('reads and writes files in the project root, not just the workspace', async () => {
			const repo = path.join(dir, 'repo')
			await fs.mkdir(repo, { recursive: true })
			await fs.writeFile(path.join(repo, 'README.md'), 'repo readme')
			await store.create({ id: 'coded', name: 'Coded', kind: 'code', root: repo })

			expect((await files.read('coded', 'root', 'README.md')).content).toBe('repo readme')

			await files.write('coded', 'root', 'src/index.ts', 'export {}')
			expect(await fs.readFile(path.join(repo, 'src/index.ts'), 'utf-8')).toBe('export {}')
		})

		it('does not apply the workspace ledger guard to the attached root', async () => {
			// A repo may legitimately contain a file with one of these names.
			const repo = path.join(dir, 'repo2')
			await fs.mkdir(repo, { recursive: true })
			await store.create({ id: 'coded2', name: 'Coded2', kind: 'code', root: repo })

			await files.write('coded2', 'root', 'tasks.jsonl', '{}')
			expect(await fs.readFile(path.join(repo, 'tasks.jsonl'), 'utf-8')).toBe('{}')
		})

		it('refuses a root the project does not have', async () => {
			await expect(files.list('demo', 'root')).rejects.toThrow(/has no root/)
		})
	})
})
