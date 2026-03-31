import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { PawConfig } from '../paw/types.js'

/** Rate limit configuration */
export interface RateLimits {
	/** Max LLM (Brain) calls per minute */
	llmCallsPerMinute?: number
	/** Max LLM (Brain) calls per hour */
	llmCallsPerHour?: number
	/** Max tool executions per single task */
	toolExecutionsPerTask?: number
	/** Max tasks per hour, keyed by source */
	tasksPerHour?: Record<string, number>
}

/** Loop configuration */
export interface LoopConfig {
	maxIterations: number
	confirmBeforeAct: boolean
	taskConcurrency: number
	/** Max messages before triggering compact hooks (0 = disabled) */
	compactThreshold: number
	/** Rate limits (undefined = no limits) */
	rateLimits?: RateLimits
	/** Enable Tool Horizon — Brain starts with core tools only, discovers others on demand */
	toolHorizon?: boolean
	/** Max context size in tokens (approximate). Brain paws use this to trim messages before API calls. 0 = use brain paw's default for the model. */
	maxContextTokens?: number
	/** Tokens reserved for the Brain's response. Default: 4000. */
	responseReserve?: number
	/** Cost alert threshold in USD — warn when a single task exceeds this amount */
	costAlertThreshold?: number
	/**
	 * Cost tracking mode:
	 * - "auto" (default): track for cloud providers, show "free" for local Ollama
	 * - "enabled": track costs for all providers including Ollama cloud
	 * - "disabled": no cost tracking
	 */
	costTracking?: 'auto' | 'enabled' | 'disabled'
}

/** Tool profile — restricts which tools a task source can use */
export interface ToolProfile {
	/** Tools allowed (if set, only these tools can be used) */
	allow?: string[]
	/** Tools denied (if set, these tools are blocked) */
	deny?: string[]
}

/** Heartbeat configuration */
export interface HeartbeatConfig {
	enabled: boolean
	intervalMinutes: number
	/** If true, run heartbeat immediately on startup (default: false) */
	runOnStart?: boolean
}

/** Docker sandbox configuration */
export interface DockerSandboxConfig {
	/** Enable Docker sandboxing (default: false) */
	enabled?: boolean
	/** Docker image to use (default: node:20-slim) */
	image?: string
	/** Memory limit per container (default: 512m) */
	memory?: string
	/** CPU limit per container (default: 1.0) */
	cpus?: string
	/** Container scope: per-session or shared (default: session) */
	scope?: 'session' | 'shared'
	/** Network mode: none, bridge, or host (default: none) */
	network?: 'none' | 'bridge' | 'host'
	/** Allowed outbound domains when network=bridge */
	allowedDomains?: string[]
}

/** Security configuration */
export interface SecurityConfig {
	/** If false, disables filesystem sandboxing for paw subprocesses. Default: true (sandboxed) */
	sandboxFilesystem?: boolean
	/** Additional paths paws are allowed to access outside .openvole/ */
	allowedPaths?: string[]
	/** Docker container sandbox (optional, stronger isolation) */
	docker?: DockerSandboxConfig
}

/** Agent profile — named agent with role, tool restrictions, and resource limits */
export interface AgentProfile {
	/** Human-readable role description */
	role?: string
	/** Instructions injected into the sub-agent's context */
	instructions?: string
	/** Tools this agent is allowed to use (allowlist) */
	allowTools?: string[]
	/** Tools this agent is denied (denylist — takes precedence over allow) */
	denyTools?: string[]
	/** Max iterations for this agent (default: 10) */
	maxIterations?: number
}

/** The full OpenVole configuration */
export interface VoleConfig {
	brain?: string
	paws: Array<PawConfig | string>
	skills: string[]
	loop: LoopConfig
	heartbeat: HeartbeatConfig
	/** Tool profiles per task source — restrict which tools can be used */
	toolProfiles?: Record<string, ToolProfile>
	/** Security settings */
	security?: SecurityConfig
	/** Named agent profiles for sub-agent spawning */
	agents?: Record<string, AgentProfile>
	/** VoleNet distributed networking */
	net?: import('../net/index.js').VoleNetConfig
}

/** Default configuration values */
const DEFAULT_LOOP_CONFIG: LoopConfig = {
	maxIterations: 10,
	confirmBeforeAct: false,
	taskConcurrency: 1,
	compactThreshold: 50,
	rateLimits: undefined,
	toolHorizon: true,
	maxContextTokens: 128000,
	responseReserve: 4000,
}

const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
	enabled: false,
	intervalMinutes: 30,
}

/** Normalize a Paw entry (string shorthand → full config) */
export function normalizePawConfig(entry: PawConfig | string): PawConfig {
	if (typeof entry === 'string') {
		return { name: entry }
	}
	return entry
}

