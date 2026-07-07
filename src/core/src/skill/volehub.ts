/**
 * VoleHub registry client.
 *
 * Phase 1: GitHub-based registry at openvole/volehub.
 * Skills stored as directories with SKILL.md + manifest.json.
 * INDEX.json provides searchable skill metadata.
 *
 * Installation flow:
 *   1. Fetch INDEX.json from GitHub
 *   2. Find skill by name
 *   3. Download every bundled file (SKILL.md + scripts/references/assets) from its `files`
 *      manifest, or discover them from the registry when the entry predates manifests
 *   4. Verify each file's SHA-256 hash
 *   5. Write to .openvole/skills/volehub/<name>/, preserving directory structure
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createLogger } from '../core/logger.js'

const logger = createLogger('volehub')

const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/openvole/volehub/main'

/** Files never fetched or published as part of a skill (build junk, tracking, VCS). */
const IGNORED_SKILL_FILES = /(^|\/)(__pycache__|\.git|\.DS_Store|manifest\.json)(\/|$)|\.pyc$/

/** One bundled file in a skill, with its integrity hash. */
export interface SkillFile {
	path: string
	sha256: string
}

export interface VoleHubSkill {
	name: string
	version: string
	description: string
	publisher: string
	tags: string[]
	requiredTools: string[]
	optionalTools?: string[]
	contentHash: string
	publishedAt: string
	downloadUrl?: string
	repository?: string
	/** All bundled files (SKILL.md + scripts/references/assets) with per-file hashes. */
	files?: SkillFile[]
}

export interface VoleHubIndex {
	updatedAt: string
	skills: VoleHubSkill[]
}

export class VoleHubClient {
	private registryUrl: string

	constructor(registryUrl?: string) {
		this.registryUrl = registryUrl ?? DEFAULT_REGISTRY
	}

	/** Fetch the skill index from the registry */
	async fetchIndex(): Promise<VoleHubIndex> {
		const url = `${this.registryUrl}/INDEX.json`
		logger.info(`Fetching VoleHub index from ${url}`)

		const response = await fetch(url)
		if (!response.ok) {
			throw new Error(`Failed to fetch VoleHub index: ${response.status} ${response.statusText}`)
		}

		return (await response.json()) as VoleHubIndex
	}

	/** Search skills by query (text match on name, description, tags) */
	async search(query: string): Promise<VoleHubSkill[]> {
		const index = await this.fetchIndex()
		const lower = query.toLowerCase()

		return index.skills.filter((skill) => {
			return (
				skill.name.toLowerCase().includes(lower) ||
				skill.description.toLowerCase().includes(lower) ||
				skill.tags.some((tag) => tag.toLowerCase().includes(lower))
			)
		})
	}

	/** Get a specific skill by name */
	async getSkill(name: string): Promise<VoleHubSkill | null> {
		const index = await this.fetchIndex()
		return index.skills.find((s) => s.name === name) ?? null
	}

	/** Download and install a skill (all bundled files) to the project */
	async install(
		skillName: string,
		projectRoot: string,
	): Promise<{ installed: boolean; path: string; skill: VoleHubSkill; files: string[] }> {
		const skill = await this.getSkill(skillName)
		if (!skill) {
			throw new Error(`Skill "${skillName}" not found in VoleHub`)
		}

		const skillDir = path.resolve(projectRoot, '.openvole', 'skills', 'volehub', skill.name)
		await fs.mkdir(skillDir, { recursive: true })

		// Resolve the file list: an explicit manifest (integrity-checked) or, if the skill predates
		// manifests, discover the directory from the registry so bundled scripts still download.
		const manifest = skill.files?.length ? skill.files : null
		const relPaths = manifest ? manifest.map((f) => f.path) : await this.discoverFiles(skill.name)
		if (!relPaths.includes('SKILL.md')) relPaths.unshift('SKILL.md')
		const expectedHash = new Map((manifest ?? []).map((f) => [f.path, f.sha256]))

		logger.info(`Downloading ${skill.name}@${skill.version} (${relPaths.length} files)`)

		const written: string[] = []
		for (const rel of relPaths) {
			// Never write outside the skill directory (a malicious registry entry could try to).
			const dest = path.resolve(skillDir, rel)
			if (dest !== skillDir && !dest.startsWith(skillDir + path.sep)) {
				throw new Error(`Refusing to write outside the skill directory: ${rel}`)
			}
			const encoded = rel.split('/').map(encodeURIComponent).join('/')
			const url = `${this.registryUrl}/skills/${encodeURIComponent(skill.name)}/${encoded}`
			const res = await fetch(url)
			if (!res.ok) {
				if (rel === 'SKILL.md') throw new Error(`Failed to download SKILL.md: ${res.status}`)
				logger.warn(`Skipping "${rel}" (${res.status})`)
				continue
			}
			const buf = Buffer.from(await res.arrayBuffer())
			// SKILL.md is always verified against contentHash; other files against the manifest.
			const expected = expectedHash.get(rel) ?? (rel === 'SKILL.md' ? skill.contentHash : undefined)
			if (expected) {
				const hash = crypto.createHash('sha256').update(buf).digest('hex')
				if (hash !== expected) {
					throw new Error(
						`SHA-256 mismatch for "${rel}" in "${skill.name}" — expected ${expected}, got ${hash}. The skill may have been tampered with.`,
					)
				}
			}
			await fs.mkdir(path.dirname(dest), { recursive: true })
			await fs.writeFile(dest, buf)
			written.push(rel)
		}
		if (!written.includes('SKILL.md')) {
			throw new Error(`"${skill.name}" has no SKILL.md`)
		}

		// Write manifest for tracking (installed files + SKILL.md hash).
		const skillMdHash = crypto
			.createHash('sha256')
			.update(await fs.readFile(path.join(skillDir, 'SKILL.md')))
			.digest('hex')
		await fs.writeFile(
			path.join(skillDir, 'manifest.json'),
			JSON.stringify(
				{
					name: skill.name,
					version: skill.version,
					publisher: skill.publisher,
					installedAt: new Date().toISOString(),
					contentHash: skillMdHash,
					files: written,
					source: 'volehub',
				},
				null,
				2,
			),
			'utf-8',
		)

		logger.info(`Installed ${skill.name}@${skill.version} (${written.length} files) to ${skillDir}`)

		return { installed: true, path: skillDir, skill, files: written }
	}

