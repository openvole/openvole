import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../../src/core/system-prompt.js'
import type { ProjectContextInfo } from '../../src/project/types.js'

/**
 * The context tier is the change that removes the restart: identity files (AGENT.md et al) are
 * read once at engine start and cached, so before this the only place to say what an agent was
 * working on was AGENT.md — a file edit *plus* a restart. Project context arrives per task through
 * metadata instead.
 *
 * Two properties are load-bearing:
 *
 *   1. Scope travels with the task. Two tasks running concurrently in different projects must each
 *      see their own context. This is the paw-session bug class — a global `currentSessionId` filed
 *      brain replies under whichever session was last to bootstrap — and the fix is the same shape:
 *      no ambient "active project", the caller passes it.
 *   2. Placement. Everything above the tool list is static or semi-static so providers can cache
 *      the prefix. Project context belongs in the dynamic tail, or a project switch re-caches the
 *      tools and identity too.
 */

const content = {
	brainPrompt: 'You are an AI agent powered by OpenVole.',
	identityContext: '## Agent Identity\nYou are vole-agent.',
	workspaceDir: '/agent/.openvole/workspace',
}

const tools = [
	{ name: 'shell_exec', description: 'Run a shell command', pawName: '@openvole/paw-shell' },
]

function project(over: Partial<ProjectContextInfo> = {}): ProjectContextInfo {
	return {
		id: 'openvole-4.17',
		name: 'OpenVole 4.17',
		kind: 'code',
		root: '/Users/k/limnr/openvole',
		dir: '/agent/.openvole/workspace/openvole-4.17',
		contextFiles: [
			{
				name: 'VOLE.md',
				body: '# OpenVole\n\nBuild with pnpm. Biome uses tabs and single quotes.',
			},
		],
		task: {
			id: 't_1',
			goal: 'Port paw-database off better-sqlite3',
			doneCriteria: ['pnpm -C src/core test passes', 'no better-sqlite3 in any package.json'],
		},
		...over,
	}
}

describe('project context tier', () => {
	it('renders the project, its task, and its context docs verbatim', () => {
		const prompt = buildSystemPrompt(content, [], tools, { project: project() })

		expect(prompt).toContain('## Current Project')
		expect(prompt).toContain('**OpenVole 4.17** (code)')
		expect(prompt).toContain('/Users/k/limnr/openvole')
		expect(prompt).toContain('Port paw-database off better-sqlite3')
		expect(prompt).toContain('pnpm -C src/core test passes')
		expect(prompt).toContain('Biome uses tabs and single quotes')
	})

	it('tells the agent to verify its own done-criteria before reporting success', () => {
		const prompt = buildSystemPrompt(content, [], tools, { project: project() })
		expect(prompt).toMatch(/do not report success/i)
	})

	it('describes a self-contained project as its own folder', () => {
		const prompt = buildSystemPrompt(content, [], tools, {
			project: project({ root: undefined }),
		})
		expect(prompt).toContain('self-contained')
		expect(prompt).not.toContain('/Users/k/limnr/openvole')
	})

	it('scope travels with the call — two projects never bleed into each other', () => {
		const a = buildSystemPrompt(content, [], tools, { project: project() })
		const b = buildSystemPrompt(content, [], tools, {
			project: project({
				id: 'nart-chapter-9',
				name: 'Nart Ch. 9',
				kind: 'writing',
				root: undefined,
				contextFiles: [
					{ name: 'VOLE.md', body: '# Nart Sagas\n\nThe narrator is third-person past.' },
				],
				task: { id: 't_2', goal: 'Draft chapter 9', doneCriteria: [] },
			}),
		})

		expect(a).toContain('OpenVole 4.17')
		expect(a).not.toContain('Nart Sagas')
		expect(b).toContain('Nart Sagas')
		expect(b).not.toContain('better-sqlite3')
	})

	it('sits in the dynamic tail, after the tool list', () => {
		const prompt = buildSystemPrompt(content, [], tools, { project: project() })
		expect(prompt.indexOf('## Available Tools')).toBeLessThan(prompt.indexOf('## Current Project'))
		expect(prompt.indexOf('## Agent Identity')).toBeLessThan(prompt.indexOf('## Current Project'))
	})

	it('an agent with no project gets exactly today’s prompt', () => {
		const before = buildSystemPrompt(content, [], tools, {})
		const withOtherMetadata = buildSystemPrompt(content, [], tools, { memory: 'some memory' })

		expect(before).not.toContain('## Current Project')
		expect(withOtherMetadata).not.toContain('## Current Project')
		// The section is purely additive: nothing else about the prompt shifts.
		expect(before.indexOf('## Available Tools')).toBeGreaterThan(0)
	})

	it('lists the agent’s projects so it can see and switch between them', () => {
		const prompt = buildSystemPrompt(content, [], tools, {
			projectRoster: [
				{ id: 'openvole-4.17', name: 'OpenVole 4.17', kind: 'code', openTasks: 3 },
				{ id: 'nart-chapter-9', name: 'Nart Ch. 9', kind: 'writing', openTasks: 1 },
			],
			project: project(),
		})

		expect(prompt).toContain('## Projects')
		expect(prompt).toContain('`openvole-4.17`')
		expect(prompt).toContain('3 open tasks')
		expect(prompt).toContain('1 open task')
		// The one being worked on is marked, so a switch is an explicit act.
		expect(prompt).toMatch(/openvole-4\.17.*← current/)
		expect(prompt).not.toMatch(/nart-chapter-9.*← current/)
	})

	it('tells the agent to set up work itself rather than asking for an AGENT.md edit', () => {
		const prompt = buildSystemPrompt(content, [], tools, {
			projectRoster: [{ id: 'a', name: 'A', kind: 'code', openTasks: 0 }],
		})
		expect(prompt).toContain('project_scan')
		expect(prompt).toContain('never by asking your human to edit AGENT.md')
	})

	it('omits the roster entirely for an agent with no projects', () => {
		expect(buildSystemPrompt(content, [], tools, {})).not.toContain('## Projects')
		expect(buildSystemPrompt(content, [], tools, { projectRoster: [] })).not.toContain(
			'## Projects',
		)
	})

	it('points the default write target at the project folder', () => {
		const prompt = buildSystemPrompt(content, [], tools, { project: project() })
		expect(prompt).toContain('## Files & Workspace')
		expect(prompt).toContain('/agent/.openvole/workspace/openvole-4.17')
		expect(prompt).toContain('edit those in place')
	})

	it('leaves Files & Workspace untouched when there is no project', () => {
		const prompt = buildSystemPrompt(content, [], tools, {})
		expect(prompt).toContain('## Files & Workspace')
		expect(prompt).not.toContain('current project')
		expect(prompt).not.toContain('edit those in place')
	})

	it('omits the task block when a project is open but nothing is being worked on', () => {
		const prompt = buildSystemPrompt(content, [], tools, {
			project: project({ task: undefined }),
		})
		expect(prompt).toContain('## Current Project')
		expect(prompt).not.toContain('Current task:')
		expect(prompt).not.toContain('Done when')
	})
})
