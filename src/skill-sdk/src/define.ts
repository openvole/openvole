import type { SkillDefinition } from './types.js'

/**
 * defineSkill — the primary export for Skill authors.
 *
 * Validates the definition and returns it. Skills are pure behavioral
 * recipes — no infrastructure, no tool implementations, no side effects.
 */
export function defineSkill(definition: SkillDefinition): SkillDefinition {
	if (!definition.name) {
		throw new Error('Skill must have a name')
	}
	if (!definition.requiredTools || definition.requiredTools.length === 0) {
		throw new Error(`Skill "${definition.name}" must declare at least one required tool`)
	}
	if (!definition.instructions) {
		throw new Error(`Skill "${definition.name}" must provide instructions`)
	}

	return {
		name: definition.name,
		version: definition.version,
		description: definition.description,
		requiredTools: definition.requiredTools,
		optionalTools: definition.optionalTools ?? [],
		instructions: definition.instructions,
		tags: definition.tags ?? [],
	}
}
