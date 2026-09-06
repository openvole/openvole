/**
 * Where this session's identity lives, and what it is called.
 *
 * **One identity per project directory**, not per machine. Pairing is per identity, so a shared
 * identity makes every session the same participant: the peer you paired with cannot tell them
 * apart, and they all read one another's conversations. Two sessions open on two projects are two
 * different correspondents and should look like it.
 *
 * Several sessions in the *same* directory are the same participant, which is right — same
 * project, same conversation, same history.
 *
 * Settings live beside the identity rather than in the command that launches the server, so
 * changing one never means re-registering anything. Environment still wins where it is set.
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

export interface StoredConfig {
	name?: string
	hub?: string
	port?: number
	/**
	 * Nodes to dial on start, learned by pairing.
	 *
	 * Trust and address are different things and are kept in different places: the keystore says
	 * whose signature to accept, and this says where to find them. Without it a paired peer stayed
	 * trusted and unreachable after a restart — nothing dialled it, so nothing connected.
	 */
	peers?: string[]
}

/** Add a peer URL to what this identity dials, keeping the list unique and bounded. */
export async function rememberPeer(dir: string, url: string): Promise<void> {
	const clean = url.replace(/\/$/, '')
	const stored = await loadStored(dir)
	const peers = stored.peers ?? []
	if (peers.includes(clean)) return
	await saveStored(dir, { peers: [...peers, clean].slice(-32) })
}

export interface Settings {
	name: string
	hub?: string
	dir: string
	port: number
	/** Which read state in this directory's inbox is ours. See {@link sessionKey}. */
	session: string
}

/**
 * Which read state in this directory's inbox to use.
 *
 * One directory, one identity, one conversation: sessions in it share a read state, which is what
 * makes them the same participant rather than rivals for the same messages. Decided in one place
 * because the server, the hook and the CLI must agree — when they did not, a hook marked messages
 * read under one key while a waiter watched another and fired on everything.
 */
export function cursorKey(): string {
	return process.env.VOLENET_MCP_SESSION?.trim() || 'session'
}

/** Where every identity on this machine is kept, one directory each. */
export function baseDir(): string {
	return path.join(os.homedir(), '.openvole', 'volenet-mcp')
}

/**
 * A stable, recognisable name for a directory: its basename, plus a hash so two projects that
 * share one do not share an identity.
 */
export function sessionKey(cwd = process.cwd()): string {
	const hash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 8)
	const base = (cwd.split('/').filter(Boolean).pop() ?? 'session')
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.slice(0, 40)
	return `${base}-${hash}`
}

/**
 * This project's identity directory.
 *
 * `VOLENET_MCP_DIR` overrides it outright, which is how you deliberately share one identity
 * between projects — the exception, not the default.
 */
export function defaultDir(cwd = process.cwd()): string {
	const override = process.env.VOLENET_MCP_DIR?.trim()
	return override || path.join(baseDir(), sessionKey(cwd))
}

/**
 * What peers see. The project's name, not the machine's — it says something useful to whoever is
 * on the other end, and it keeps a laptop's hostname off other people's rosters.
 */
export function defaultName(cwd = process.cwd()): string {
	const base = (cwd.split('/').filter(Boolean).pop() ?? 'session')
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.slice(0, 40)
	return `claude-${base}`
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
		// 0 by default: a session dials out, and several projects open at once would otherwise
		// queue for one number. A peer that can dial you wants a fixed one — set it then.
		port: (Number.isFinite(envPort) && envPort > 0 ? envPort : stored.port) || 0,
		session: cursorKey(),
	}
}
