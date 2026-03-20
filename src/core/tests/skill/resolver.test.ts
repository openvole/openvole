import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveSkills, buildActiveSkills } from '../../src/skill/resolver.js'
import { ToolRegistry } from '../../src/tool/registry.js'
import { createMessageBus } from '../../src/core/bus.js'
import { z } from 'zod'
import type { SkillInstance } from '../../src/skill/types.js'

function makeSkill(overrides: Partial<SkillInstance> = {}): SkillInstance {
	return {
		name: overrides.name ?? 'test-skill',
		definition: {
			name: overrides.name ?? 'test-skill',
			description: 'A test skill',
			requiredTools: [],
			optionalTools: [],
			instructions: 'Do the thing.',
			tags: [],
			...overrides.definition,
		},
		path: '/tmp/skill',
		active: false,
		missingTools: [],
		...overrides,
	}
}

describe('resolveSkills', () => {
	let registry: ToolRegistry

	beforeEach(() => {
		registry = new ToolRegistry(createMessageBus())
	})

	it('activates skill when all required tools are present', () => {
		registry.register('paw-a', [
			{ name: 'gmail_read', description: 'Read', parameters: z.object({}), execute: vi.fn() },
			{ name: 'gmail_send', description: 'Send', parameters: z.object({}), execute: vi.fn() },
		], true)

		const skills = [makeSkill({
			definition: {
				name: 'email',
				description: 'Email',
				requiredTools: ['gmail_read', 'gmail_send'],
				optionalTools: [],
				instructions: 'Handle email',
				tags: [],
			},
		})]

		resolveSkills(skills, registry)
		expect(skills[0].active).toBe(true)
		expect(skills[0].missingTools).toEqual([])
	})

	it('keeps skill inactive when tools are missing', () => {
		registry.register('paw-a', [
			{ name: 'gmail_read', description: 'Read', parameters: z.object({}), execute: vi.fn() },
		], true)

		const skills = [makeSkill({
			definition: {
				name: 'email',
				description: 'Email',
				requiredTools: ['gmail_read', 'gmail_send'],
				optionalTools: [],
				instructions: 'Handle email',
				tags: [],
			},
		})]

		resolveSkills(skills, registry)
		expect(skills[0].active).toBe(false)
		expect(skills[0].missingTools).toContain('tool:gmail_send')
	})

	it('skill with no required tools is always active', () => {
		const skills = [makeSkill({
			definition: {
				name: 'general',
				description: 'General',
				requiredTools: [],
				optionalTools: [],
				instructions: 'General stuff',
				tags: [],
			},
		})]

		resolveSkills(skills, registry)
		expect(skills[0].active).toBe(true)
	})

	describe('env var checks', () => {
		const originalEnv = { ...process.env }

		afterEach(() => {
			// Restore
			for (const key of Object.keys(process.env)) {
				if (!(key in originalEnv)) {
					delete process.env[key]
				}
			}
			for (const [key, val] of Object.entries(originalEnv)) {
				process.env[key] = val
			}
		})

		it('marks skill inactive when required env vars are missing', () => {
			delete process.env.TODOIST_API_KEY

			const skills = [makeSkill({
				definition: {
					name: 'todoist',
					description: 'Todoist',
					requiredTools: [],
					optionalTools: [],
					instructions: 'Todoist sync',
					tags: [],
					requires: { env: ['TODOIST_API_KEY'], bins: [], anyBins: [] },
				},
			})]

			resolveSkills(skills, registry)
			expect(skills[0].active).toBe(false)
			expect(skills[0].missingTools).toContain('env:TODOIST_API_KEY')
		})

		it('activates skill when required env vars are set', () => {
			process.env.TODOIST_API_KEY = 'test-key'

			const skills = [makeSkill({
				definition: {
					name: 'todoist',
					description: 'Todoist',
					requiredTools: [],
					optionalTools: [],
					instructions: 'Todoist sync',
					tags: [],
					requires: { env: ['TODOIST_API_KEY'], bins: [], anyBins: [] },
				},
			})]

			resolveSkills(skills, registry)
			expect(skills[0].active).toBe(true)
		})
	})

	describe('binary checks', () => {
		it('marks skill inactive when required binary is missing', () => {
			const skills = [makeSkill({
				definition: {
					name: 'bin-skill',
					description: 'Needs a binary',
					requiredTools: [],
					optionalTools: [],
					instructions: 'Use a binary',
					tags: [],
					requires: { env: [], bins: ['nonexistent_binary_xyz_abc'], anyBins: [] },
				},
			})]

			resolveSkills(skills, registry)
			expect(skills[0].active).toBe(false)
			expect(skills[0].missingTools).toContain('bin:nonexistent_binary_xyz_abc')
		})

		it('activates skill when required binary exists', () => {
			// 'node' should be available in any test environment
			const skills = [makeSkill({
				definition: {
					name: 'node-skill',
					description: 'Needs node',
					requiredTools: [],
					optionalTools: [],
					instructions: 'Use node',
					tags: [],
					requires: { env: [], bins: ['node'], anyBins: [] },
				},
			})]

			resolveSkills(skills, registry)
			expect(skills[0].active).toBe(true)
		})
	})
})

describe('buildActiveSkills', () => {
	let registry: ToolRegistry

	beforeEach(() => {
		registry = new ToolRegistry(createMessageBus())
	})

	it('returns correct format for active skills', () => {
		registry.register('paw-a', [
			{ name: 'tool-1', description: 'T1', parameters: z.object({}), execute: vi.fn() },
		], true)

		const skills: SkillInstance[] = [
			makeSkill({
				name: 'active-skill',
				active: true,
				definition: {
					name: 'active-skill',
					description: 'Active one',
					requiredTools: ['tool-1'],
					optionalTools: [],
					instructions: 'Do it',
					tags: [],
				},
			}),
			makeSkill({
				name: 'inactive-skill',
				active: false,
				definition: {
					name: 'inactive-skill',
					description: 'Inactive one',
					requiredTools: ['missing-tool'],
					optionalTools: [],
					instructions: 'Cannot do it',
					tags: [],
				},
			}),
		]

		const result = buildActiveSkills(skills, registry)
		expect(result).toHaveLength(1)
		expect(result[0].name).toBe('active-skill')
		expect(result[0].description).toBe('Active one')
		expect(result[0].satisfiedBy).toEqual(['paw-a'])
	})

	it('returns empty array when no skills are active', () => {
		const skills: SkillInstance[] = [
			makeSkill({ active: false }),
		]

		const result = buildActiveSkills(skills, registry)
		expect(result).toEqual([])
	})
})
