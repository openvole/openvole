import { execFileSync } from 'node:child_process'
import type { ToolRegistry } from '../tool/registry.js'
import type { SkillInstance } from './types.js'
import type { ActiveSkill } from '../context/types.js'
import { createLogger } from '../core/logger.js'

const logger = createLogger('skill-resolver')

/**
 * Resolve Skill activation based on the current tool registry
 * and runtime requirements (env vars, binaries).
 *
 * A Skill is active if:
 * - All requiredTools are registered in the tool registry
 * - All requires.env vars are set in the environment
 * - All requires.bins are available on PATH
 * - At least one of requires.anyBins is available (if specified)
 */
export function resolveSkills(
	skills: SkillInstance[],
	toolRegistry: ToolRegistry,
): void {
	for (const skill of skills) {
		const missing: string[] = []

		// Check required tools
		for (const toolName of skill.definition.requiredTools) {
			if (!toolRegistry.has(toolName)) {
				missing.push(`tool:${toolName}`)
			}
		}

		// Check OpenClaw-compatible requirements
		const requires = skill.definition.requires
		if (requires) {
			// Check env vars
			for (const envVar of requires.env) {
				if (!process.env[envVar]) {
					missing.push(`env:${envVar}`)
				}
			}

			// Check required binaries
			for (const bin of requires.bins) {
				if (!isBinaryAvailable(bin)) {
					missing.push(`bin:${bin}`)
				}
			}

			// Check anyBins — at least one must exist
			if (requires.anyBins.length > 0) {
				const hasAny = requires.anyBins.some(isBinaryAvailable)
				if (!hasAny) {
					missing.push(`anyBin:${requires.anyBins.join('|')}`)
				}
			}
		}

		const wasActive = skill.active
		skill.active = missing.length === 0
		skill.missingTools = missing

		if (skill.active && !wasActive) {
			const providers = skill.definition.requiredTools
				.map((t) => toolRegistry.get(t)?.pawName)
				.filter(Boolean)
			const providerInfo = providers.length > 0
				? ` (tools provided by: ${[...new Set(providers)].join(', ')})`
				: ''
			logger.info(`Skill "${skill.name}" activated${providerInfo}`)
		} else if (!skill.active && wasActive) {
			logger.warn(
				`Skill "${skill.name}" deactivated (missing: ${missing.join(', ')})`,
			)
		}
	}
}

/** Build ActiveSkill entries for the AgentContext */
export function buildActiveSkills(
	skills: SkillInstance[],
	toolRegistry: ToolRegistry,
): ActiveSkill[] {
	return skills
		.filter((s) => s.active)
		.map((s) => {
			const satisfiedBy = s.definition.requiredTools
				.map((t) => toolRegistry.get(t)?.pawName)
				.filter((name): name is string => name != null)

			return {
				name: s.name,
				description: s.definition.description,
				satisfiedBy: [...new Set(satisfiedBy)],
			}
		})
}

/** Check if a binary is available on PATH */
function isBinaryAvailable(name: string): boolean {
	try {
		const cmd = process.platform === 'win32' ? 'where' : 'which'
		execFileSync(cmd, [name], { stdio: 'ignore' })
		return true
	} catch {
		return false
	}
}
