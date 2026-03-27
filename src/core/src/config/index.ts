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

/** Security configuration */
export interface SecurityConfig {
	/** If false, disables filesystem sandboxing for paw subprocesses. Default: true (sandboxed) */
	sandboxFilesystem?: boolean
	/** Additional paths paws are allowed to access outside .openvole/ */
	allowedPaths?: string[]
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
}

/** CLI-managed lock file — tracks installed paws and skills */
export interface VoleLock {
	paws: Array<{
		name: string
		version: string
		allow?: PawConfig['allow']
	}>
	skills: Array<{
		name: string
		version: string
	}>
}

/** Default configuration values */
const DEFAULT_LOOP_CONFIG: LoopConfig = {
	maxIterations: 10,
	confirmBeforeAct: true,
	taskConcurrency: 1,
	compactThreshold: 50,
	rateLimits: undefined,
	toolHorizon: false,
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
	}
}

/** Load configuration — merges vole.config.{ts,mjs,js} with vole.lock.json */
export async function loadConfig(configPath: string): Promise<VoleConfig> {
	const userConfig = await loadUserConfig(configPath)
	const lockPath = path.join(path.dirname(configPath), '.openvole', 'vole.lock.json')
	const lock = await loadLockFile(lockPath)

	return mergeConfigWithLock(userConfig, lock)
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
			}
		} catch {
			continue
		}
	}

	console.warn(`[config] No config found (tried: ${jsonPath}, ${candidates.join(', ')}), using defaults`)
	return defineConfig({})
}

/** Load the CLI-managed lock file */
async function loadLockFile(lockPath: string): Promise<VoleLock> {
	try {
		const raw = await fs.readFile(lockPath, 'utf-8')
		return JSON.parse(raw) as VoleLock
	} catch {
		return { paws: [], skills: [] }
	}
}

/**
 * Merge user config with lock file.
 * Lock file entries are added if not already present in user config.
 * User config takes precedence (can override permissions, add hooks, etc.)
 */
function mergeConfigWithLock(userConfig: VoleConfig, lock: VoleLock): VoleConfig {
	const userPawNames = new Set(
		userConfig.paws.map((p) => (typeof p === 'string' ? p : p.name)),
	)
	const userSkillNames = new Set(userConfig.skills)

	// Add lock file paws not already in user config
	const mergedPaws: Array<PawConfig | string> = [...userConfig.paws]
	for (const lockPaw of lock.paws) {
		if (!userPawNames.has(lockPaw.name)) {
			mergedPaws.push(
				lockPaw.allow
					? { name: lockPaw.name, allow: lockPaw.allow }
					: lockPaw.name,
			)
		}
	}

	// Add lock file skills not already in user config
	const mergedSkills = [...userConfig.skills]
	for (const lockSkill of lock.skills) {
		if (!userSkillNames.has(lockSkill.name)) {
			mergedSkills.push(lockSkill.name)
		}
	}

	return {
		...userConfig,
		paws: mergedPaws,
		skills: mergedSkills,
	}
}

// === Lock file management (used by CLI) ===

/** Read the lock file */
export async function readLockFile(projectRoot: string): Promise<VoleLock> {
	const lockPath = path.join(projectRoot, '.openvole', 'vole.lock.json')
	try {
		const raw = await fs.readFile(lockPath, 'utf-8')
		return JSON.parse(raw) as VoleLock
	} catch {
		return { paws: [], skills: [] }
	}
}

/** Write the lock file */
export async function writeLockFile(
	projectRoot: string,
	lock: VoleLock,
): Promise<void> {
	const openvoleDir = path.join(projectRoot, '.openvole')
	await fs.mkdir(openvoleDir, { recursive: true })
	const lockPath = path.join(openvoleDir, 'vole.lock.json')
	await fs.writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8')
}

/** Add a Paw to the lock file */
export async function addPawToLock(
	projectRoot: string,
	name: string,
	version: string,
	allow?: PawConfig['allow'],
): Promise<void> {
	const lock = await readLockFile(projectRoot)
	const existing = lock.paws.findIndex((p) => p.name === name)
	const entry = { name, version, allow }

	if (existing >= 0) {
		lock.paws[existing] = entry
	} else {
		lock.paws.push(entry)
	}

	await writeLockFile(projectRoot, lock)
}

/** Remove a Paw from the lock file */
export async function removePawFromLock(
	projectRoot: string,
	name: string,
): Promise<void> {
	const lock = await readLockFile(projectRoot)
	lock.paws = lock.paws.filter((p) => p.name !== name)
	await writeLockFile(projectRoot, lock)
}

/** Add a Skill to the lock file */
export async function addSkillToLock(
	projectRoot: string,
	name: string,
	version: string,
): Promise<void> {
	const lock = await readLockFile(projectRoot)
	const existing = lock.skills.findIndex((s) => s.name === name)
	const entry = { name, version }

	if (existing >= 0) {
		lock.skills[existing] = entry
	} else {
		lock.skills.push(entry)
	}

	await writeLockFile(projectRoot, lock)
}

/** Remove a Skill from the lock file */
export async function removeSkillFromLock(
	projectRoot: string,
	name: string,
): Promise<void> {
	const lock = await readLockFile(projectRoot)
	lock.skills = lock.skills.filter((s) => s.name !== name)
	await writeLockFile(projectRoot, lock)
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