/** Create a VoleConfig with defaults applied */
export function defineConfig(config: Partial<VoleConfig>): VoleConfig {
	return {
		brain: config.brain,
		paws: config.paws ?? [],
		skills: config.skills ?? [],
		loop: {
			...DEFAULT_LOOP_CONFIG,
			...config.loop,
		},
		heartbeat: {
			...DEFAULT_HEARTBEAT_CONFIG,
			...config.heartbeat,
		},
		toolProfiles: config.toolProfiles,
		security: config.security,
		net: config.net,
	}
}

/** Load configuration from vole.config.json */
export async function loadConfig(configPath: string): Promise<VoleConfig> {
	return loadUserConfig(configPath)
}

/** Load the user-authored config file */
async function loadUserConfig(configPath: string): Promise<VoleConfig> {
	// Try JSON first (preferred), then fall back to JS/MJS
	const dir = path.dirname(configPath)
	const jsonPath = path.join(dir, 'vole.config.json')

	// Try JSON
	try {
		const raw = await fs.readFile(jsonPath, 'utf-8')
		const config = JSON.parse(raw)
		return {
			brain: config.brain,
			paws: config.paws ?? [],
			skills: config.skills ?? [],
			loop: {
				...DEFAULT_LOOP_CONFIG,
				...config.loop,
			},
			heartbeat: {
				...DEFAULT_HEARTBEAT_CONFIG,
				...config.heartbeat,
			},
			toolProfiles: config.toolProfiles,
			security: config.security,
			net: config.net,
		}
	} catch {
		// JSON not found or invalid, try JS candidates
	}

	// Fall back to JS/MJS/TS imports
	const candidates = [configPath]
	if (configPath.endsWith('.ts')) {
		candidates.push(configPath.replace(/\.ts$/, '.mjs'))
		candidates.push(configPath.replace(/\.ts$/, '.js'))
	}

	for (const candidate of candidates) {
		try {
			const module = await import(candidate)
			const config = module.default ?? module
			return {
				brain: config.brain,
				paws: config.paws ?? [],
				skills: config.skills ?? [],
				loop: {
					...DEFAULT_LOOP_CONFIG,
					...config.loop,
				},
				heartbeat: {
					...DEFAULT_HEARTBEAT_CONFIG,
					...config.heartbeat,
				},
				toolProfiles: config.toolProfiles,
		security: config.security,
			net: config.net,
			}
		} catch {
			continue
		}
	}

	console.warn(`[config] No config found (tried: ${jsonPath}, ${candidates.join(', ')}), using defaults`)
	return defineConfig({})
}

// === vole.config.json management ===

/** Read the raw vole.config.json */
export async function readConfigFile(
	projectRoot: string,
): Promise<Record<string, unknown>> {
	const configPath = path.join(projectRoot, 'vole.config.json')
	try {
		const raw = await fs.readFile(configPath, 'utf-8')
		return JSON.parse(raw)
	} catch {
		return {}
	}
}

/** Write the vole.config.json */
export async function writeConfigFile(
	projectRoot: string,
	config: Record<string, unknown>,
): Promise<void> {
	const configPath = path.join(projectRoot, 'vole.config.json')
	await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/** Add a Paw to vole.config.json if not already present */
export async function addPawToConfig(
	projectRoot: string,
	name: string,
	allow?: PawConfig['allow'],
): Promise<void> {
	const config = await readConfigFile(projectRoot)
	const paws = (config.paws ?? []) as Array<PawConfig | string>
	const existing = paws.find((p) =>
		typeof p === 'string' ? p === name : p.name === name,
	)
	if (existing) return

	paws.push(allow ? { name, allow } : name)
	config.paws = paws
	await writeConfigFile(projectRoot, config)
}

/** Remove a Paw from vole.config.json */
export async function removePawFromConfig(
	projectRoot: string,
	name: string,
): Promise<void> {
	const config = await readConfigFile(projectRoot)
	const paws = (config.paws ?? []) as Array<PawConfig | string>
	config.paws = paws.filter((p) =>
		typeof p === 'string' ? p !== name : p.name !== name,
	)
	await writeConfigFile(projectRoot, config)
}

/** Add a Skill to vole.config.json if not already present */
export async function addSkillToConfig(
	projectRoot: string,
	name: string,
): Promise<void> {
	const config = await readConfigFile(projectRoot)
	const skills = (config.skills ?? []) as string[]
	if (skills.includes(name)) return

	skills.push(name)
	config.skills = skills
	await writeConfigFile(projectRoot, config)
}

/** Remove a Skill from vole.config.json */
export async function removeSkillFromConfig(
	projectRoot: string,
	name: string,
): Promise<void> {
	const config = await readConfigFile(projectRoot)
	const skills = (config.skills ?? []) as string[]
	config.skills = skills.filter((s) => s !== name)
	await writeConfigFile(projectRoot, config)
}
