/**
 * Read-only inspection of a candidate project root.
 *
 * This is what turns "work on the openvole repo" into a project without the human filling in a
 * form: the agent points scan at a directory, gets back what the place actually is, and drafts a
 * manifest and CONTEXT.md from evidence rather than guesswork.
 *
 * Two rules hold it in place. It **never writes** — a scan of someone's repo must not leave a
 * trace. And it is bounded by the same `allowedPaths` check as project creation, because a scan
 * of an arbitrary path would otherwise be a directory-listing primitive pointed at anything the
 * process can reach.
 *
 * Heuristics stay deliberately thin — file existence and a few manifest fields. Richer,
 * language-specific detection belongs in a paw, and keeping this shallow means one can be added
 * later without a core change.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { validateProjectRoot } from './store.js'
import type { ProjectKind } from './types.js'

export interface ScanResult {
	/** The resolved, authorized root. */
	root: string
	/** Best guess at the project kind — the agent may override it. */
	kind: ProjectKind
	/** Detected technologies, most specific first. */
	stack: string[]
	/** Tools worth having for this kind of work. A *suggestion*, never a grant. */
	suggestedTools: string[]
	/** Files worth reading before writing CONTEXT.md. */
	readFirst: string[]
	/** Opening tasks, phrased so the agent can adopt or replace them. */
	suggestedTasks: string[]
	/** One-line human summary. */
	summary: string
	/** Package/repo name when one is discoverable. */
	name?: string
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p)
		return true
	} catch {
		return false
	}
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
	try {
		return JSON.parse(await fs.readFile(p, 'utf-8')) as Record<string, unknown>
	} catch {
		return null
	}
}

/** Docs an agent should read before claiming to understand a project. */
const DOC_CANDIDATES = [
	'CLAUDE.md',
	'AGENTS.md',
	'README.md',
	'CONTRIBUTING.md',
	'ARCHITECTURE.md',
	'docs/README.md',
]

export async function scanProjectRoot(root: string, allowedPaths: string[]): Promise<ScanResult> {
	// Same boundary as creating a project: scanning is reading, and reading outside the sandbox is
	// still a capability the agent must not hand itself.
	const dir = await validateProjectRoot(root, allowedPaths)

	const stack: string[] = []
	const suggestedTools: string[] = []
	const readFirst: string[] = []
	const suggestedTasks: string[] = []
	let kind: ProjectKind = 'general'
	let name: string | undefined

	if (await exists(path.join(dir, '.git'))) {
		stack.push('git')
		suggestedTools.push('shell_exec')
	}

	// --- Node / TypeScript ---
	const pkg = await readJson(path.join(dir, 'package.json'))
	if (pkg) {
		kind = 'code'
		stack.push('node')
		if (typeof pkg.name === 'string') name = pkg.name

		const deps = {
			...((pkg.dependencies as Record<string, string>) ?? {}),
			...((pkg.devDependencies as Record<string, string>) ?? {}),
		}
		const scripts = (pkg.scripts as Record<string, string>) ?? {}

		if (await exists(path.join(dir, 'tsconfig.json'))) stack.push('typescript')
		if (await exists(path.join(dir, 'pnpm-lock.yaml'))) stack.push('pnpm')
		else if (await exists(path.join(dir, 'yarn.lock'))) stack.push('yarn')
		else if (await exists(path.join(dir, 'bun.lockb'))) stack.push('bun')
		else if (await exists(path.join(dir, 'package-lock.json'))) stack.push('npm')
		if (await exists(path.join(dir, 'pnpm-workspace.yaml'))) stack.push('monorepo')

		for (const [runner, marker] of [
			['vitest', 'vitest'],
			['jest', 'jest'],
			['mocha', 'mocha'],
		] as const) {
			if (deps[marker]) stack.push(runner)
		}
		for (const [linter, marker] of [
			['biome', '@biomejs/biome'],
			['eslint', 'eslint'],
		] as const) {
			if (deps[marker]) stack.push(linter)
		}

		if (scripts.test) {
			suggestedTasks.push('Run the test suite and record what a green run looks like')
		}
	}

	// --- Other ecosystems ---
	for (const [marker, tech] of [
		['pyproject.toml', 'python'],
		['requirements.txt', 'python'],
		['Cargo.toml', 'rust'],
		['go.mod', 'go'],
		['Gemfile', 'ruby'],
		['pom.xml', 'java'],
		['Dockerfile', 'docker'],
	] as const) {
		if (await exists(path.join(dir, marker))) {
			if (!stack.includes(tech)) stack.push(tech)
			if (tech !== 'docker') kind = 'code'
		}
	}

	// --- Non-code shapes, only when nothing said "code" ---
	if (kind === 'general') {
		const entries = await fs.readdir(dir).catch(() => [] as string[])
		const lower = entries.map((e) => e.toLowerCase())
		const has = (re: RegExp) => lower.some((e) => re.test(e))
		if (has(/\.(mp4|mov|mkv|wav|aiff|drp)$/)) {
			kind = 'media'
			suggestedTools.push('shell_exec')
		} else if (has(/\.(md|txt|docx?)$/)) {
			kind = 'writing'
		}
	}

	if (kind === 'code') {
		suggestedTools.push('shell_exec', 'workspace_write', 'workspace_read')
	}

	for (const doc of DOC_CANDIDATES) {
		if (await exists(path.join(dir, doc))) readFirst.push(doc)
	}

	// The first task is always the same and is the point of the whole flow: understand the place,
	// then write down what was learned so the next run starts informed instead of re-deriving it.
	suggestedTasks.unshift(
		readFirst.length > 0
			? `Read ${readFirst.slice(0, 3).join(', ')}, then write CONTEXT.md for this project`
			: 'Explore the project, then write CONTEXT.md describing what it is and how to work in it',
	)

	const dedupedTools = [...new Set(suggestedTools)]
	const summary =
		stack.length > 0
			? `${name ?? path.basename(dir)} — ${kind} project (${stack.join(', ')})`
			: `${name ?? path.basename(dir)} — ${kind} project, no recognizable stack markers`

	return {
		root: dir,
		kind,
		stack,
		suggestedTools: dedupedTools,
		readFirst,
		suggestedTasks,
		summary,
		...(name ? { name } : {}),
	}
}
