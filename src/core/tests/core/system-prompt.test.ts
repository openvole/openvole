import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { loadSystemPromptContent, buildSystemPrompt } from '../../src/core/system-prompt.js'
import type { ActiveSkill, ToolSummary } from '../../src/context/types.js'

describe('System Prompt', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-test-'))
		await fs.mkdir(path.join(tmpDir, '.openvole'), { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	describe('loadSystemPromptContent', () => {
		it('returns default prompt when no BRAIN.md exists', async () => {
			const content = await loadSystemPromptContent(tmpDir, 'paw-brain')
			expect(content.brainPrompt).toContain('You are an AI agent')
			expect(content.identityContext).toBe('')
		})

		it('loads BRAIN.md from paw data dir', async () => {
			const brainDir = path.join(tmpDir, '.openvole', 'paws', 'paw-brain')
			await fs.mkdir(brainDir, { recursive: true })
			await fs.writeFile(path.join(brainDir, 'BRAIN.md'), 'Custom brain prompt here.')

			const content = await loadSystemPromptContent(tmpDir, '@openvole/paw-brain')
			expect(content.brainPrompt).toBe('Custom brain prompt here.')
		})

		it('loads identity files', async () => {
			await fs.writeFile(path.join(tmpDir, '.openvole', 'SOUL.md'), 'I am helpful.')
			await fs.writeFile(path.join(tmpDir, '.openvole', 'USER.md'), 'User is a developer.')

			const content = await loadSystemPromptContent(tmpDir)
			expect(content.identityContext).toContain('Agent Identity')
			expect(content.identityContext).toContain('I am helpful.')
			expect(content.identityContext).toContain('User Profile')
			expect(content.identityContext).toContain('User is a developer.')
		})

		it('truncates BRAIN.md over 20K chars', async () => {
			const brainDir = path.join(tmpDir, '.openvole', 'paws', 'paw-test')
			await fs.mkdir(brainDir, { recursive: true })
			await fs.writeFile(path.join(brainDir, 'BRAIN.md'), 'x'.repeat(25000))

			const content = await loadSystemPromptContent(tmpDir, 'paw-test')
			expect(content.brainPrompt.length).toBeLessThan(21000)
			expect(content.brainPrompt).toContain('[... truncated]')
		})

		it('truncates identity files over 20K chars each', async () => {
			await fs.writeFile(path.join(tmpDir, '.openvole', 'SOUL.md'), 'y'.repeat(25000))

			const content = await loadSystemPromptContent(tmpDir)
			expect(content.identityContext.length).toBeLessThan(21000)
			expect(content.identityContext).toContain('[... truncated]')
		})

		it('caps total identity context at 50K chars', async () => {
			await fs.writeFile(path.join(tmpDir, '.openvole', 'SOUL.md'), 'a'.repeat(19000))
			await fs.writeFile(path.join(tmpDir, '.openvole', 'USER.md'), 'b'.repeat(19000))
			await fs.writeFile(path.join(tmpDir, '.openvole', 'AGENT.md'), 'c'.repeat(19000))

			const content = await loadSystemPromptContent(tmpDir)
			// 19K + 19K = 38K (under 50K), third file would push to 57K — should be skipped
			expect(content.identityContext).toContain('a'.repeat(100))
			expect(content.identityContext).toContain('b'.repeat(100))
			// AGENT.md may or may not be included depending on total
			expect(content.identityContext.length).toBeLessThanOrEqual(51000)
		})

		it('handles missing .openvole directory', async () => {
			const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-empty-'))
			try {
				const content = await loadSystemPromptContent(emptyDir)
				expect(content.brainPrompt).toContain('You are an AI agent')
				expect(content.identityContext).toBe('')
			} finally {
				await fs.rm(emptyDir, { recursive: true, force: true })
			}
		})
	})

	describe('buildSystemPrompt', () => {
		const defaultContent = {
			brainPrompt: 'You are a test agent.',
			identityContext: '## Agent Identity\nI am helpful.',
		}

		it('includes brain prompt', () => {
			const prompt = buildSystemPrompt(defaultContent, [], [])
			expect(prompt).toContain('You are a test agent.')
		})

		it('includes identity context', () => {
			const prompt = buildSystemPrompt(defaultContent, [], [])
			expect(prompt).toContain('Agent Identity')
			expect(prompt).toContain('I am helpful.')
		})

		it('includes skills list', () => {
			const skills: ActiveSkill[] = [
				{ name: 'skill-web', description: 'Browse the web', satisfiedBy: ['browser_navigate'] },
			]
			const prompt = buildSystemPrompt(defaultContent, skills, [])
			expect(prompt).toContain('Available Skills')
			expect(prompt).toContain('skill-web')
			expect(prompt).toContain('Browse the web')
		})

		it('includes tool descriptions', () => {
			const tools: ToolSummary[] = [
				{ name: 'web_fetch', description: 'Fetch a URL', pawName: '__core__' },
			]
			const prompt = buildSystemPrompt(defaultContent, [], tools)
			expect(prompt).toContain('Available Tools')
			expect(prompt).toContain('web_fetch')
			expect(prompt).toContain('Fetch a URL')
		})

		it('includes runtime context', () => {
			const prompt = buildSystemPrompt(defaultContent, [], [])
			expect(prompt).toContain('Current Context')
			expect(prompt).toContain('Date:')
			expect(prompt).toContain('Platform:')
		})

		it('includes memory from metadata', () => {
			const prompt = buildSystemPrompt(defaultContent, [], [], {
				memory: 'User prefers dark mode.',
			})
			expect(prompt).toContain('Agent Memory')
			expect(prompt).toContain('User prefers dark mode.')
		})

		it('truncates memory over 20K chars', () => {
			const prompt = buildSystemPrompt(defaultContent, [], [], {
				memory: 'z'.repeat(25000),
			})
			expect(prompt).toContain('[... truncated]')
		})

		it('orders static content before dynamic', () => {
			const skills: ActiveSkill[] = [
				{ name: 'test-skill', description: 'Test', satisfiedBy: [] },
			]
			const tools: ToolSummary[] = [
				{ name: 'test_tool', description: 'Test tool', pawName: 'paw-test' },
			]
			const prompt = buildSystemPrompt(defaultContent, skills, tools, {
				memory: 'Some memory.',
			})

			// Static sections should come before dynamic
			const brainIdx = prompt.indexOf('You are a test agent.')
			const identityIdx = prompt.indexOf('Agent Identity')
			const skillsIdx = prompt.indexOf('Available Skills')
			const toolsIdx = prompt.indexOf('Available Tools')
			const runtimeIdx = prompt.indexOf('Current Context')
			const memoryIdx = prompt.indexOf('Agent Memory')

			expect(brainIdx).toBeLessThan(identityIdx)
			expect(identityIdx).toBeLessThan(skillsIdx)
			expect(skillsIdx).toBeLessThan(toolsIdx)
			expect(toolsIdx).toBeLessThan(runtimeIdx)
			expect(runtimeIdx).toBeLessThan(memoryIdx)
		})

		it('omits empty sections', () => {
			const prompt = buildSystemPrompt(
				{ brainPrompt: 'Hello.', identityContext: '' },
				[],
				[],
			)
			expect(prompt).not.toContain('Available Skills')
			expect(prompt).not.toContain('Available Tools')
			expect(prompt).not.toContain('Agent Memory')
		})
	})
})
