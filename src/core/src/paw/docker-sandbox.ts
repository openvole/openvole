/**
 * Docker sandbox for Paw subprocess isolation.
 * Optional alternative to Node.js --permission model.
 *
 * Provides stronger isolation (container-level) at the cost of startup time.
 * Uses dockerode for container lifecycle management.
 *
 * Config: security.docker.enabled = true in vole.config.json
 */

import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { createLogger } from '../core/logger.js'
// Permissions passed as plain object — no import needed from sandbox.ts

const logger = createLogger('docker-sandbox')

export interface DockerSandboxConfig {
	/** Enable Docker sandboxing (default: false) */
	enabled?: boolean
	/** Docker image to use (default: node:20-slim) */
	image?: string
	/** Memory limit (default: 512m) */
	memory?: string
	/** CPU limit (default: 1.0) */
	cpus?: string
	/** Container scope: per-session or shared (default: session) */
	scope?: 'session' | 'shared'
	/** Network mode: none, bridge, or host (default: none) */
	network?: 'none' | 'bridge' | 'host'
	/** Allowed outbound domains (only when network=bridge) */
	allowedDomains?: string[]
}

interface ManagedContainer {
	id: string
	pawName: string
	createdAt: number
}

/**
 * Docker sandbox manager.
 * Handles container lifecycle for paw subprocesses.
 */
export class DockerSandboxManager {
	private docker: any // dockerode instance (dynamically imported)
	private containers = new Map<string, ManagedContainer>()
	private config: DockerSandboxConfig
	private projectRoot: string
	private initialized = false

	constructor(config: DockerSandboxConfig, projectRoot: string) {
		this.config = config
		this.projectRoot = projectRoot
	}

	async init(): Promise<void> {
		if (this.initialized) return

		try {
			const { default: Docker } = await import('dockerode')
			this.docker = new Docker()
			// Verify Docker is reachable
			await this.docker.ping()
			this.initialized = true
			logger.info('Docker sandbox initialized')
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			logger.error(`Docker sandbox failed to initialize: ${msg}`)
			throw new Error(`Docker not available: ${msg}. Install Docker or disable docker sandbox.`)
		}
	}

	/**
	 * Run a paw inside a Docker container.
	 * Returns a handle with stdio streams for IPC transport.
	 */
	async spawnInContainer(
		pawPath: string,
		pawName: string,
		entryPath: string,
		_permissions: Record<string, unknown>,
		env: Record<string, string | undefined>,
	): Promise<{
		containerId: string
		exec: any // dockerode exec instance
		kill: () => Promise<void>
	}> {
		if (!this.initialized) await this.init()

		const image = this.config.image ?? 'node:20-slim'
		const memory = this.parseMemoryLimit(this.config.memory ?? '512m')
		const cpus = parseFloat(this.config.cpus ?? '1.0')
		const networkMode = this.config.network ?? 'none'

		// Prepare mounts
		const pawDataDir = path.resolve(
			this.projectRoot, '.openvole', 'paws',
			pawName.replace(/^@openvole\//, ''),
		)
		await fs.mkdir(pawDataDir, { recursive: true })

		const binds: string[] = [
			// Paw code (read-only)
			`${pawPath}:/paw:ro`,
			// Paw data directory (read-write)
			`${pawDataDir}:/data:rw`,
			// Project .openvole directory (read-only for config access)
			`${path.resolve(this.projectRoot, '.openvole')}:/openvole:ro`,
			// Temp directory
		]

		// Add node_modules if paw has dependencies
		const nodeModulesPath = path.resolve(pawPath, 'node_modules')
		try {
			await fs.access(nodeModulesPath)
			binds.push(`${nodeModulesPath}:/paw/node_modules:ro`)
		} catch {
			// No node_modules — skip
		}

		// Build environment
		const containerEnv: string[] = Object.entries(env)
			.filter(([, v]) => v !== undefined)
			.map(([k, v]) => `${k}=${v}`)

		// Add container-specific env
		containerEnv.push(`VOLE_PAW_DATA_DIR=/data`)

		logger.info(`Creating Docker container for "${pawName}" (image: ${image}, network: ${networkMode})`)

		const container = await this.docker.createContainer({
			Image: image,
			Cmd: ['node', `/paw/${path.basename(entryPath)}`],
			WorkingDir: '/paw',
			Env: containerEnv,
			HostConfig: {
				Binds: binds,
				Memory: memory,
				NanoCpus: Math.round(cpus * 1e9),
				NetworkMode: networkMode,
				ReadonlyRootfs: true,
				CapDrop: ['ALL'],
				SecurityOpt: ['no-new-privileges'],
				Tmpfs: {
					'/tmp': 'rw,noexec,nosuid,size=100m',
				},
			},
			// Enable stdio for IPC
			OpenStdin: true,
			StdinOnce: false,
			AttachStdin: true,
			AttachStdout: true,
			AttachStderr: true,
			Tty: false,
		})

		await container.start()

		const containerInfo = await container.inspect()
		const containerId = containerInfo.Id as string

		this.containers.set(pawName, {
			id: containerId,
			pawName,
			createdAt: Date.now(),
		})

		logger.info(`Container ${containerId.substring(0, 12)} started for "${pawName}"`)

		return {
			containerId,
			exec: container,
			kill: async () => {
				try {
					await container.stop({ t: 5 })
					await container.remove({ force: true })
					this.containers.delete(pawName)
					logger.info(`Container ${containerId.substring(0, 12)} stopped for "${pawName}"`)
				} catch {
					// Already stopped/removed
				}
			},
		}
	}

	/** Stop and remove all managed containers */
	async cleanup(): Promise<void> {
		const promises: Promise<void>[] = []
		for (const [pawName, managed] of this.containers) {
			promises.push(
				(async () => {
					try {
						const container = this.docker.getContainer(managed.id)
						await container.stop({ t: 3 })
						await container.remove({ force: true })
						logger.info(`Cleaned up container for "${pawName}"`)
					} catch {
						// Already gone
					}
				})(),
			)
		}
		await Promise.all(promises)
		this.containers.clear()
	}

	/** Check if Docker is available */
	static async isAvailable(): Promise<boolean> {
		try {
			const { default: Docker } = await import('dockerode')
			const docker = new Docker()
			await docker.ping()
			return true
		} catch {
			return false
		}
	}

	/** List running containers */
	listContainers(): Array<{ pawName: string; containerId: string; uptime: number }> {
		return Array.from(this.containers.values()).map((c) => ({
			pawName: c.pawName,
			containerId: c.id.substring(0, 12),
			uptime: Date.now() - c.createdAt,
		}))
	}

	private parseMemoryLimit(limit: string): number {
		const match = limit.match(/^(\d+)([kmg]?)$/i)
		if (!match) return 512 * 1024 * 1024 // default 512MB
		const value = parseInt(match[1], 10)
		const unit = (match[2] || 'm').toLowerCase()
		switch (unit) {
			case 'k': return value * 1024
			case 'm': return value * 1024 * 1024
			case 'g': return value * 1024 * 1024 * 1024
			default: return value * 1024 * 1024
		}
	}
}
