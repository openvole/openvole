/**
 * Browsing and editing the files a project owns.
 *
 * A project has at most two places its files live: its own folder in the agent workspace
 * (`.openvole/workspace/<id>/` — CONTEXT.md, notes, anything the agent writes for itself) and its
 * `root`, when it is attached to files elsewhere such as a repo or a footage folder. This module is
 * the only path the dashboard uses to read or change either, so the boundary is enforced in one
 * place rather than at each call site.
 *
 * The boundary is *the project's own roots*, which is tighter than `security.allowedPaths`: a file
 * manager writes and deletes, so it should not be able to wander the whole grant. The root is
 * re-authorized against `allowedPaths` on every request rather than trusted from the manifest —
 * revoking a grant has to actually revoke it, even for a project created while it was still held.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createLogger } from '../core/logger.js'
import { type ProjectStore, RESERVED_BASENAMES, validateProjectRoot } from './store.js'
import { ProjectError } from './types.js'

const logger = createLogger('project-files')

/** Read cap. Past this an editor is the wrong tool, and the payload rides a websocket frame. */
const MAX_READ_BYTES = 512 * 1024
/** Write cap. Generous for text, small enough that a runaway client cannot fill a disk. */
const MAX_WRITE_BYTES = 2 * 1024 * 1024
/** Entries per listing. `node_modules` is one directory with a hundred thousand children. */
const MAX_ENTRIES = 2000

/**
 * Files the project ledger owns, which this surface will read but never write.
 *
 * `.project.json` has a proper editor (the project form) and `tasks.jsonl` is an append-only log
 * the agent may be writing to right now — hand-editing either from a text box is how you corrupt a
 * project. The same list the `workspace_write` scratch guard uses, applied to the human surface.
 */
const RESERVED = new Set<string>(RESERVED_BASENAMES)

export type FileRootKey = 'workspace' | 'root'

export interface FileRoot {
	key: FileRootKey
	/** What to call it in a UI — "Project folder" or the basename of the attached root. */
	label: string
	path: string
}

export interface FileEntry {
	name: string
	kind: 'file' | 'dir'
	size: number
	modified: string
	/** A symlink, resolved for its kind but flagged: following it can leave the project. */
	link?: boolean
	/** Readable but not writable — see RESERVED. */
	reserved?: boolean
}

export interface FileListing {
	root: FileRootKey
	/** Path relative to the root, `''` at the top. Always POSIX-separated for the UI. */
	rel: string
	/** Absolute path, so the UI can show where it actually is on disk. */
	path: string
	parent: string | null
	entries: FileEntry[]
	truncated: boolean
}

export interface FileContent {
	root: FileRootKey
	rel: string
	path: string
	size: number
	modified: string
	/** Absent when `binary` or `tooLarge` — there is nothing sensible to put in an editor. */
	content?: string
	binary?: boolean
	tooLarge?: boolean
}

export class ProjectFileError extends ProjectError {}

/** Is `target` the same as `root`, or inside it? */
function isInside(target: string, root: string): boolean {
	if (target === root) return true
	return target.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
}

/**
 * Resolve a client-supplied relative path against a root, refusing anything that leaves it.
 *
 * Three defences, because each covers a case the others miss: explicit `..` rejection catches the
 * obvious traversal, containment after `resolve` catches encodings that normalize into one, and
 * realpath of the nearest existing ancestor catches a symlink planted inside the root that points
 * out of it — the only one of the three that survives a purely lexical check.
 */
async function resolveWithin(root: string, rel: string): Promise<string> {
	const cleaned = (rel ?? '').replace(/^[/\\]+/, '').trim()
	const segments = cleaned.split(/[/\\]+/).filter((s) => s && s !== '.')
	if (segments.some((s) => s === '..')) {
		throw new ProjectFileError(`path escapes the project: ${rel}`)
	}

	const target = path.resolve(root, ...segments)
	if (!isInside(target, root)) throw new ProjectFileError(`path escapes the project: ${rel}`)

	// realpath only resolves paths that exist, so walk up to the deepest ancestor that does — this
	// has to work for a file about to be created as well as one already there.
	let probe = target
	for (;;) {
		try {
			const real = await fs.realpath(probe)
			const realRoot = await fs.realpath(root)
			if (!isInside(real, realRoot)) {
				throw new ProjectFileError(`path escapes the project via a symlink: ${rel}`)
			}
			break
		} catch (err) {
			if (err instanceof ProjectFileError) throw err
			const parent = path.dirname(probe)
			if (parent === probe) break
			probe = parent
		}
	}

	return target
}

function toRel(root: string, abs: string): string {
	const rel = path.relative(root, abs)
	return rel.split(path.sep).join('/')
}

export class ProjectFiles {
	constructor(private readonly projects: ProjectStore) {}

