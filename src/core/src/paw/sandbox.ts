import type { EffectivePermissions, PawConfig, PawManifest } from './types.js'
import { createLogger } from '../core/logger.js'

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
	if (!granted) {
		return {
			network: requested.network ?? [],
			listen: requested.listen ?? [],
			filesystem: requested.filesystem ?? [],
			env: requested.env ?? [],
		}
	}

	return {
		network: intersectStrings(requested.network ?? [], granted.network ?? []),
		listen: intersectNumbers(requested.listen ?? [], granted.listen ?? []),
		filesystem: intersectStrings(requested.filesystem ?? [], granted.filesystem ?? []),
		env: intersectStrings(requested.env ?? [], granted.env ?? []),
	}
}

function intersectStrings(a: string[], b: string[]): string[] {
	const setB = new Set(b)
	return a.filter((item) => setB.has(item))
}

function intersectNumbers(a: number[], b: number[]): number[] {
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
export function validatePermissions(
	manifest: PawManifest,
	config: PawConfig,
): string[] {
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
			warnings.push(
				`Env var "${envVar}" requested by ${manifest.name} but not granted in config`,
			)
		}
	}

	if (warnings.length > 0) {
		for (const w of warnings) {
			logger.info(w)
		}
	}

	return warnings
}
