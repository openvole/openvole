import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import {
	computeEffectivePermissions,
	buildSandboxEnv,
	buildPermissionFlags,
} from '../../src/paw/sandbox.js'
import type { PawManifest, PawConfig, EffectivePermissions } from '../../src/paw/types.js'

const makeManifest = (overrides?: Partial<PawManifest>): PawManifest => ({
	name: '@openvole/paw-test',
	version: '1.0.0',
	description: 'Test paw',
	entry: './dist/index.js',
	brain: false,
	inProcess: false,
	transport: 'ipc',
	tools: [],
	permissions: {
		network: [],
		listen: [],
		filesystem: [],
		env: [],
	},
	...overrides,
})

const makeConfig = (overrides?: Partial<PawConfig>): PawConfig => ({
	name: '@openvole/paw-test',
	...overrides,
})

describe('computeEffectivePermissions', () => {
	it('returns requested permissions when no allow block in config', () => {
		const manifest = makeManifest({
			permissions: { network: ['api.example.com'], listen: [3000], filesystem: ['/data'], env: ['API_KEY'] },
		})
		const config = makeConfig()
		const result = computeEffectivePermissions(manifest, config)

		expect(result.network).toEqual(['api.example.com'])
		expect(result.listen).toEqual([3000])
		expect(result.filesystem).toEqual(['/data'])
		expect(result.env).toEqual(['API_KEY'])
		expect(result.childProcess).toBe(false)
	})

	it('returns intersection of requested and granted', () => {
		const manifest = makeManifest({
			permissions: { network: ['a.com', 'b.com'], listen: [3000, 4000], filesystem: ['/data', '/tmp'], env: ['A', 'B'] },
		})
		const config = makeConfig({
			allow: { network: ['a.com'], listen: [4000], filesystem: ['/tmp'], env: ['B'] },
		})
		const result = computeEffectivePermissions(manifest, config)

		expect(result.network).toEqual(['a.com'])
		expect(result.listen).toEqual([4000])
		expect(result.filesystem).toEqual(['/tmp'])
		expect(result.env).toEqual(['B'])
	})

	it('returns empty arrays when nothing granted', () => {
		const manifest = makeManifest({
			permissions: { network: ['a.com'], listen: [3000], filesystem: ['/data'], env: ['KEY'] },
		})
		const config = makeConfig({ allow: { network: [], listen: [], filesystem: [], env: [], childProcess: false } })
		const result = computeEffectivePermissions(manifest, config)

		expect(result.network).toEqual([])
		expect(result.listen).toEqual([])
		expect(result.filesystem).toEqual([])
		expect(result.env).toEqual([])
	})
})

describe('buildPermissionFlags', () => {
	const projectRoot = '/projects/myapp'
	const pawPath = '/packages/paw-test'

	it('returns empty array when sandboxFilesystem is explicitly false', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: [], env: [], childProcess: false }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-test', permissions, projectRoot, { sandboxFilesystem: false })
		expect(flags).toEqual([])
	})

	it('enables sandboxing by default when security config is undefined', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: [], env: [], childProcess: false }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-test', permissions, projectRoot, undefined)
		expect(flags[0]).toBe('--permission')
	})

	it('enables sandboxing by default when sandboxFilesystem is not set', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: [], env: [], childProcess: false }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-test', permissions, projectRoot, {})
		expect(flags[0]).toBe('--permission')
	})

	it('includes --permission flag when enabled', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: [], env: [], childProcess: false }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-test', permissions, projectRoot, { sandboxFilesystem: true })
		expect(flags[0]).toBe('--permission')
	})

	it('includes paw path and .openvole in read paths', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: [], env: [], childProcess: false }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-test', permissions, projectRoot, { sandboxFilesystem: true })
		const readFlags = flags.filter(f => f.startsWith('--allow-fs-read='))
		const readPaths = readFlags.map(f => f.replace('--allow-fs-read=', ''))

		expect(readPaths).toContain(pawPath)
		expect(readPaths).toContain(path.resolve(projectRoot, '.openvole'))
	})

	it('includes paw data dir in write paths', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: [], env: [], childProcess: false }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-test', permissions, projectRoot, { sandboxFilesystem: true })
		const writeFlags = flags.filter(f => f.startsWith('--allow-fs-write='))
		const writePaths = writeFlags.map(f => f.replace('--allow-fs-write=', ''))

		expect(writePaths).toContain(path.resolve(projectRoot, '.openvole/paws/paw-test'))
	})

	it('strips @openvole/ prefix for paw data dir', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: [], env: [], childProcess: false }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-dashboard', permissions, projectRoot, { sandboxFilesystem: true })
		const writeFlags = flags.filter(f => f.startsWith('--allow-fs-write='))
		const writePaths = writeFlags.map(f => f.replace('--allow-fs-write=', ''))

		expect(writePaths).toContain(path.resolve(projectRoot, '.openvole/paws/paw-dashboard'))
	})

	it('adds filesystem permissions to both read and write', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: ['/data/shared'], env: [] }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-test', permissions, projectRoot, { sandboxFilesystem: true })
		const readPaths = flags.filter(f => f.startsWith('--allow-fs-read=')).map(f => f.replace('--allow-fs-read=', ''))
		const writePaths = flags.filter(f => f.startsWith('--allow-fs-write=')).map(f => f.replace('--allow-fs-write=', ''))

		expect(readPaths).toContain(path.resolve(projectRoot, '/data/shared'))
		expect(writePaths).toContain(path.resolve(projectRoot, '/data/shared'))
	})

	it('adds allowedPaths from security config to both read and write', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: [], env: [], childProcess: false }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-test', permissions, projectRoot, {
			sandboxFilesystem: true,
			allowedPaths: ['./workspace'],
		})
		const readPaths = flags.filter(f => f.startsWith('--allow-fs-read=')).map(f => f.replace('--allow-fs-read=', ''))
		const writePaths = flags.filter(f => f.startsWith('--allow-fs-write=')).map(f => f.replace('--allow-fs-write=', ''))

		const resolved = path.resolve(projectRoot, './workspace')
		expect(readPaths).toContain(resolved)
		expect(writePaths).toContain(resolved)
	})

	it('includes --allow-child-process when granted', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: [], env: [], childProcess: true }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-test', permissions, projectRoot, { sandboxFilesystem: true })
		expect(flags).toContain('--allow-child-process')
	})

	it('does not include --allow-child-process when not granted', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: [], env: [], childProcess: false }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-test', permissions, projectRoot, { sandboxFilesystem: true })
		expect(flags).not.toContain('--allow-child-process')
	})

	it('uses separate flags per path (not comma-separated)', () => {
		const permissions: EffectivePermissions = { network: [], listen: [], filesystem: ['/a', '/b'], env: [] }
		const flags = buildPermissionFlags(pawPath, '@openvole/paw-test', permissions, projectRoot, { sandboxFilesystem: true })

		// No flag should contain a comma
		for (const flag of flags) {
			if (flag.startsWith('--allow-fs-')) {
				const value = flag.split('=')[1]
				expect(value).not.toContain(',')
			}
		}
	})
})
