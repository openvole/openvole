import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadSkillFromDirectory } from '../../src/skill/loader.js'

describe('loadSkillFromDirectory', () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-skill-loader-test-'))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	async function writeSkillMd(content: string): Promise<string> {
		const skillDir = path.join(tmpDir, 'my-skill')
		await fs.mkdir(skillDir, { recursive: true })
		await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8')
		return skillDir
	}

	it('parses valid SKILL.md with frontmatter', async () => {
		const skillDir = await writeSkillMd(`---
name: email-triage
description: Triage incoming emails
version: "1.0"
requiredTools:
  - gmail_read
  - gmail_send
optionalTools:
  - calendar_check
tags:
  - email
  - productivity
---

# Email Triage

Read incoming emails and categorize them.
`)

		const result = await loadSkillFromDirectory(skillDir)
		expect(result).not.toBeNull()
		expect(result!.name).toBe('email-triage')
		expect(result!.description).toBe('Triage incoming emails')
		expect(result!.version).toBe('1.0')
		expect(result!.requiredTools).toEqual(['gmail_read', 'gmail_send'])
		expect(result!.optionalTools).toEqual(['calendar_check'])
		expect(result!.tags).toEqual(['email', 'productivity'])
		expect(result!.instructions).toContain('Email Triage')
	})

	it('returns null for missing file', async () => {
		const result = await loadSkillFromDirectory(path.join(tmpDir, 'nonexistent'))
		expect(result).toBeNull()
	})

	it('returns null for missing name in frontmatter', async () => {
		const skillDir = await writeSkillMd(`---
description: No name here
---

Some instructions.
`)

		const result = await loadSkillFromDirectory(skillDir)
		expect(result).toBeNull()
	})

	it('returns null for empty body', async () => {
		const skillDir = await writeSkillMd(`---
name: empty-body
description: Has no body
---

`)

		const result = await loadSkillFromDirectory(skillDir)
		expect(result).toBeNull()
	})

	it('parses OpenClaw metadata.openclaw.requires fields', async () => {
		const skillDir = await writeSkillMd(`---
name: todoist-sync
description: Sync with Todoist
metadata:
  openclaw:
    requires:
      env:
        - TODOIST_API_KEY
      bins:
        - curl
      anyBins:
        - python3
        - python
---

Sync tasks from Todoist.
`)

		const result = await loadSkillFromDirectory(skillDir)
		expect(result).not.toBeNull()
		expect(result!.requires).toBeDefined()
		expect(result!.requires!.env).toEqual(['TODOIST_API_KEY'])
		expect(result!.requires!.bins).toEqual(['curl'])
		expect(result!.requires!.anyBins).toEqual(['python3', 'python'])
	})

	it('handles requiredTools and optionalTools arrays', async () => {
		const skillDir = await writeSkillMd(`---
name: test-skill
description: Test
requiredTools:
  - tool_a
  - tool_b
optionalTools:
  - tool_c
---

Instructions here.
`)

		const result = await loadSkillFromDirectory(skillDir)
		expect(result!.requiredTools).toEqual(['tool_a', 'tool_b'])
		expect(result!.optionalTools).toEqual(['tool_c'])
	})

	it('defaults requiredTools and optionalTools to empty arrays', async () => {
		const skillDir = await writeSkillMd(`---
name: minimal
description: Minimal skill
---

Instructions.
`)

		const result = await loadSkillFromDirectory(skillDir)
		expect(result!.requiredTools).toEqual([])
		expect(result!.optionalTools).toEqual([])
	})

	it('returns null when frontmatter is missing', async () => {
		const skillDir = await writeSkillMd(`# No frontmatter

Just some markdown.
`)

		const result = await loadSkillFromDirectory(skillDir)
		expect(result).toBeNull()
	})
})
