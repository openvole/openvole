import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoleHubClient } from '../../src/skill/volehub.js'

const REG = 'https://raw.githubusercontent.com/openvole/volehub/main'
const SKILL_MD = '---\nname: demo\ndescription: d\n---\nbody'
const SCRIPT = 'print("hi")\n'
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

function jsonResponse(obj: unknown) {
	return { ok: true, status: 200, json: async () => obj }
}
function fileResponse(content: string) {
	return {
		ok: true,
		status: 200,
		arrayBuffer: async () => new TextEncoder().encode(content).buffer,
	}
}
const notFound = () => ({ ok: false, status: 404 })

function makeIndex(files: Array<{ path: string; sha256: string }>) {
	return {
		updatedAt: 'x',
		skills: [
			{
				name: 'demo',
				version: '1.0.0',
				description: 'd',
				publisher: 'openvole',
				tags: [],
				requiredTools: [],
				contentHash: sha(SKILL_MD),
				publishedAt: 'x',
				files,
			},
		],
	}
}

describe('VoleHubClient.install — multi-file', () => {
	let tmp: string

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'volehub-test-'))
	})
	afterEach(async () => {
		vi.unstubAllGlobals()
		await fs.rm(tmp, { recursive: true, force: true })
	})

	function stubFetch(index: unknown, extra?: (url: string) => unknown) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.endsWith('/INDEX.json')) return jsonResponse(index)
				if (url.endsWith('/skills/demo/SKILL.md')) return fileResponse(SKILL_MD)
				if (url.endsWith('/skills/demo/scripts/run.py')) return fileResponse(SCRIPT)
				return extra?.(url) ?? notFound()
			}),
		)
	}

	it('downloads and verifies every file in the manifest, preserving subdirs', async () => {
		stubFetch(
			makeIndex([
				{ path: 'SKILL.md', sha256: sha(SKILL_MD) },
				{ path: 'scripts/run.py', sha256: sha(SCRIPT) },
			]),
		)
		const res = await new VoleHubClient(REG).install('demo', tmp)
		expect([...res.files].sort()).toEqual(['SKILL.md', 'scripts/run.py'])
		const dir = path.join(tmp, '.openvole/skills/volehub/demo')
		expect(await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')).toBe(SKILL_MD)
		expect(await fs.readFile(path.join(dir, 'scripts/run.py'), 'utf8')).toBe(SCRIPT)
	})

	it('throws on a SHA-256 mismatch', async () => {
		stubFetch(
			makeIndex([
				{ path: 'SKILL.md', sha256: sha(SKILL_MD) },
				{ path: 'scripts/run.py', sha256: 'deadbeef' },
			]),
		)
		await expect(new VoleHubClient(REG).install('demo', tmp)).rejects.toThrow(/mismatch/i)
	})

	it('refuses a manifest path that escapes the skill directory', async () => {
		stubFetch(
			makeIndex([
				{ path: 'SKILL.md', sha256: sha(SKILL_MD) },
				{ path: '../evil.txt', sha256: sha('x') },
			]),
			() => fileResponse('x'),
		)
		await expect(new VoleHubClient(REG).install('demo', tmp)).rejects.toThrow(
			/outside the skill directory/i,
		)
	})

	it('falls back to SKILL.md when there is no files manifest and discovery fails', async () => {
		// An empty files manifest exercises the discovery path (GitHub tree API → notFound → SKILL.md).
		stubFetch(makeIndex([]))
		const res = await new VoleHubClient(REG).install('demo', tmp)
		expect(res.files).toEqual(['SKILL.md'])
	})
})