	/**
	 * Where this project's files live — one entry, or two when it is attached to an external root.
	 *
	 * An external root that no longer resolves inside `allowedPaths` is simply absent, so a revoked
	 * grant closes the browser rather than erroring on every click.
	 */
	async roots(projectId: string): Promise<FileRoot[]> {
		const project = await this.projects.get(projectId)
		if (!project) throw new ProjectFileError(`no such project: ${projectId}`)

		const roots: FileRoot[] = [
			{ key: 'workspace', label: 'Project folder', path: this.projects.dirFor(projectId) },
		]

		if (project.root) {
			try {
				const real = await validateProjectRoot(project.root, this.projects.allowedRoots)
				roots.push({ key: 'root', label: path.basename(real) || real, path: real })
			} catch (err) {
				logger.warn(`project ${projectId} root unavailable: ${(err as Error).message}`)
			}
		}

		return roots
	}

	private async rootPath(projectId: string, key: FileRootKey): Promise<string> {
		const found = (await this.roots(projectId)).find((r) => r.key === key)
		if (!found) throw new ProjectFileError(`project ${projectId} has no ${key} root`)
		return found.path
	}

	/** Absolute path for a project-relative path, authorized. Public so callers can display it. */
	async resolve(projectId: string, key: FileRootKey, rel: string): Promise<string> {
		return resolveWithin(await this.rootPath(projectId, key), rel)
	}

	async list(projectId: string, key: FileRootKey, rel = ''): Promise<FileListing> {
		const root = await this.rootPath(projectId, key)
		const target = await resolveWithin(root, rel)

		const stat = await fs.stat(target).catch(() => null)
		if (!stat) throw new ProjectFileError(`not found: ${rel || '.'}`)
		if (!stat.isDirectory()) throw new ProjectFileError(`not a directory: ${rel}`)

		const dirents = await fs.readdir(target, { withFileTypes: true })
		const truncated = dirents.length > MAX_ENTRIES
		const entries: FileEntry[] = []

		for (const dirent of dirents.slice(0, MAX_ENTRIES)) {
			const abs = path.join(target, dirent.name)
			// stat, not lstat, so a symlinked directory browses as a directory. It cannot be used to
			// leave the project — resolveWithin realpaths on the way back in.
			const entryStat = await fs.stat(abs).catch(() => null)
			const isDir = entryStat ? entryStat.isDirectory() : dirent.isDirectory()
			entries.push({
				name: dirent.name,
				kind: isDir ? 'dir' : 'file',
				size: entryStat?.size ?? 0,
				modified: (entryStat?.mtime ?? new Date(0)).toISOString(),
				...(dirent.isSymbolicLink() ? { link: true } : {}),
				...(key === 'workspace' && !rel && RESERVED.has(dirent.name) ? { reserved: true } : {}),
			})
		}

		entries.sort((a, b) =>
			a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
		)

		const relPath = toRel(root, target)
		return {
			root: key,
			rel: relPath,
			path: target,
			parent: relPath ? toRel(root, path.dirname(target)) : null,
			entries,
			truncated,
		}
	}

	async read(projectId: string, key: FileRootKey, rel: string): Promise<FileContent> {
		const root = await this.rootPath(projectId, key)
		const target = await resolveWithin(root, rel)

		const stat = await fs.stat(target).catch(() => null)
		if (!stat) throw new ProjectFileError(`not found: ${rel}`)
		if (stat.isDirectory()) throw new ProjectFileError(`is a directory: ${rel}`)

		const base = {
			root: key,
			rel: toRel(root, target),
			path: target,
			size: stat.size,
			modified: stat.mtime.toISOString(),
		}
		if (stat.size > MAX_READ_BYTES) return { ...base, tooLarge: true }

		const buf = await fs.readFile(target)
		// A NUL byte in the first block is the same heuristic git uses, and it is right often enough
		// that an editor never opens a JPEG as mojibake.
		if (buf.subarray(0, 8000).includes(0)) return { ...base, binary: true }

		return { ...base, content: buf.toString('utf-8') }
	}

	async write(
		projectId: string,
		key: FileRootKey,
		rel: string,
		content: string,
	): Promise<{ path: string; rel: string; size: number }> {
		const root = await this.rootPath(projectId, key)
		const target = await this.assertWritable(root, key, rel)

		const bytes = Buffer.from(content, 'utf-8')
		if (bytes.length > MAX_WRITE_BYTES) {
			throw new ProjectFileError(`file too large to save (${bytes.length} bytes)`)
		}

		const stat = await fs.stat(target).catch(() => null)
		if (stat?.isDirectory()) throw new ProjectFileError(`is a directory: ${rel}`)

		await fs.mkdir(path.dirname(target), { recursive: true })
		// Write-then-rename: a crash mid-save leaves the previous file intact rather than a partial
		// one, the same guarantee the manifests get.
		const tmp = `${target}.${process.pid}.tmp`
		await fs.writeFile(tmp, bytes)
		await fs.rename(tmp, target)

		logger.info(`wrote ${target} (${bytes.length} bytes)`)
		return { path: target, rel: toRel(root, target), size: bytes.length }
	}

