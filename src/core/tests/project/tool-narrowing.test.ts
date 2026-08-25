import { describe, expect, it } from 'vitest'
import { narrowToolAccess } from '../../src/project/context.js'

/**
 * A project's `toolProfile` narrows tool access and can never widen it.
 *
 * This is what makes it safe for the *agent* to author project manifests: an agent that could
 * grant itself a tool by writing `toolProfile.allow` would have a self-escalation path in a file
 * it controls. Denies union and allows intersect, so every restriction already in force survives
 * — including a sub-agent's own profile, which arrives on the same metadata.
 */

describe('narrowToolAccess', () => {
	it('passes the current restriction through when the project has no profile', () => {
		expect(narrowToolAccess({ allow: ['a'], deny: ['b'] }, undefined)).toEqual({
			allow: ['a'],
			deny: ['b'],
		})
		expect(narrowToolAccess({}, undefined)).toEqual({})
	})

	it('applies a project profile to an otherwise unrestricted task', () => {
		expect(narrowToolAccess({}, { allow: ['shell_exec', 'workspace_read'] })).toEqual({
			allow: ['shell_exec', 'workspace_read'],
		})
		expect(narrowToolAccess({}, { deny: ['net_send_file'] })).toEqual({
			deny: ['net_send_file'],
		})
	})

	it('unions denies — anything either side forbids stays forbidden', () => {
		const out = narrowToolAccess({ deny: ['a'] }, { deny: ['b'] })
		expect(new Set(out.deny)).toEqual(new Set(['a', 'b']))
	})

	it('intersects allows — a tool must clear both lists', () => {
		const out = narrowToolAccess({ allow: ['a', 'b', 'c'] }, { allow: ['b', 'c', 'd'] })
		expect(new Set(out.allow)).toEqual(new Set(['b', 'c']))
	})

	it('cannot widen: a project allow never restores a tool the task already denied', () => {
		const out = narrowToolAccess({ deny: ['shell_exec'] }, { allow: ['shell_exec'] })
		expect(out.deny).toContain('shell_exec')
	})

	it('cannot widen: a project allow never adds to a narrower task allowlist', () => {
		// The sub-agent may use only `a`. The project asks for `a` and `danger`.
		const out = narrowToolAccess({ allow: ['a'] }, { allow: ['a', 'danger'] })
		expect(out.allow).toEqual(['a'])
		expect(out.allow).not.toContain('danger')
	})

	it('an empty intersection denies everything rather than falling open', () => {
		const out = narrowToolAccess({ allow: ['a'] }, { allow: ['b'] })
		expect(out.allow).toEqual([])
	})

	it('drops empty lists so no restriction is signalled as an empty allowlist', () => {
		expect(narrowToolAccess({}, { allow: [], deny: [] })).toEqual({})
	})
})
