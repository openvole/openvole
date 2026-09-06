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
import * as crypto from 'node:crypto'
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
	/** Which read state in the shared inbox is this session's. See {@link sessionKey}. */
	session: string
}

/**
 * Which reader of the shared inbox this session is.
 *
 * The identity is per machine, deliberately: pairing once is the point of having one. Being
 * *caught up* is not — several editor sessions run at once, and one opening its inbox must not
 * mark the messages seen for the others.
 *
 * Keyed by the directory the client started the server in, so it is stable across a restart (the
 * same project reopened is the same reader, and does not replay what it has already seen) and
 * distinct between projects open at the same time. The hash disambiguates two projects that share
 * a basename; the basename is kept in front so the file is recognisable.
 */
export function sessionKey(cwd = process.cwd()): string {
	const hash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 8)
	const base = (cwd.split('/').filter(Boolean).pop() ?? 'session')
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.slice(0, 40)
	return `${base}-${hash}`
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
		session: process.env.VOLENET_MCP_SESSION?.trim() || sessionKey(),
	}
}
