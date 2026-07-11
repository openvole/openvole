import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Scaffold a base OpenVole project at `dir`:
 * vole.config.json + .openvole/{skills,workspace,paws} + identity files + .env + .gitignore.
 *
 * Used by `vole agent create`. Throws if vole.config.json already exists.
 */
export async function scaffoldProject(dir: string): Promise<void> {
	const configPath = path.resolve(dir, 'vole.config.json')

	let exists = false
	try {
		await fs.access(configPath)
		exists = true
	} catch {
		exists = false
	}
	if (exists) throw new Error('vole.config.json already exists')

	const config = {
		paws: [],
		skills: [],
		loop: {
			maxIterations: 10,
			confirmBeforeAct: true,
			taskConcurrency: 1,
		},
		heartbeat: {
			enabled: false,
			intervalMinutes: 30,
		},
	}
	await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')

	// .openvole directory structure (paw dirs are created by `vole paw add`)
	await fs.mkdir(path.join(dir, '.openvole', 'skills', 'clawhub'), { recursive: true })
	await fs.mkdir(path.join(dir, '.openvole', 'workspace'), { recursive: true })
	await fs.mkdir(path.join(dir, '.openvole', 'paws'), { recursive: true })

	// Seed a self-documenting README so the workspace is discoverable, not an empty dir.
	await fs.writeFile(
		path.join(dir, '.openvole', 'workspace', 'README.md'),
		'# Workspace\n\nThe agent’s writable scratch and project area. Anything the agent creates or\ndownloads that is not memory, config, or a paw’s own data belongs here: drafts,\nnotes, downloaded docs, generated files, and media for internal projects.\n\nManaged by the `workspace_read`, `workspace_write`, `workspace_list`, and\n`workspace_delete` tools, which confine all paths to this directory. Gitignored by\ndefault, so it is safe for large or throwaway files. Never store secrets here — use\nthe vault.\n',
		'utf-8',
	)

	// HEARTBEAT.md
	await fs.writeFile(
		path.join(dir, '.openvole', 'HEARTBEAT.md'),
		'# Heartbeat\n\n## Jobs\n\n<!-- Add recurring jobs here -->\n',
		'utf-8',
	)

	// Identity files (BRAIN.md is managed by each Brain Paw in .openvole/paws/<brain-name>/)
	await fs.writeFile(
		path.join(dir, '.openvole', 'SOUL.md'),
		"# Soul\n\nThe agent's personality, tone, and identity.\n\n## Identity\n- Name: OpenVole Agent\n- Personality: Helpful, concise, and proactive\n- Tone: Professional but friendly\n",
		'utf-8',
	)
	await fs.writeFile(
		path.join(dir, '.openvole', 'USER.md'),
		'# User\n\nInformation about the user.\n\n## Profile\n- Name:\n- Timezone:\n- Language: English\n',
		'utf-8',
	)
	await fs.writeFile(
		path.join(dir, '.openvole', 'AGENT.md'),
		'# Agent\n\nOperating rules and behavioral guidelines.\n\n## Rules\n- Always be helpful and direct\n- Ask for clarification when a request is ambiguous\n- Save important findings to memory for future reference\n- Store credentials in the vault, never in workspace or memory\n- When reading API docs or instructions, save them to workspace immediately\n',
		'utf-8',
	)

	// .env template
	await fs.writeFile(
		path.join(dir, '.env'),
		'# OpenVole Environment\nVOLE_LOG_FILE=.openvole/logs/vole.log\nVOLE_LOG_LEVEL=info\n',
		'utf-8',
	)

	// .gitignore (only if absent)
	try {
		await fs.access(path.join(dir, '.gitignore'))
	} catch {
		await fs.writeFile(
			path.join(dir, '.gitignore'),
			'node_modules/\n.env\n.openvole/\n.DS_Store\n',
			'utf-8',
		)
	}
}
