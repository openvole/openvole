/** A Skill definition — parsed from SKILL.md */
export interface SkillDefinition {
	name: string
	description: string
	version?: string
	requiredTools: string[]
	optionalTools: string[]
	instructions: string
	tags: string[]
	/** OpenClaw compatibility — runtime requirements */
	requires?: SkillRequirements
}

/** Runtime requirements (OpenClaw-compatible) */
export interface SkillRequirements {
	/** Environment variables the skill expects */
	env: string[]
	/** CLI binaries that must all be installed */
	bins: string[]
	/** CLI binaries where at least one must exist */
	anyBins: string[]
}

/** Runtime state of a loaded Skill */
export interface SkillInstance {
	name: string
	definition: SkillDefinition
	/** Path to the skill directory */
	path: string
	active: boolean
	missingTools: string[]
}