	/**
	 * Discover a skill's files from the registry when the index has no `files` manifest.
	 * Works for GitHub-hosted registries via the git-trees API; otherwise SKILL.md only.
	 */
	private async discoverFiles(name: string): Promise<string[]> {
		const m = this.registryUrl.match(
			/(?:raw\.githubusercontent|github)\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/?#]+)/,
		)
		if (!m) return ['SKILL.md']
		const [, owner, repo, ref] = m
		try {
			const res = await fetch(
				`https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`,
				{ headers: { Accept: 'application/vnd.github+json' } },
			)
			if (!res.ok) return ['SKILL.md']
			const data = (await res.json()) as { tree?: Array<{ path: string; type: string }> }
			const prefix = `skills/${name}/`
			const files = (data.tree ?? [])
				.filter((t) => t.type === 'blob' && t.path.startsWith(prefix))
				.map((t) => t.path.slice(prefix.length))
				.filter((p) => p && !IGNORED_SKILL_FILES.test(p))
			return files.length ? files : ['SKILL.md']
		} catch {
			return ['SKILL.md']
		}
	}

	/** Uninstall a VoleHub skill */
	async uninstall(skillName: string, projectRoot: string): Promise<boolean> {
		const skillDir = path.resolve(projectRoot, '.openvole', 'skills', 'volehub', skillName)
		try {
			await fs.rm(skillDir, { recursive: true, force: true })
			logger.info(`Uninstalled ${skillName}`)
			return true
		} catch {
			return false
		}
	}

	/** List installed VoleHub skills */
	async listInstalled(projectRoot: string): Promise<
		Array<{
			name: string
			version: string
			installedAt: string
		}>
	> {
		const volehubDir = path.resolve(projectRoot, '.openvole', 'skills', 'volehub')
		try {
			const entries = await fs.readdir(volehubDir, { withFileTypes: true })
			const skills: Array<{ name: string; version: string; installedAt: string }> = []

			for (const entry of entries) {
				if (!entry.isDirectory()) continue
				try {
					const manifest = JSON.parse(
						await fs.readFile(path.join(volehubDir, entry.name, 'manifest.json'), 'utf-8'),
					)
					skills.push({
						name: manifest.name,
						version: manifest.version,
						installedAt: manifest.installedAt,
					})
				} catch {
					// No manifest — skip
				}
			}

			return skills
		} catch {
			return []
		}
	}

	/**
	 * Prepare a skill for publishing.
	 * Reads SKILL.md, generates hash, builds manifest.
	 * Returns the data needed to create a PR against openvole/volehub.
	 */
	async preparePublish(skillPath: string): Promise<{
		name: string
		version: string
		description: string
		content: string
		contentHash: string
		requiredTools: string[]
		tags: string[]
		files: SkillFile[]
	}> {
		const skillMdPath = path.join(skillPath, 'SKILL.md')
		const content = await fs.readFile(skillMdPath, 'utf-8')

		// Parse frontmatter
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
		if (!frontmatterMatch) {
			throw new Error('SKILL.md must have YAML frontmatter (---)')
		}

		const frontmatter = frontmatterMatch[1]
		const getName = (key: string): string => {
			const match = frontmatter.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm'))
			return match?.[1] ?? ''
		}
		const getArray = (key: string): string[] => {
			const match = frontmatter.match(new RegExp(`^${key}:\\s*\\[(.+?)\\]`, 'm'))
			if (!match) return []
			return match[1].split(',').map((s) => s.trim().replace(/["']/g, ''))
		}

		const name = getName('name')
		const version = getName('version') || '1.0.0'
		const description = getName('description')
		const requiredTools = getArray('requiredTools')
		const tags = getArray('tags')

		if (!name) throw new Error('SKILL.md frontmatter must include "name"')
		if (!description) throw new Error('SKILL.md frontmatter must include "description"')

		const contentHash = crypto.createHash('sha256').update(content).digest('hex')
		const files = await collectSkillFiles(skillPath)

		return { name, version, description, content, contentHash, requiredTools, tags, files }
	}
}

/** Recursively hash every bundled file of a skill (for the publish `files` manifest). */
async function collectSkillFiles(skillPath: string, base = skillPath): Promise<SkillFile[]> {
	const out: SkillFile[] = []
	for (const entry of await fs.readdir(skillPath, { withFileTypes: true })) {
		const full = path.join(skillPath, entry.name)
		const rel = path.relative(base, full).split(path.sep).join('/')
		if (IGNORED_SKILL_FILES.test(rel) || IGNORED_SKILL_FILES.test(`${rel}/`)) continue
		if (entry.isDirectory()) {
			out.push(...(await collectSkillFiles(full, base)))
		} else if (entry.isFile()) {
			const buf = await fs.readFile(full)
			out.push({ path: rel, sha256: crypto.createHash('sha256').update(buf).digest('hex') })
		}
	}
	return out.sort((a, b) => a.path.localeCompare(b.path))
}
