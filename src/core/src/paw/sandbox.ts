import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SecurityConfig } from '../config/index.js'
import { createLogger } from '../core/logger.js'
import type { EffectivePermissions, PawConfig, PawManifest } from './types.js'

const logger = createLogger('paw-sandbox')

/**
 * Compute effective permissions as the intersection of
 * what the manifest requests and what the config grants.
 */
export function computeEffectivePermissions(
	manifest: PawManifest,
	config: PawConfig,
): EffectivePermissions {
	const requested = manifest.permissions ?? { network: [], listen: [], filesystem: [], env: [] }
	const granted = config.allow

	// If no allow block in config, treat as "grant all requested"
	// Exception: childProcess is always denied unless explicitly granted
	if (!granted) {
		return {
			network: requested.network ?? [],
			listen: requested.listen ?? [],
			filesystem: requested.filesystem ?? [],
			env: requested.env ?? [],
			childProcess: false,
		}
	}

	// For network, listen, and childProcess: config grant is sufficient.
	// The user's config is the trust decision — manifests may not declare everything
	// (e.g. paw-mcp doesn't know which domains MCP servers will need).
	// For filesystem and env: intersection (manifest must also declare).
	return {
		network: granted.network ?? [],
		listen: granted.listen ?? [],
		filesystem: intersectStrings(requested.filesystem ?? [], granted.filesystem ?? []),
		env: intersectStrings(requested.env ?? [], granted.env ?? []),
		childProcess: granted.childProcess ?? false,
	}
}

function intersectStrings(a: string[], b: string[]): string[] {
	const setB = new Set(b)
	return a.filter((item) => setB.has(item))
}

/**
 * Build the environment variables for a sandboxed Paw subprocess.
 * Only passes through env vars that are in the effective permissions.
 * Passes granted listen ports as VOLE_LISTEN_PORTS for the Paw to use.
 */
export function buildSandboxEnv(
	permissions: EffectivePermissions,
): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {
		// Always pass NODE_ENV and PATH
		NODE_ENV: process.env.NODE_ENV,
		PATH: process.env.PATH,
		// Debug flag
		VOLE_LOG_LEVEL: process.env.VOLE_LOG_LEVEL,
	}

	// Pass granted listen ports so the Paw knows which ports it can bind
	if (permissions.listen.length > 0) {
		env.VOLE_LISTEN_PORTS = permissions.listen.join(',')
	}

	for (const key of permissions.env) {
		if (process.env[key] !== undefined) {
			env[key] = process.env[key]
		} else {
			logger.warn(`Env var "${key}" is permitted but not set in environment`)
		}
	}

	return env
}

/**
 * Validate that a Paw's manifest permissions are reasonable.
 * Returns warnings (non-blocking) for review.
 */
export function validatePermissions(manifest: PawManifest, config: PawConfig): string[] {
	const warnings: string[] = []
	const effective = computeEffectivePermissions(manifest, config)
	const requested = manifest.permissions ?? {}

	for (const domain of requested.network ?? []) {
		if (!effective.network.includes(domain)) {
			warnings.push(
				`Network access to "${domain}" requested by ${manifest.name} but not granted in config`,
			)
		}
	}

	for (const port of requested.listen ?? []) {
		if (!effective.listen.includes(port)) {
			warnings.push(
				`Listen on port ${port} requested by ${manifest.name} but not granted in config`,
			)
		}
	}

	for (const fspath of requested.filesystem ?? []) {
		if (!effective.filesystem.includes(fspath)) {
			warnings.push(
				`Filesystem access to "${fspath}" requested by ${manifest.name} but not granted in config`,
			)
		}
	}

	for (const envVar of requested.env ?? []) {
		if (!effective.env.includes(envVar)) {
			warnings.push(`Env var "${envVar}" requested by ${manifest.name} but not granted in config`)
		}
	}

	if ((requested.childProcess ?? false) && !effective.childProcess) {
		warnings.push(`Child process access requested by ${manifest.name} but not granted in config`)
	}

	if (warnings.length > 0) {
		for (const w of warnings) {
			logger.info(w)
		}
	}

	return warnings
}

