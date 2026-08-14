import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, isValidProjectId } from '../../src/project/store.js'
import { ProjectError } from '../../src/project/types.js'

/**
 * Projects are directories, and the filesystem is the index — a directory is a project exactly
 * when it holds a readable `.project.json`. That has two consequences worth pinning: a folder
 * someone drops into the workspace by hand is not a project, and a corrupt manifest must cost one
 * project rather than the whole listing.
 */

describe('ProjectStore', () => {
	let dir: string
	let workspace: string
	let store: ProjectStore

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-projects-'))
		workspace = path.join(dir, '.openvole', 'workspace')
		store = new ProjectStore(workspace, { agentRoot: dir })
		await store.init()
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('creates a self-contained project and reads it back', async () => {
		const created = await store.create({
			id: 'nart-chapter-9',
			name: 'Nart Ch. 9',
			kind: 'writing',
		})
		expect(created.root).toBeUndefined()
		expect(created.status).toBe('active')

		const read = await store.get('nart-chapter-9')
		expect(read?.name).toBe('Nart Ch. 9')
		expect(read?.kind).toBe('writing')

		const onDisk = JSON.parse(
			await fs.readFile(path.join(workspace, 'nart-chapter-9', '.project.json'), 'utf-8'),
		)
		expect(onDisk.id).toBe('nart-chapter-9')
	})

	it('rejects invalid ids and refuses to escape the workspace', async () => {
		expect(isValidProjectId('ok-1.2_3')).toBe(true)
		expect(isValidProjectId('../evil')).toBe(false)
		expect(isValidProjectId('.hidden')).toBe(false)
		expect(isValidProjectId('UPPER')).toBe(false)
		expect(isValidProjectId('')).toBe(false)

		await expect(store.create({ id: '../evil' })).rejects.toThrow(ProjectError)
		await expect(store.create({ id: 'a/b' })).rejects.toThrow(ProjectError)
	})

	it('refuses a duplicate id', async () => {
		await store.create({ id: 'dup' })
		await expect(store.create({ id: 'dup' })).rejects.toThrow(/already exists/)
	})

	it('a directory without a manifest is not a project', async () => {
		await fs.mkdir(path.join(workspace, 'just-a-folder'), { recursive: true })
		await store.create({ id: 'real' })

		const list = await store.list()
		expect(list.map((p) => p.id)).toEqual(['real'])
	})

	it('a corrupt manifest costs one project, not the listing', async () => {
		await store.create({ id: 'good-one' })
		await store.create({ id: 'broken-one' })
		await fs.writeFile(path.join(workspace, 'broken-one', '.project.json'), '{ not json', 'utf-8')

		const list = await store.list()
		expect(list.map((p) => p.id)).toEqual(['good-one'])
		expect(await store.get('broken-one')).toBeNull()
	})

	it('the directory name wins over a stale id in a copied manifest', async () => {
		await store.create({ id: 'original' })
		const raw = JSON.parse(
			await fs.readFile(path.join(workspace, 'original', '.project.json'), 'utf-8'),
		)
		await fs.mkdir(path.join(workspace, 'copied'), { recursive: true })
		await fs.writeFile(
			path.join(workspace, 'copied', '.project.json'),
			JSON.stringify(raw),
			'utf-8',
		)

		const copied = await store.get('copied')
		expect(copied?.id).toBe('copied')
	})

	it('archives without deleting anything, and drops out of the default listing', async () => {
		await store.create({ id: 'old-work', context: 'notes that must survive' })
		await store.archive('old-work')

		expect((await store.list()).map((p) => p.id)).toEqual([])
		expect((await store.list({ status: 'all' })).map((p) => p.id)).toEqual(['old-work'])
		expect(await store.readContext('old-work')).toContain('must survive')
	})

	it('round-trips CONTEXT.md and caps a pathological one', async () => {
		await store.create({ id: 'ctx' })
		await store.writeContext('ctx', '# Project\n\nThe build runs with pnpm.')
		expect(await store.readContext('ctx')).toContain('pnpm')

		await store.writeContext('ctx', 'A'.repeat(25_000))
		const capped = await store.readContext('ctx')
		expect(capped?.length).toBeLessThan(21_000)
		expect(capped).toContain('[... truncated]')
	})

	it('rejects an unknown kind on create and update', async () => {
		await expect(store.create({ id: 'bad-kind', kind: 'spaceship' as never })).rejects.toThrow(
			/invalid kind/,
		)
		await store.create({ id: 'fine' })
		await expect(store.update('fine', { kind: 'spaceship' as never })).rejects.toThrow(
			/invalid kind/,
		)
	})

	it('a torn manifest write leaves the previous one intact', async () => {
		await store.create({ id: 'atomic', name: 'First' })
		// A .tmp sibling is what a crashed write leaves behind; it must not be read as the project.
		await fs.writeFile(path.join(workspace, 'atomic', '.project.json.tmp'), '{ torn', 'utf-8')

		const read = await store.get('atomic')
		expect(read?.name).toBe('First')
	})
})
