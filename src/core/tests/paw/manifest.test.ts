import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolvePawPath, readPawManifest } from '../../src/paw/manifest.js'

describe('resolvePawPath', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-paw-manifest-test-'))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it('handles relative paths (starting with .)', () => {
		const result = resolvePawPath('./my-paw', tmpDir)
		expect(result).toBe(path.resolve(tmpDir, './my-paw'))
	})

	it('handles absolute paths', () => {
		const result = resolvePawPath('/absolute/path/paw', tmpDir)
		expect(result).toBe('/absolute/path/paw')
	})

	it('checks .openvole/paws/ first for npm-like names', () => {
		// Create the .openvole/paws/test-paw directory with a manifest
		const pawDir = path.join(tmpDir, '.openvole', 'paws', 'test-paw')
		mkdirSync(pawDir, { recursive: true })
		writeFileSync(path.join(pawDir, 'vole-paw.json'), '{}', 'utf-8')

		const result = resolvePawPath('test-paw', tmpDir)
		expect(result).toBe(pawDir)
	})

	it('falls back to node_modules when not in .openvole/paws/', () => {
		const result = resolvePawPath('some-npm-paw', tmpDir)
		expect(result).toBe(path.resolve(tmpDir, 'node_modules', 'some-npm-paw'))
	})
})

describe('readPawManifest', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-paw-manifest-test-'))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it('parses a valid manifest', async () => {
		const pawDir = path.join(tmpDir, 'my-paw')
		await fs.mkdir(pawDir, { recursive: true })
		await fs.writeFile(
			path.join(pawDir, 'vole-paw.json'),
			JSON.stringify({
				name: 'my-paw',
				version: '1.0.0',
				description: 'A test paw',
				entry: 'index.js',
				brain: false,
				tools: [
					{ name: 'tool-1', description: 'First tool' },
				],
			}),
			'utf-8',
		)

		const manifest = await readPawManifest(pawDir)
		expect(manifest).not.toBeNull()
		expect(manifest!.name).toBe('my-paw')
		expect(manifest!.version).toBe('1.0.0')
		expect(manifest!.description).toBe('A test paw')
		expect(manifest!.entry).toBe('index.js')
		expect(manifest!.brain).toBe(false)
		expect(manifest!.tools).toHaveLength(1)
		expect(manifest!.tools[0].name).toBe('tool-1')
	})

	it('returns null for missing manifest', async () => {
		const result = await readPawManifest(path.join(tmpDir, 'nonexistent'))
		expect(result).toBeNull()
	})

	it('returns null for invalid manifest (missing required fields)', async () => {
		const pawDir = path.join(tmpDir, 'bad-paw')
		await fs.mkdir(pawDir, { recursive: true })
		await fs.writeFile(
			path.join(pawDir, 'vole-paw.json'),
			JSON.stringify({
				name: 'bad-paw',
				// Missing version, description, entry
			}),
			'utf-8',
		)

		const result = await readPawManifest(pawDir)
		expect(result).toBeNull()
	})

	it('returns null for malformed JSON', async () => {
		const pawDir = path.join(tmpDir, 'malformed')
		await fs.mkdir(pawDir, { recursive: true })
		await fs.writeFile(path.join(pawDir, 'vole-paw.json'), 'not json{{{', 'utf-8')

		const result = await readPawManifest(pawDir)
		expect(result).toBeNull()
	})

	it('applies defaults for optional fields', async () => {
		const pawDir = path.join(tmpDir, 'minimal-paw')
		await fs.mkdir(pawDir, { recursive: true })
		await fs.writeFile(
			path.join(pawDir, 'vole-paw.json'),
			JSON.stringify({
				name: 'minimal-paw',
				version: '0.1.0',
				description: 'Minimal',
				entry: 'index.js',
			}),
			'utf-8',
		)

		const manifest = await readPawManifest(pawDir)
		expect(manifest).not.toBeNull()
		expect(manifest!.brain).toBe(false)
		expect(manifest!.inProcess).toBe(false)
		expect(manifest!.transport).toBe('ipc')
		expect(manifest!.tools).toEqual([])
	})
})
