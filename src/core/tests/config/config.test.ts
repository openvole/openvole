import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { defineConfig, normalizePawConfig, loadConfig } from '../../src/config/index.js'

describe('defineConfig', () => {
	it('applies defaults for empty config', () => {
		const config = defineConfig({})
		expect(config.paws).toEqual([])
		expect(config.skills).toEqual([])
		expect(config.loop.maxIterations).toBe(10)
		expect(config.loop.confirmBeforeAct).toBe(true)
		expect(config.loop.taskConcurrency).toBe(1)
		expect(config.loop.compactThreshold).toBe(50)
		expect(config.heartbeat.enabled).toBe(false)
		expect(config.heartbeat.intervalMinutes).toBe(30)
	})

	it('merges loop config with defaults', () => {
		const config = defineConfig({
			loop: {
				maxIterations: 20,
				confirmBeforeAct: false,
				taskConcurrency: 3,
				compactThreshold: 100,
			},
		})
		expect(config.loop.maxIterations).toBe(20)
		expect(config.loop.confirmBeforeAct).toBe(false)
		expect(config.loop.taskConcurrency).toBe(3)
		expect(config.loop.compactThreshold).toBe(100)
	})

	it('merges partial loop config with defaults', () => {
		const config = defineConfig({
			loop: {
				maxIterations: 5,
			} as any,
		})
		expect(config.loop.maxIterations).toBe(5)
		// Defaults should fill in the rest
		expect(config.loop.confirmBeforeAct).toBe(true)
		expect(config.loop.taskConcurrency).toBe(1)
	})

	it('merges heartbeat config with defaults', () => {
		const config = defineConfig({
			heartbeat: {
				enabled: true,
				intervalMinutes: 60,
			},
		})
		expect(config.heartbeat.enabled).toBe(true)
		expect(config.heartbeat.intervalMinutes).toBe(60)
	})

	it('preserves brain, paws, skills', () => {
		const config = defineConfig({
			brain: 'my-brain',
			paws: ['paw-a', { name: 'paw-b' }],
			skills: ['skill-1'],
		})
		expect(config.brain).toBe('my-brain')
		expect(config.paws).toHaveLength(2)
		expect(config.skills).toEqual(['skill-1'])
	})
})

describe('normalizePawConfig', () => {
	it('converts string to object', () => {
		const result = normalizePawConfig('my-paw')
		expect(result).toEqual({ name: 'my-paw' })
	})

	it('passes through object as-is', () => {
		const input = { name: 'my-paw', allow: { network: ['*'] } }
		const result = normalizePawConfig(input)
		expect(result).toBe(input)
	})
})

describe('loadConfig', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-config-test-'))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it('reads a JSON config file', async () => {
		const configData = {
			brain: 'test-brain',
			paws: ['paw-a'],
			loop: { maxIterations: 25 },
		}
		await fs.writeFile(
			path.join(tmpDir, 'vole.config.json'),
			JSON.stringify(configData),
			'utf-8',
		)

		const config = await loadConfig(path.join(tmpDir, 'vole.config.ts'))
		expect(config.brain).toBe('test-brain')
		expect(config.paws).toEqual(['paw-a'])
		expect(config.loop.maxIterations).toBe(25)
		// Defaults should still be merged
		expect(config.loop.confirmBeforeAct).toBe(true)
	})

	it('falls back to defaults when no file exists', async () => {
		const config = await loadConfig(path.join(tmpDir, 'vole.config.ts'))
		expect(config.paws).toEqual([])
		expect(config.skills).toEqual([])
		expect(config.loop.maxIterations).toBe(10)
	})

	it('loads only from vole.config.json (no lock file merge)', async () => {
		const configData = { paws: ['existing-paw'], skills: ['my-skill'] }
		await fs.writeFile(
			path.join(tmpDir, 'vole.config.json'),
			JSON.stringify(configData),
			'utf-8',
		)

		const config = await loadConfig(path.join(tmpDir, 'vole.config.ts'))
		const pawNames = config.paws.map((p) => (typeof p === 'string' ? p : p.name))
		expect(pawNames).toEqual(['existing-paw'])
		expect(config.skills).toEqual(['my-skill'])
	})
})
