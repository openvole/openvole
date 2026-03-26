import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { SkillDefinition } from './types.js'
import { createLogger } from '../core/logger.js'

const logger = createLogger('skill-loader')

/** Parse a SKILL.md file into a SkillDefinition */
export async function loadSkillFromDirectory(
	skillDir: string,
): Promise<SkillDefinition | null> {
	const skillMdPath = path.join(skillDir, 'SKILL.md')

	try {
		const raw = await fs.readFile(skillMdPath, 'utf-8')
		return parseSkillMd(raw, skillMdPath)
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			logger.error(`SKILL.md not found: ${skillMdPath}`)
		} else {
			logger.error(`Failed to read SKILL.md at ${skillMdPath}: ${err}`)
		}
		return null
	}
}

/** Parse SKILL.md content (YAML frontmatter + markdown body) */
function parseSkillMd(
	content: string,
	filePath: string,
): SkillDefinition | null {
	const { frontmatter, body } = extractFrontmatter(content)

	if (!frontmatter) {
		logger.error(`No YAML frontmatter found in ${filePath}`)
		return null
	}

	let meta: Record<string, unknown>
	try {
		meta = parseYaml(frontmatter) as Record<string, unknown>
	} catch (err) {
		logger.error(`Invalid YAML frontmatter in ${filePath}: ${err}`)
		return null
	}

	if (!meta.name || typeof meta.name !== 'string') {
		logger.error(`SKILL.md missing "name" in frontmatter: ${filePath}`)
		return null
	}

	if (!meta.description || typeof meta.description !== 'string') {
		logger.error(`SKILL.md missing "description" in frontmatter: ${filePath}`)
		return null
	}

	const instructions = body.trim()
	if (!instructions) {
		logger.error(`SKILL.md has no instructions (empty body): ${filePath}`)
		return null
	}

	// Extract OpenClaw metadata if present
	const openclaw = extractOpenClawMetadata(meta)

	return {
		name: meta.name as string,
		description: meta.description as string,
		version: typeof meta.version === 'string'
			? meta.version
			: typeof meta.version === 'number'
				? String(meta.version)
				: undefined,
		requiredTools: toStringArray(meta.requiredTools),
		optionalTools: toStringArray(meta.optionalTools),
		instructions,
		tags: toStringArray(meta.tags),
		// OpenClaw compatibility fields
		requires: openclaw.requires,
	}
}

/**
 * Extract OpenClaw-specific metadata from frontmatter.
 *
 * OpenClaw skills use this structure:
 *   metadata:
 *     openclaw:
 *       requires:
 *         env: [TODOIST_API_KEY]
 *         bins: [curl]
 *         anyBins: [python3, python]
 *         config: [browser.enabled]
 *       primaryEnv: TODOIST_API_KEY
 *       emoji: "✅"
 *
 * Or as inline JSON:
 *   metadata: { "openclaw": { "requires": { "bins": ["uv"] } } }
 */
function extractOpenClawMetadata(meta: Record<string, unknown>): {
	requires: SkillDefinition['requires']
} {
	const metadata = meta.metadata as Record<string, unknown> | undefined
	if (!metadata) return { requires: undefined }

	// Support both "openclaw" and "clawdbot" (legacy name)
	const oc = (metadata.openclaw ?? metadata.clawdbot) as Record<string, unknown> | undefined
	if (!oc) return { requires: undefined }

	const req = oc.requires as Record<string, unknown> | undefined
	if (!req) return { requires: undefined }

	return {
		requires: {
			env: toStringArray(req.env),
			bins: toStringArray(req.bins),
			anyBins: toStringArray(req.anyBins),
		},
	}
}

/** Extract YAML frontmatter and markdown body from a file */
function extractFrontmatter(content: string): {
	frontmatter: string | null
	body: string
} {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
	if (!match) {
		return { frontmatter: null, body: content }
	}
	return { frontmatter: match[1], body: match[2] }
}

/** Safely convert a value to string[] */
function toStringArray(value: unknown): string[] {
	if (!value) return []
	if (Array.isArray(value)) return value.filter((v) => typeof v === 'string')
	return []
}
