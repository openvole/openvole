import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execa } from 'execa'
import { addPawToConfig } from '../config/index.js'
import { createLogger } from '../core/logger.js'
import { readPawManifest, resolvePawPath } from './manifest.js'

const logger = createLogger('paw-install')

export interface InstalledPawInfo {
	name: string
	version: string
	tools: string[]
	listen: number[]
}

/**
 * Install a paw from npm into a project: `npm install`, register it in vole.config.json with
 * the manifest's default permissions, create its data dir, and scaffold BRAIN.md for brain paws.
 * Shared by `vole paw add` and the dashboard's paw browser.
 */
export async function installPaw(projectRoot: string, name: string): Promise<InstalledPawInfo> {
	await execa('npm', ['install', name], { cwd: projectRoot, stdio: 'inherit' })

	const manifest = await readPawManifest(resolvePawPath(name, projectRoot))
	if (!manifest) {
		throw new Error(`Installed ${name} but could not read its vole-paw.json`)
	}

	const defaultAllow = manifest.permissions
		? {
				network: manifest.permissions.network,
				listen: manifest.permissions.listen,
				filesystem: manifest.permissions.filesystem,
				env: manifest.permissions.env,
				childProcess: manifest.permissions.childProcess,
			}
		: undefined
	await addPawToConfig(projectRoot, name, defaultAllow)

	const pawDataDir = path.join(
		projectRoot,
		'.openvole',
		'paws',
		manifest.name.replace(/^@openvole\//, ''),
	)
	await fs.mkdir(pawDataDir, { recursive: true })

	// Scaffold BRAIN.md for brain paws (from the installed package, if present).
	try {
		const brainContent = await fs.readFile(
			path.join(projectRoot, 'node_modules', name, 'BRAIN.md'),
			'utf-8',
		)
		if (brainContent.trim()) {
			const localBrainPath = path.join(pawDataDir, 'BRAIN.md')
			try {
				await fs.access(localBrainPath)
				await fs.rename(localBrainPath, path.join(pawDataDir, 'BRAIN.md.old'))
				logger.info(`Backed up ${manifest.name}/BRAIN.md → BRAIN.md.old`)
			} catch {
				// no existing BRAIN.md
			}
			await fs.writeFile(localBrainPath, brainContent, 'utf-8')
		}
	} catch {
		// not a brain paw
	}

	return {
		name: manifest.name,
		version: manifest.version,
		tools: manifest.tools.map((t) => t.name),
		listen: manifest.permissions?.listen ?? [],
	}
}