	/**
	 * Create a new empty file, refusing one that is already there.
	 *
	 * Separate from `write` because "New file" with the name of an existing file would otherwise
	 * truncate it — silently destroying content is the one thing a create button must never do.
	 * `wx` does the check and the create in one syscall, so there is no window between them.
	 */
	async create(
		projectId: string,
		key: FileRootKey,
		rel: string,
	): Promise<{ path: string; rel: string }> {
		const root = await this.rootPath(projectId, key)
		const target = await this.assertWritable(root, key, rel)
		if (target === root) throw new ProjectFileError('refusing to overwrite the project root')

		await fs.mkdir(path.dirname(target), { recursive: true })
		try {
			await fs.writeFile(target, '', { flag: 'wx' })
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
				throw new ProjectFileError(`already exists: ${rel}`)
			}
			throw err
		}

		logger.info(`created ${target}`)
		return { path: target, rel: toRel(root, target) }
	}

	/**
	 * Pick a free path for an uploaded file, authorized and collision-free.
	 *
	 * An upload must never fail for a name clash and never overwrite what is already there, so a
	 * taken name gets a " (n)" suffix — the same thing every file manager does when you drop a
	 * second copy in. The ledger names are treated as taken for the same reason they are read-only.
	 */
	async uploadTarget(
		projectId: string,
		key: FileRootKey,
		relDir: string,
		name: string,
	): Promise<{ path: string; rel: string }> {
		const root = await this.rootPath(projectId, key)
		const dir = await resolveWithin(root, relDir)

		const stat = await fs.stat(dir).catch(() => null)
		if (!stat?.isDirectory()) throw new ProjectFileError(`not a directory: ${relDir}`)

		// A browser sends whatever the OS gave it, including paths on some platforms — take the
		// basename and drop control characters before it ever reaches a filesystem call.
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars
		const safe =
			path
				.basename(name)
				.replace(/[\x00-\x1f/\\]/g, '')
				.trim() || 'file'
		const ext = path.extname(safe)
		const stem = safe.slice(0, safe.length - ext.length) || 'file'
		const guarded = key === 'workspace' && dir === root

		for (let n = 0; n < 1000; n++) {
			const candidate = n === 0 ? safe : `${stem} (${n})${ext}`
			if (guarded && RESERVED.has(candidate)) continue
			const target = path.join(dir, candidate)
			if (!(await fs.stat(target).catch(() => null))) {
				return { path: target, rel: toRel(root, target) }
			}
		}

		throw new ProjectFileError(`no free name for ${safe} — a thousand copies is enough`)
	}

	async mkdir(projectId: string, key: FileRootKey, rel: string): Promise<{ path: string }> {
		const root = await this.rootPath(projectId, key)
		const target = await resolveWithin(root, rel)
		if (target === root) throw new ProjectFileError('refusing to create the root itself')
		await fs.mkdir(target, { recursive: true })
		return { path: target }
	}

	async remove(
		projectId: string,
		key: FileRootKey,
		rel: string,
	): Promise<{ path: string; kind: 'file' | 'dir' }> {
		const root = await this.rootPath(projectId, key)
		const target = await this.assertWritable(root, key, rel)
		if (target === root) throw new ProjectFileError('refusing to delete the project root')

		const stat = await fs.lstat(target).catch(() => null)
		if (!stat) throw new ProjectFileError(`not found: ${rel}`)

		const kind = stat.isDirectory() ? ('dir' as const) : ('file' as const)
		await fs.rm(target, { recursive: kind === 'dir', force: false })
		logger.info(`deleted ${target}`)
		return { path: target, kind }
	}

	/**
	 * Rename within the same root. `to` is a full project-relative path, so this also moves.
	 */
	async rename(
		projectId: string,
		key: FileRootKey,
		rel: string,
		to: string,
	): Promise<{ path: string; rel: string }> {
		const root = await this.rootPath(projectId, key)
		const from = await this.assertWritable(root, key, rel)
		const target = await this.assertWritable(root, key, to)
		if (from === root || target === root) throw new ProjectFileError('refusing to move the root')

		if (await fs.stat(target).catch(() => null)) {
			throw new ProjectFileError(`already exists: ${to}`)
		}

		await fs.mkdir(path.dirname(target), { recursive: true })
		await fs.rename(from, target)
		return { path: target, rel: toRel(root, target) }
	}

	/** Resolve for a mutating call, refusing the ledger files. */
	private async assertWritable(root: string, key: FileRootKey, rel: string): Promise<string> {
		const target = await resolveWithin(root, rel)
		if (
			key === 'workspace' &&
			path.dirname(target) === root &&
			RESERVED.has(path.basename(target))
		) {
			throw new ProjectFileError(
				`${path.basename(target)} is managed by the project itself — edit it through the project form or the task board`,
			)
		}
		return target
	}
}
