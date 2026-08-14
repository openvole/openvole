/**
 * Project storage — one directory per project under `.openvole/workspace/`.
 *
 * A directory is a project exactly when it holds a readable `.project.json`. There is no index
 * file: the filesystem is the truth, so a project stays portable (VoleDrop the folder to another
 * agent, sync it over VoleNet) and nothing can desync.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createLogger } from '../core/logger.js'
import {
	ProjectError,
	type ProjectKind,
	type ProjectManifest,
	ProjectRootError,
	type ProjectStatus,
} from './types.js'

const logger = createLogger('project')

export const MANIFEST_NAME = '.project.json'
export const CONTEXT_NAME = 'CONTEXT.md'
export const TASKS_NAME = 'tasks.jsonl'

/** Files the project tools own. The workspace_* scratch tools refuse to write these. */
export const RESERVED_BASENAMES: readonly string[] = [MANIFEST_NAME, TASKS_NAME]

/** Same cap the identity files use — CONTEXT.md lands in the system prompt. */
const MAX_CONTEXT_CHARS = 20_000

/** Directory name and id in one: lowercase, no separators, no leading dot. */
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

const KINDS: readonly ProjectKind[] = ['code', 'writing', 'media', 'research', 'general']

export interface CreateProjectInput {
	id: string
	name?: string
	kind?: ProjectKind
	root?: string
	stack?: string[]
	toolProfile?: { allow?: string[]; deny?: string[] }
	tags?: string[]
	/** Initial CONTEXT.md body. */
	context?: string
}

export interface ProjectStoreOptions {
	/**
	 * Roots the agent may point a project at, beyond its own agent directory — this is
	 * `security.allowedPaths` from vole.config.json. Empty means external projects are refused
	 * until a human grants a path.
	 */
	allowedPaths?: string[]
	/** The agent root. Always allowed (the workspace lives inside it). */
	agentRoot?: string
}

export function isValidProjectId(id: string): boolean {
	return ID_RE.test(id) && id !== '.' && id !== '..'
}

/**
 * Resolve and authorize a project root.
 *
 * This is a privilege boundary: an external root hands the agent files outside its workspace, so a
 * confused or compromised agent must not be able to widen its own reach by creating a project
 * rooted at `/` or `~`. The root must already resolve inside an allowed path — we never edit
 * vole.config.json here, and the error names the exact path a human would have to grant.
 *
 * Symlinks are resolved before the containment check, so a link inside the workspace pointing at
 * /etc does not smuggle access.
 */
export async function validateProjectRoot(root: string, allowed: string[]): Promise<string> {
	const expanded =
		root === '~' || root.startsWith(`~${path.sep}`) || root.startsWith('~/')
			? path.join(os.homedir(), root.slice(1))
			: root
	const abs = path.resolve(expanded)

	let real: string
	try {
		real = await fs.realpath(abs)
	} catch {
		throw new ProjectRootError(`project root does not exist: ${abs}`)
	}

	const stat = await fs.stat(real)
	if (!stat.isDirectory()) {
		throw new ProjectRootError(`project root is not a directory: ${real}`)
	}

	for (const candidate of allowed) {
		if (!candidate) continue
		let realAllowed: string
		try {
			realAllowed = await fs.realpath(path.resolve(candidate))
		} catch {
			realAllowed = path.resolve(candidate)
		}
		if (real === realAllowed || real.startsWith(realAllowed + path.sep)) {
			return real
		}
	}

	throw new ProjectRootError(
		`project root ${real} is outside the agent's allowed paths. To grant access, add it to security.allowedPaths in vole.config.json.`,
	)
}

export class ProjectStore {
	private readonly workspaceDir: string
	private readonly allowed: string[]

	constructor(workspaceDir: string, opts: ProjectStoreOptions = {}) {
		this.workspaceDir = path.resolve(workspaceDir)
		this.allowed = [
			...(opts.agentRoot ? [path.resolve(opts.agentRoot)] : []),
			...(opts.allowedPaths ?? []),
		]
	}

	async init(): Promise<void> {
		await fs.mkdir(this.workspaceDir, { recursive: true })
	}

	/**
	 * Roots a project may point at: the agent directory plus `security.allowedPaths`.
	 *
	 * Exposed so everything that resolves an external path — creating a project, scanning a
	 * candidate directory — authorizes against the same set. Passing the list separately let the
	 * two drift, which meant a directory you could turn into a project might refuse to be scanned.
	 */
	get allowedRoots(): string[] {
		return [...this.allowed]
	}

	/** Absolute path of a project's own folder. */
	dirFor(id: string): string {
		if (!isValidProjectId(id)) throw new ProjectError(`invalid project id: "${id}"`)
		return path.join(this.workspaceDir, id)
	}

	manifestPath(id: string): string {
		return path.join(this.dirFor(id), MANIFEST_NAME)
	}

