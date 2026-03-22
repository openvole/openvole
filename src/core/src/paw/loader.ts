import * as path from 'node:path'
import { execa, type ResultPromise } from 'execa'
import type { PawConfig, PawDefinition, PawInstance, PawManifest } from './types.js'
import { createTransport, type IpcTransport } from '../core/ipc.js'
import { buildSandboxEnv, buildPermissionFlags, computeEffectivePermissions } from './sandbox.js'
import type { SecurityConfig } from '../config/index.js'
import { createLogger } from '../core/logger.js'

const logger = createLogger('paw-loader')

/** Load an in-process Paw by importing its module */
export async function loadInProcessPaw(
	pawPath: string,
	manifest: PawManifest,
	config: PawConfig,
): Promise<PawInstance> {
	const entryPath = path.resolve(pawPath, manifest.entry)

	logger.info(`Loading in-process Paw "${manifest.name}" from ${entryPath}`)

	const module = await import(entryPath)
	const definition: PawDefinition = module.default ?? module

	if (definition.onLoad) {
		await definition.onLoad(config)
	}

	return {
		name: manifest.name,
		manifest,
		config,
		healthy: true,
		transport: 'ipc',
		inProcess: true,
		definition,
	}
}

/** Spawn a subprocess Paw and set up IPC transport */
export async function loadSubprocessPaw(
	pawPath: string,
	manifest: PawManifest,
	config: PawConfig,
	projectRoot?: string,
	security?: SecurityConfig,
): Promise<{ instance: PawInstance; transport: IpcTransport }> {
	const entryPath = path.resolve(pawPath, manifest.entry)
	const transport = manifest.transport ?? 'ipc'
	const permissions = computeEffectivePermissions(manifest, config)
	const env = buildSandboxEnv(permissions)

	// Build filesystem permission flags if sandboxing is enabled
	const permFlags = projectRoot
		? buildPermissionFlags(pawPath, manifest.name, permissions, projectRoot, security)
		: []

	logger.info(
		`Spawning subprocess Paw "${manifest.name}" (transport: ${transport}) from ${entryPath}`,
	)
	if (permFlags.length > 0) {
		logger.info(`Filesystem sandbox enabled for "${manifest.name}"`)
		logger.debug(`Sandbox flags for "${manifest.name}": ${permFlags.join(' ')}`)
	}

	const stdioConfig =
		transport === 'ipc'
			? (['pipe', 'pipe', 'pipe', 'ipc'] as const)
			: (['pipe', 'pipe', 'pipe'] as const)

	const child = execa('node', [...permFlags, entryPath], {
		env,
		stdio: stdioConfig,
		reject: false,
		cleanup: true,
	})

	// Forward stderr for logging
	child.stderr?.on('data', (data: Buffer) => {
		logger.warn(`[${manifest.name}] ${data.toString().trimEnd()}`)
	})

	const ipcTransport = createTransport(transport, child as unknown as import('node:child_process').ChildProcess)

	const instance: PawInstance = {
		name: manifest.name,
		manifest,
		config,
		healthy: true,
		transport,
		inProcess: false,
		process: {
			kill: () => child.kill(),
			pid: child.pid,
		},
		sendRequest: (method, params) => ipcTransport.request(method, params),
	}

	// Handle subprocess exit
	;(child as ResultPromise).then?.((result) => {
		if (instance.healthy) {
			instance.healthy = false
			logger.error(
				`Paw "${manifest.name}" exited unexpectedly (code: ${result.exitCode})`,
			)
		}
	}).catch?.(() => {
		// execa with reject: false should not throw, but handle just in case
		instance.healthy = false
	})

	return { instance, transport: ipcTransport }
}

/** Send a graceful shutdown signal to a subprocess Paw */
export async function shutdownPaw(instance: PawInstance): Promise<void> {
	if (instance.inProcess) {
		if (instance.definition?.onUnload) {
			await instance.definition.onUnload()
		}
		return
	}

	if (instance.sendRequest) {
		try {
			await Promise.race([
				instance.sendRequest('shutdown'),
				new Promise((resolve) => setTimeout(resolve, 5_000)),
			])
		} catch {
			logger.warn(`Shutdown request to "${instance.name}" failed, killing process`)
		}
	}

	instance.process?.kill()
	instance.healthy = false
}