/**
 * Build Node.js --permission flags for filesystem sandboxing.
 * Returns an array of CLI flags to pass to the node subprocess.
 * Returns empty array if sandboxing is disabled.
 */
export function buildPermissionFlags(
	pawPath: string,
	pawName: string,
	permissions: EffectivePermissions,
	projectRoot: string,
	security?: SecurityConfig,
): string[] {
	// Sandboxing is enabled by default — opt-out via security.sandboxFilesystem: false
	if (security?.sandboxFilesystem === false) return []

	const openvoleDir = path.resolve(projectRoot, '.openvole')
	const pawDataDir = path.resolve(openvoleDir, 'paws', pawName.replace(/^@openvole\//, ''))

	// Resolve real tmpdir path (macOS /var → /private/var symlink)
	// Grant both the symlink path and real path for compatibility
	const tmpDirRaw = os.tmpdir()
	let tmpDir: string
	try {
		tmpDir = fs.realpathSync(tmpDirRaw)
	} catch {
		tmpDir = tmpDirRaw
	}

	// Read access: paw's own package, project root, .openvole/, temp dir, node_modules, granted paths
	const readPaths = new Set<string>([
		pawPath,
		projectRoot,
		openvoleDir,
		tmpDir,
		tmpDirRaw,
		// Node needs to read its own modules
		...resolveNodePaths(pawPath),
	])

	// Write access: paw's own data dir, OS temp dir, granted paths
	const writePaths = new Set<string>([pawDataDir, tmpDir, tmpDirRaw])

	// Add filesystem permissions from config
	for (const fsPath of permissions.filesystem) {
		const resolved = path.resolve(projectRoot, fsPath)
		readPaths.add(resolved)
		writePaths.add(resolved)
	}

	// Add globally allowed paths from security config
	for (const allowed of security?.allowedPaths ?? []) {
		const resolved = path.resolve(projectRoot, allowed)
		readPaths.add(resolved)
		writePaths.add(resolved)
	}

	const flags = ['--permission']
	for (const p of readPaths) {
		flags.push(`--allow-fs-read=${p}`)
	}
	for (const p of writePaths) {
		flags.push(`--allow-fs-write=${p}`)
	}
	if (permissions.childProcess) {
		flags.push('--allow-child-process')
		flags.push('--allow-addons')
		// Child processes (npx, npm, puppeteer) and native addons need access
		// to package caches and tool binaries in the home directory
		const homeDir = os.homedir()
		flags.push(`--allow-fs-read=${homeDir}`)
		flags.push(`--allow-fs-write=${path.join(homeDir, '.npm')}`)
		flags.push(`--allow-fs-write=${path.join(homeDir, '.cache')}`)
	}
	// Network access: outbound connections and port binding
	if (permissions.network.length > 0 || permissions.listen.length > 0) {
		flags.push('--allow-net')
	}
	return flags
}

/** Resolve paths Node.js needs to read for module loading */
function resolveNodePaths(pawPath: string): string[] {
	const paths: string[] = []

	// Node.js installation directory (covers bin/, lib/node_modules/npm, etc.)
	// Go up from bin/ to the installation root
	const nodeDir = path.dirname(process.execPath)
	paths.push(nodeDir)
	paths.push(path.dirname(nodeDir))

	// Global node_modules and local node_modules
	if (process.env.NODE_PATH) {
		paths.push(...process.env.NODE_PATH.split(path.delimiter))
	}

	// Walk up from cwd to find all node_modules (openvole project tree)
	let dir = process.cwd()
	while (true) {
		paths.push(path.join(dir, 'node_modules'))
		const parent = path.dirname(dir)
		if (parent === dir) break
		dir = parent
	}

	// Walk up from paw's directory to find its node_modules (pawhub tree)
	// Also add parent directories themselves — libraries like cosmiconfig
	// do statSync on parent dirs when searching for config files
	dir = path.resolve(pawPath)
	while (true) {
		if (!paths.includes(dir)) {
			paths.push(dir)
		}
		const nmPath = path.join(dir, 'node_modules')
		if (!paths.includes(nmPath)) {
			paths.push(nmPath)
		}
		const parent = path.dirname(dir)
		if (parent === dir) break
		dir = parent
	}

	return paths
}