	async create(input: CreateProjectInput): Promise<ProjectManifest> {
		const id = input.id?.trim()
		if (!id || !isValidProjectId(id)) {
			throw new ProjectError(
				`invalid project id "${input.id}" — use lowercase letters, digits, dot, dash or underscore (max 64, no leading dot)`,
			)
		}
		if (input.kind && !KINDS.includes(input.kind)) {
			throw new ProjectError(`invalid kind "${input.kind}" — one of ${KINDS.join(', ')}`)
		}

		const dir = this.dirFor(id)
		if (await this.exists(id)) {
			throw new ProjectError(`project "${id}" already exists`)
		}

		// Authorize BEFORE creating anything, so a refused root leaves no directory behind.
		const root = input.root ? await validateProjectRoot(input.root, this.allowed) : undefined

		const now = Date.now()
		const manifest: ProjectManifest = {
			id,
			name: input.name?.trim() || id,
			kind: input.kind ?? 'general',
			...(root ? { root } : {}),
			status: 'active',
			...(input.stack?.length ? { stack: input.stack } : {}),
			...(input.toolProfile ? { toolProfile: input.toolProfile } : {}),
			...(input.tags?.length ? { tags: input.tags } : {}),
			createdAt: now,
			updatedAt: now,
		}

		await fs.mkdir(dir, { recursive: true })
		await this.writeManifest(manifest)
		if (input.context !== undefined) await this.writeContext(id, input.context)

		logger.info(`project created: ${id}${root ? ` → ${root}` : ' (self-contained)'}`)
		return manifest
	}

	async exists(id: string): Promise<boolean> {
		try {
			await fs.access(this.manifestPath(id))
			return true
		} catch {
			return false
		}
	}

	async get(id: string): Promise<ProjectManifest | null> {
		if (!isValidProjectId(id)) return null
		try {
			const raw = await fs.readFile(this.manifestPath(id), 'utf-8')
			const parsed = JSON.parse(raw) as ProjectManifest
			// The directory name is authoritative — a copied folder stays coherent even if the
			// manifest still carries the id it was copied from.
			parsed.id = id
			return parsed
		} catch {
			return null
		}
	}

	/**
	 * Every project in the workspace. A directory without a readable manifest is simply not a
	 * project — a corrupt or half-written manifest must never take down the listing.
	 */
	async list(filter?: { status?: ProjectStatus | 'all' }): Promise<ProjectManifest[]> {
		let entries: string[]
		try {
			entries = await fs.readdir(this.workspaceDir)
		} catch {
			return []
		}

		const out: ProjectManifest[] = []
		for (const entry of entries) {
			if (!isValidProjectId(entry)) continue
			const manifest = await this.get(entry)
			if (!manifest) continue
			const want = filter?.status ?? 'active'
			if (want !== 'all' && manifest.status !== want) continue
			out.push(manifest)
		}
		return out.sort((a, b) => b.updatedAt - a.updatedAt)
	}

	async update(
		id: string,
		patch: Partial<Omit<ProjectManifest, 'id' | 'createdAt'>>,
	): Promise<ProjectManifest> {
		const current = await this.get(id)
		if (!current) throw new ProjectError(`no such project: "${id}"`)

		if (patch.kind && !KINDS.includes(patch.kind)) {
			throw new ProjectError(`invalid kind "${patch.kind}" — one of ${KINDS.join(', ')}`)
		}
		// A root change re-authorizes: the same boundary as create, not a bypass around it.
		const root =
			patch.root !== undefined
				? patch.root
					? await validateProjectRoot(patch.root, this.allowed)
					: undefined
				: current.root

		const { root: _dropped, ...rest } = { ...current, ...patch }
		const next: ProjectManifest = {
			...rest,
			id: current.id,
			createdAt: current.createdAt,
			updatedAt: Date.now(),
			...(root ? { root } : {}),
		}

		await this.writeManifest(next)
		return next
	}

	/** Archive keeps every file — it only drops the project out of the default listing. */
	async archive(id: string): Promise<ProjectManifest> {
		return this.update(id, { status: 'archived' })
	}

	async readContext(id: string): Promise<string | undefined> {
		try {
			const raw = await fs.readFile(path.join(this.dirFor(id), CONTEXT_NAME), 'utf-8')
			if (!raw.trim()) return undefined
			if (raw.length > MAX_CONTEXT_CHARS) {
				logger.warn(`${id}/CONTEXT.md truncated: ${raw.length} → ${MAX_CONTEXT_CHARS} chars`)
				return `${raw.substring(0, MAX_CONTEXT_CHARS)}\n\n[... truncated]`
			}
			return raw
		} catch {
			return undefined
		}
	}

	async writeContext(id: string, body: string): Promise<void> {
		const dir = this.dirFor(id)
		await fs.mkdir(dir, { recursive: true })
		await fs.writeFile(path.join(dir, CONTEXT_NAME), body, 'utf-8')
		// Touch the manifest so "recently worked on" ordering reflects context edits too.
		const current = await this.get(id)
		if (current) await this.writeManifest({ ...current, updatedAt: Date.now() })
	}

	private async writeManifest(manifest: ProjectManifest): Promise<void> {
		const file = this.manifestPath(manifest.id)
		// Write-then-rename: a crash mid-write leaves the previous manifest intact rather than a
		// truncated file that would make the project vanish from every listing.
		const tmp = `${file}.tmp`
		await fs.writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
		await fs.rename(tmp, file)
	}
}
