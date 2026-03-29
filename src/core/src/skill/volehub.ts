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
 *   3. Download SKILL.md (+ any reference files)
 *   4. Verify SHA-256 hash
 *   5. Extract to .openvole/skills/volehub/<name>/
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { createLogger } from '../core/logger.js'

const logger = createLogger('volehub')

const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/openvole/volehub/main'

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

		return await response.json() as VoleHubIndex
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

	/** Download and install a skill to the project */
	async install(
		skillName: string,
		projectRoot: string,
	): Promise<{ installed: boolean; path: string; skill: VoleHubSkill }> {
		const skill = await this.getSkill(skillName)
		if (!skill) {
			throw new Error(`Skill "${skillName}" not found in VoleHub`)
		}

		const skillDir = path.resolve(projectRoot, '.openvole', 'skills', 'volehub', skill.name)
		await fs.mkdir(skillDir, { recursive: true })

		// Download SKILL.md
		const skillMdUrl = skill.downloadUrl
			?? `${this.registryUrl}/skills/${skill.name}/SKILL.md`

		logger.info(`Downloading ${skill.name}@${skill.version} from ${skillMdUrl}`)

		const response = await fetch(skillMdUrl)
		if (!response.ok) {
			throw new Error(`Failed to download skill: ${response.status}`)
		}

		const content = await response.text()

		// Verify SHA-256 hash
		const hash = crypto.createHash('sha256').update(content).digest('hex')
		if (hash !== skill.contentHash) {
			throw new Error(
				`SHA-256 hash mismatch for "${skill.name}". Expected: ${skill.contentHash}, got: ${hash}. The skill may have been tampered with.`,
			)
		}

		// Write SKILL.md
		const skillMdPath = path.join(skillDir, 'SKILL.md')
		await fs.writeFile(skillMdPath, content, 'utf-8')

		// Write manifest for tracking
		const manifestPath = path.join(skillDir, 'manifest.json')
		await fs.writeFile(
			manifestPath,
			JSON.stringify(
				{
					name: skill.name,
					version: skill.version,
					publisher: skill.publisher,
					installedAt: new Date().toISOString(),
					contentHash: hash,
					source: 'volehub',
				},
				null,
				2,
			),
			'utf-8',
		)

		logger.info(`Installed ${skill.name}@${skill.version} to ${skillDir}`)

		return { installed: true, path: skillDir, skill }
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
	async listInstalled(projectRoot: string): Promise<Array<{
		name: string
		version: string
		installedAt: string
	}>> {
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
	async preparePublish(
		skillPath: string,
	): Promise<{
		name: string
		version: string
		description: string
		content: string
		contentHash: string
		requiredTools: string[]
		tags: string[]
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

		return { name, version, description, content, contentHash, requiredTools, tags }
	}
}
