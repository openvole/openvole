import { accessSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import { createLogger } from '../core/logger.js'
import type { PawManifest } from './types.js'

const logger = createLogger('paw-manifest')

/** Schema for vole-paw.json */
const pawManifestSchema = z.object({
	name: z.string().min(1),
	version: z.string().min(1),
	description: z.string(),
	entry: z.string().min(1),
	brain: z.boolean().default(false),
	category: z.enum(['brain', 'channel', 'tool', 'infrastructure']).default('tool'),
	inProcess: z.boolean().optional().default(false),
	transport: z.enum(['ipc', 'stdio']).optional().default('ipc'),
	tools: z
		.array(
			z.object({
				name: z.string().min(1),
				description: z.string(),
			}),
		)
		.default([]),
	permissions: z
		.object({
			network: z.array(z.string()).optional().default([]),
			listen: z.array(z.number().int().positive()).optional().default([]),
			filesystem: z.array(z.string()).optional().default([]),
			env: z.array(z.string()).optional().default([]),
		})
		.optional()
		.default({}),
})

/** Resolve a Paw package path from its name */
export function resolvePawPath(name: string, projectRoot: string): string {
	if (name.startsWith('.') || name.startsWith('/')) {
		return path.resolve(projectRoot, name)
	}
	// Try .openvole/paws/<name> first, then node_modules
	const openvoleDir = path.resolve(projectRoot, '.openvole', 'paws', name)
	try {
		accessSync(path.join(openvoleDir, 'vole-paw.json'))
		return openvoleDir
	} catch {
		// Not found — fall through to node_modules
	}
	return path.resolve(projectRoot, 'node_modules', name)
}

/** Read and validate a vole-paw.json manifest */
export async function readPawManifest(pawPath: string): Promise<PawManifest | null> {
	const manifestPath = path.join(pawPath, 'vole-paw.json')

	try {
		const raw = await fs.readFile(manifestPath, 'utf-8')
		const parsed = JSON.parse(raw)
		const result = pawManifestSchema.safeParse(parsed)

		if (!result.success) {
			logger.error(`Invalid manifest at ${manifestPath}: ${result.error.message}`)
			return null
		}

		return result.data as PawManifest
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			logger.error(`Manifest not found: ${manifestPath}`)
		} else {
			logger.error(`Failed to read manifest ${manifestPath}: ${err}`)
		}
		return null
	}
}
