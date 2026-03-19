import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { MessageBus } from '../core/bus.js'
import type { ToolRegistry } from '../tool/registry.js'
import type { SkillInstance } from './types.js'
import { loadSkillFromDirectory } from './loader.js'
import { resolveSkills } from './resolver.js'
import { createLogger } from '../core/logger.js'

const logger = createLogger('skill-registry')

/**
 * Resolve a Skill directory path from its name.
 * Resolution order:
 *   1. Explicit path (./ or /) — use as-is
 *   2. skills/<name> — local skills
 *   3. skills/clawhub/<name> — ClawHub-installed skills
 *   4. node_modules/<name> — npm-installed skills
 */
async function resolveSkillPath(name: string, projectRoot: string): Promise<string> {
	// Explicit path (./ or /)
	if (name.startsWith('.') || name.startsWith('/')) {
		return path.resolve(projectRoot, name)
	}

	// clawhub/<name> format → .openvole/skills/clawhub/<name>
	if (name.startsWith('clawhub/')) {
		return path.resolve(projectRoot, '.openvole', 'skills', name)
	}

	// Try .openvole/skills/<name> (local skills)
	const localPath = path.resolve(projectRoot, '.openvole', 'skills', name)
	if (await exists(path.join(localPath, 'SKILL.md'))) return localPath

	// Try .openvole/skills/clawhub/<name> (ClawHub-installed)
	const clawHubPath = path.resolve(projectRoot, '.openvole', 'skills', 'clawhub', name)
	if (await exists(path.join(clawHubPath, 'SKILL.md'))) return clawHubPath

	// Fall back to node_modules
	return path.resolve(projectRoot, 'node_modules', name)
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

/** Manages loaded Skills and their activation state */
export class SkillRegistry {
	private skills = new Map<string, SkillInstance>()

	constructor(
		private bus: MessageBus,
		private toolRegistry: ToolRegistry,
		private projectRoot: string,
	) {
		// Re-run resolver when tools change
		this.bus.on('tool:registered', () => this.resolve())
		this.bus.on('tool:unregistered', () => this.resolve())
	}

	/** Load a Skill from a directory containing SKILL.md */
	async load(nameOrPath: string): Promise<boolean> {
		const skillDir = await resolveSkillPath(nameOrPath, this.projectRoot)
		const definition = await loadSkillFromDirectory(skillDir)

		if (!definition) {
			return false
		}

		// Use the config key as the registry key to avoid collisions
		// clawhub/summarize → "clawhub/summarize", email-triage → "email-triage"
		const registryKey = nameOrPath.startsWith('.') || nameOrPath.startsWith('/')
			? definition.name
			: nameOrPath

		if (this.skills.has(registryKey)) {
			logger.warn(`Skill "${registryKey}" is already loaded`)
			return false
		}

		const instance: SkillInstance = {
			name: registryKey,
			definition,
			path: skillDir,
			active: false,
			missingTools: [...definition.requiredTools],
		}

		this.skills.set(registryKey, instance)
		logger.info(`Skill "${registryKey}" loaded from ${skillDir}`)

		// Run resolver to check activation
		this.resolve()
		return true
	}

	/** Unload a Skill */
	unload(name: string): boolean {
		if (!this.skills.has(name)) {
			return false
		}
		this.skills.delete(name)
		logger.info(`Skill "${name}" unloaded`)
		return true
	}

	/** Re-run the resolver against the current tool registry */
	resolve(): void {
		resolveSkills(Array.from(this.skills.values()), this.toolRegistry)
	}

	/** Get all Skill instances */
	list(): SkillInstance[] {
		return Array.from(this.skills.values())
	}

	/** Get active Skills only */
	active(): SkillInstance[] {
		return this.list().filter((s) => s.active)
	}

	/** Get a Skill by name */
	get(name: string): SkillInstance | undefined {
		return this.skills.get(name)
	}
}
