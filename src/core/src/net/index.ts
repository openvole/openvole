/**
 * VoleNet, as the rest of OpenVole sees it.
 *
 * The protocol now lives in `@openvole/volenet` — a library with no idea what an agent loop is,
 * so that a phone, an MCP server or anything else can be a peer without installing a framework
 * it will never run. This file is the seam: it re-exports that package under the path core has
 * always imported, and hands the library the two things only a host can provide — its logger, so
 * there is one log stream rather than two, and its config format, so a peer learned at runtime is
 * written down where this agent will find it again.
 */
import * as path from 'node:path'
import { setLoggerFactory } from '@openvole/volenet'
import { createLogger } from '../core/logger.js'

// One stream, one format, one VOLE_LOG_LEVEL. Done at import so it lands before any node starts.
setLoggerFactory(createLogger)

/**
 * Write a peer learned at runtime into this agent's `vole.config.json`.
 *
 * Pass as `persistPeer` when constructing a manager. Without it a peer accepted through pairing
 * is live-only and forgotten on restart — which is what the library does by default, because it
 * has no business guessing the shape of somebody's config file.
 */
export function persistPeerTo(projectRoot: string): (url: string) => Promise<void> {
	return async (url: string) => {
		const { readConfigFile, writeConfigFile } = await import('../config/index.js')
		const cfg = (await readConfigFile(projectRoot)) as {
			net?: { peers?: Array<{ url?: string }> }
		}
		cfg.net = cfg.net ?? {}
		cfg.net.peers = cfg.net.peers ?? []
		if (!cfg.net.peers.some((p) => p?.url === url)) {
			cfg.net.peers.push({ url, trust: 'full' } as { url: string })
			await writeConfigFile(projectRoot, cfg as Record<string, unknown>)
		}
	}
}

/** Where this agent keeps its keys, given a project root and the configured key path. */
export function netDirFor(projectRoot: string, keyPath?: string): string {
	return path.resolve(projectRoot, path.dirname(keyPath ?? '.openvole/net/vole_key'))
}

export * from '@openvole/volenet'
