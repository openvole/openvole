/** A Skill definition — behavioral recipe */
export interface SkillDefinition {
	name: string
	version: string
	description: string
	requiredTools: string[]
	optionalTools?: string[]
	instructions: string
	tags?: string[]
}
