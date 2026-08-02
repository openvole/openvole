import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config/index.js'
import { loadInProcessPaw } from '../../src/paw/loader.js'
import type { PawManifest } from '../../src/paw/types.js'

/**
 * Dynamic imports must go through a file:// URL, never a bare filesystem path.
 *
 * Node's ESM loader accepts an absolute POSIX path as a specifier but rejects a Windows one:
 *
 *   ERR_UNSUPPORTED_ESM_URL_SCHEME: Only URLs with a scheme in: file, data, and node are
 *   supported by the default ESM loader. On Windows, absolute paths must be valid file://
 *   URLs. Received protocol 'c:'
 *
 * `C:\…` reads as a URL whose scheme is the drive letter. So `import(absolutePath)` worked on
 * macOS and Linux and failed on Windows — taking down paw-compact, the only Paw that runs
 * in-process, while every subprocess Paw loaded normally.
 *
 * The platform-specific failure can't be reproduced on this runner, so the test asserts the
 * property that prevents it: the loader hands Node a *URL*. A missing entry file surfaces the
 * specifier verbatim in the error, which makes it observable without a Windows box.
 * (A path containing `#` would fail as a bare specifier on POSIX too, but vitest's own resolver
 * cannot load the percent-encoded URL that fixes it — that route tests the runner, not us.)
 */

const manifestFor = (entry: string) =>
	({
		name: '@openvole/paw-probe',
		version: '1.0.0',
		description: 'probe',
		entry,
		brain: false,
		category: 'infrastructure',
		inProcess: true,
		transport: 'ipc',
		tools: [],
		permissions: {},
	}) as unknown as PawManifest

describe('module specifiers are file:// URLs', () => {
	let dir: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-moduleurl-'))
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('imports the Paw entry as a file:// URL, not a bare path', async () => {
		// The entry does not exist: what matters is the specifier Node was given, which the
		// resolution error quotes back. A bare path here is exactly what broke Windows.
		const err = await loadInProcessPaw(dir, manifestFor('./missing.mjs'), {
			name: '@openvole/paw-probe',
		}).catch((e: Error) => e)

		expect(err).toBeInstanceOf(Error)
		expect((err as Error).message).toMatch(/file:\/\//)
		expect((err as Error).message).not.toMatch(/Received protocol/)
	})

	it('still loads an in-process Paw normally', async () => {
		await fs.writeFile(
			path.join(dir, 'index.mjs'),
			'export default { name: "@openvole/paw-probe", version: "1.0.0", description: "probe", tools: [] }\n',
		)

		const instance = await loadInProcessPaw(dir, manifestFor('./index.mjs'), {
			name: '@openvole/paw-probe',
		})

		expect(instance.name).toBe('@openvole/paw-probe')
		expect(instance.definition?.description).toBe('probe')
		expect(instance.healthy).toBe(true)
	})

	it('still runs the onLoad hook', async () => {
		const marker = path.join(dir, 'loaded.txt')
		await fs.writeFile(
			path.join(dir, 'index.mjs'),
			`import { writeFileSync } from 'node:fs'
export default {
  name: '@openvole/paw-probe', version: '1.0.0', description: 'probe', tools: [],
  onLoad: async () => { writeFileSync(${JSON.stringify(marker)}, 'yes') },
}
`,
		)

		await loadInProcessPaw(dir, manifestFor('./index.mjs'), { name: '@openvole/paw-probe' })

		await expect(fs.readFile(marker, 'utf-8')).resolves.toBe('yes')
	})

	it('still loads a JS config file', async () => {
		// loadConfig imports vole.config.{ts,mjs,js} through the same corrected path.
		const cfg = path.join(dir, 'vole.config.mjs')
		await fs.writeFile(cfg, 'export default { brain: "@openvole/paw-brain", paws: [] }\n')

		const config = await loadConfig(cfg)

		expect(config.brain).toBe('@openvole/paw-brain')
	})
})
