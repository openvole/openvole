/**
 * Settings that survive a restart, so nothing has to be configured at install time.
 *
 * The first version of this took its name, hub and port from environment variables, which meant
 * the install line carried three flags a new user could not yet know the values of — and changing
 * one meant re-registering the server. Settings belong to the node, not to the command that
 * launches it: they live in its data directory, next to the identity they describe, and are
 * changed from inside a session with `volenet_hub`.
 *
 * Environment still wins where it is set, for scripted setups and CI. Nothing is required.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

export interface StoredConfig {
	name?: string
	hub?: string
	port?: number
}

export interface Settings {
	name: string
	hub?: string
	dir: string
	port: number
}

export function defaultDir(): string {
	return process.env.VOLENET_MCP_DIR?.trim() || path.join(os.homedir(), '.openvole', 'volenet-mcp')
}

/** A name that says what this is without needing to be chosen. Identity is the key, not this. */
export function defaultName(): string {
	return `claude-${os.hostname().split('.')[0].toLowerCase()}`
}

const file = (dir: string) => path.join(dir, 'config.json')

export async function loadStored(dir: string): Promise<StoredConfig> {
	try {
		const raw = JSON.parse(await fs.readFile(file(dir), 'utf-8')) as StoredConfig
		return raw && typeof raw === 'object' ? raw : {}
	} catch {
		return {}
	}
}

export async function saveStored(dir: string, patch: StoredConfig): Promise<StoredConfig> {
	const next = { ...(await loadStored(dir)), ...patch }
	for (const k of Object.keys(next) as Array<keyof StoredConfig>) {
		if (next[k] === undefined) delete next[k]
	}
	await fs.mkdir(dir, { recursive: true })
	await fs.writeFile(file(dir), `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
	return next
}

/** Environment over stored settings over defaults. Every layer is optional. */
export async function resolveSettings(): Promise<Settings> {
	const dir = defaultDir()
	const stored = await loadStored(dir)
	const envPort = Number(process.env.VOLENET_MCP_PORT)
	return {
		name: process.env.VOLENET_MCP_NAME?.trim() || stored.name || defaultName(),
		hub: process.env.VOLENET_MCP_HUB?.trim() || stored.hub || undefined,
		dir,
		port: (Number.isFinite(envPort) && envPort > 0 ? envPort : stored.port) || 9750,
	}
}
