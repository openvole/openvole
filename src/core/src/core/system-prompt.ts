import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { ActiveSkill, ToolSummary } from '../context/types.js'
import { createLogger } from './logger.js'

const logger = createLogger('system-prompt')

/** Maximum characters per identity file (BRAIN.md, SOUL.md, etc.) */
const MAX_FILE_CHARS = 20_000

/** Maximum total characters for all bootstrap files combined */
const MAX_TOTAL_CHARS = 50_000

/** Loaded prompt and identity content — cached on engine start */
export interface SystemPromptContent {
	brainPrompt: string
	identityContext: string
}

/**
 * Load BRAIN.md and identity files from the project directory.
 * Called once on engine start. Content is cached and reused for every task.
 *
 * BRAIN.md resolution:
 *   1. .openvole/paws/<brainPawName>/BRAIN.md (user customized)
 *   2. Falls back to default prompt if not found
 *
 * Identity files: .openvole/SOUL.md, .openvole/USER.md, .openvole/AGENT.md
 */
export async function loadSystemPromptContent(
	projectRoot: string,
	brainPawName?: string,
): Promise<SystemPromptContent> {
	// Load BRAIN.md
	let brainPrompt =
		'You are an AI agent powered by OpenVole. You accomplish tasks by using tools step by step.'

	if (brainPawName) {
		const pawDir = brainPawName.replace(/^@openvole\//, '')
		const brainPath = path.resolve(projectRoot, '.openvole', 'paws', pawDir, 'BRAIN.md')
		try {
			let content = await fs.readFile(brainPath, 'utf-8')
			if (content.trim()) {
				if (content.length > MAX_FILE_CHARS) {
					logger.warn(`BRAIN.md truncated: ${content.length} → ${MAX_FILE_CHARS} chars`)
					content = content.substring(0, MAX_FILE_CHARS) + '\n\n[... truncated]'
				}
				brainPrompt = content.trim()
			}
		} catch {
			logger.debug(`No BRAIN.md found for ${pawDir}, using default prompt`)
		}
	}

	// Load identity files
	const openvoleDir = path.resolve(projectRoot, '.openvole')
	const identityFiles = [
		{ name: 'SOUL.md', section: 'Agent Identity' },
		{ name: 'USER.md', section: 'User Profile' },
		{ name: 'AGENT.md', section: 'Agent Rules' },
	]

	const identityParts: string[] = []
	let totalChars = 0

	for (const file of identityFiles) {
		try {
			let content = await fs.readFile(path.join(openvoleDir, file.name), 'utf-8')
			if (content.trim()) {
				if (content.length > MAX_FILE_CHARS) {
					logger.warn(`${file.name} truncated: ${content.length} → ${MAX_FILE_CHARS} chars`)
					content = content.substring(0, MAX_FILE_CHARS) + '\n\n[... truncated]'
				}
				if (totalChars + content.length > MAX_TOTAL_CHARS) {
					logger.warn(
						`Identity context total cap reached at ${file.name}, skipping remaining files`,
					)
					break
				}
				identityParts.push(`## ${file.section}\n${content.trim()}`)
				totalChars += content.length
			}
		} catch {
			// File doesn't exist — skip
		}
	}

	return {
		brainPrompt,
		identityContext: identityParts.join('\n\n'),
	}
}

/**
 * Build the complete system prompt from cached content + dynamic context.
 *
 * Ordering: static content first (for provider prompt caching), dynamic last.
 *   1. BRAIN.md (static)
 *   2. Identity files (static)
 *   3. Skills list (semi-static)
 *   4. Tool descriptions (static per session)
 *   5. Runtime context (dynamic)
 *   6. Memory (dynamic)
 */
export function buildSystemPrompt(
	content: SystemPromptContent,
	activeSkills: ActiveSkill[],
	availableTools: ToolSummary[],
	metadata?: Record<string, unknown>,
): string {
	const parts: string[] = [content.brainPrompt]

	// Static: Identity files
	if (content.identityContext) {
		parts.push('')
		parts.push(content.identityContext)
	}

	// Semi-static: Skills list
	if (activeSkills.length > 0) {
		parts.push('')
		parts.push('## Available Skills')
		parts.push(
			'The following skills are available. Use the skill_read tool to load full instructions when a skill is relevant to the current task.',
		)
		for (const skill of activeSkills) {
			parts.push(`- **${skill.name}**: ${skill.description}`)
		}
	}

	// Static per session: Tool descriptions in text (separate from JSON schemas sent to API)
	if (availableTools.length > 0) {
		parts.push('')
		parts.push('## Available Tools')
		parts.push(
			'You have access to the following tools. Use function calling to invoke them when needed.',
		)
		for (const tool of availableTools) {
			parts.push(`- **${tool.name}** (from ${tool.pawName}): ${tool.description}`)
		}
	}

	// Dynamic: Runtime context
	const now = new Date()
	parts.push('')
	parts.push(`## Current Context
- Date: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Time: ${now.toLocaleTimeString('en-US', { hour12: true })}
- Platform: ${process.platform}`)

	// Dynamic: VoleNet context
	if (metadata?.volenet && typeof metadata.volenet === 'object') {
		const net = metadata.volenet as {
			instanceName: string
			role: string
			isLeader: boolean
			peers: Array<{ name: string; role: string; tools: string[]; hasBrain?: boolean }>
		}
		const lines = [`## VoleNet (Distributed Agent Network)`]
		lines.push(
			`This instance: **${net.instanceName}** (${net.role}${net.isLeader ? ', leader' : ''})`,
		)
		if (net.peers && net.peers.length > 0) {
			lines.push('Connected peers:')
			for (const peer of net.peers) {
				const toolList = peer.tools.length > 0 ? peer.tools.join(', ') : 'no tools shared'
				const brainTag = peer.hasBrain ? ', has brain' : ', no brain'
				lines.push(`- **${peer.name}** (${peer.role}${brainTag}) — ${toolList}`)
			}
			lines.push('')
			lines.push('Remote peer tools are available directly — call them like local tools.')
			lines.push(
				'When multiple peers share the same tool, use `<peerName>/<toolName>` to target a specific peer (e.g. `us-monitor/shell_exec`).',
			)
			lines.push('Use `discover_tools` with intent to find remote tools from peers.')
			lines.push(
				'IMPORTANT: `spawn_remote_agent` only works on peers that have a brain. For brainless workers, call their tools directly.',
			)
		} else {
			lines.push('No peers connected.')
		}
		parts.push('')
		parts.push(lines.join('\n'))
	}

	// Dynamic: Memory
	if (metadata?.memory && typeof metadata.memory === 'string') {
		const memory = metadata.memory as string
		if (memory.length > MAX_FILE_CHARS) {
			parts.push('')
			parts.push('## Agent Memory')
			parts.push(memory.substring(0, MAX_FILE_CHARS) + '\n\n[... truncated]')
			logger.warn(`Memory truncated: ${memory.length} → ${MAX_FILE_CHARS} chars`)
		} else {
			parts.push('')
			parts.push('## Agent Memory')
			parts.push(memory)
		}
	}

	return parts.join('\n')
}
