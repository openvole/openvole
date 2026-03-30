#!/usr/bin/env node

import 'dotenv/config'
import * as path from 'node:path'
import { createEngine } from './index.js'
import {
	addPawToConfig,
	removePawFromConfig,
	addSkillToConfig,
	removeSkillFromConfig,
} from './config/index.js'
import { readPawManifest, resolvePawPath } from './paw/manifest.js'
import { createLogger } from './core/logger.js'

const logger = createLogger('cli')

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const command = args[0]

	const projectRoot = process.cwd()

	// Allow init and help without a project root
	if (command !== 'init' && command !== 'help' && command !== '--help' && command !== '-h' && command !== '--version' && command !== '-v' && command !== 'upgrade' && command !== undefined) {
		const fsCheck = await import('node:fs/promises')
		try {
			await fsCheck.access(path.join(projectRoot, 'vole.config.json'))
		} catch {
			logger.error('vole.config.json not found in current directory')
			logger.info('Run "vole init" to create a new project, or cd to your project root')
			process.exit(1)
		}
	}

	switch (command) {
		case 'start':
			await startInteractive(projectRoot)
			break

		case 'run': {
			const input = args.slice(1).join(' ')
			if (!input) {
				logger.error('Usage: vole run "<task>"')
				process.exit(1)
			}
			await runSingle(projectRoot, input)
			break
		}

		case 'init':
			await initProject(projectRoot)
			break

		case 'paw':
			await handlePawCommand(args.slice(1), projectRoot)
			break

		case 'skill':
			await handleSkillCommand(args.slice(1), projectRoot)
			break

		case 'tool':
			await handleToolCommand(args.slice(1), projectRoot)
			break

		case 'task':
			await handleTaskCommand(args.slice(1), projectRoot)
			break

		case 'clawhub':
			await handleClawHubCommand(args.slice(1), projectRoot)
			break

		case 'net':
			await handleNetCommand(args.slice(1), projectRoot)
			break

		case 'upgrade':
			await handleUpgrade(projectRoot)
			break

		case undefined:
		case 'help':
		case '--help':
		case '-h':
			printHelp()
			break

		case '--version':
		case '-v': {
			const { readFile } = await import('node:fs/promises')
			const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'))
			logger.info(`openvole v${pkg.version}`)
			break
		}

		default:
			logger.error(`Unknown command: ${command}`)
			printHelp()
			process.exit(1)
	}
}

function printHelp(): void {
	logger.info(`
OpenVole — Micro Agent Core

Usage:
  vole init                              Initialize a new project
  vole start                             Start the agent loop (interactive)
  vole run "<task>"                       Run a single task

Paw management:
  vole paw create <name>                 Scaffold a new Paw in paws/
  vole paw list                          List loaded Paws and their tools
  vole paw add <name>                    Install and register a Paw
  vole paw remove <name>                 Uninstall and deregister a Paw

Skill management:
  vole skill create <name>               Scaffold a new Skill in skills/
  vole skill list                        List Skills and activation status
  vole skill add <name>                  Install and register a Skill
  vole skill remove <name>              Uninstall and deregister a Skill
  vole skill search <query>              Search VoleHub for skills
  vole skill install <name>              Install a skill from VoleHub
  vole skill uninstall <name>            Remove a VoleHub skill
  vole skill publish [path]              Prepare a skill for VoleHub publishing
  vole skill hub                         List installed VoleHub skills

Tool management:
  vole tool list                         List all registered tools (from manifests)
  vole tool list --live                  List all tools (boots engine, discovers MCP)
  vole tool call <name> [json-params]    Call a tool directly (deterministic, no Brain)

ClawHub (OpenClaw skill registry):
  vole clawhub install <skill>           Install a skill from ClawHub
  vole clawhub remove <skill>            Remove a ClawHub-installed skill
  vole clawhub search <query>            Search for skills on ClawHub

VoleNet (distributed networking):
  vole net init [name]                   Generate Ed25519 keypair
  vole net show-key                      Display public key (share with peers)
  vole net trust <key>                   Trust a peer's public key
  vole net revoke <id>                   Remove trust for a peer
  vole net peers                         List trusted peers
  vole net status                        Network status overview

Task management:
  vole task list                         Show task queue
  vole task cancel <id>                  Cancel a task

Upgrade:
  vole upgrade                           Upgrade core + all installed @openvole/* paws

Options:
  -h, --help                             Show this help
  -v, --version                          Show version
`)
}

async function startInteractive(projectRoot: string): Promise<void> {
	const { setNotifySuppressed } = await import('./io/tty.js')
	setNotifySuppressed(true)

	const engine = await createEngine(projectRoot)
	await engine.start()

	// Welcome screen
	const { readFile } = await import('node:fs/promises')
	let version = '?'
	try {
		const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'))
		version = pkg.version
	} catch { /* ignore */ }

	const toolCount = engine.toolRegistry.list().length
	const pawCount = engine.pawRegistry.list().length
	const skillCount = engine.skillRegistry.active().length
	const totalSkills = engine.skillRegistry.list().length
	const brainName = engine.config.brain
		? engine.pawRegistry.resolveManifestName(engine.config.brain)
		: 'none'

	// Find dashboard URL — check env var first, then config listen port
	let dashboardUrl = ''
	const dashPaw = engine.pawRegistry.list().find((p) => p.name.includes('dashboard'))
	if (dashPaw) {
		const envPort = process.env.VOLE_DASHBOARD_PORT
		if (envPort) {
			dashboardUrl = `http://localhost:${envPort}`
		} else {
			const listenConfig = engine.config.paws.find((p) =>
				typeof p === 'string' ? false : (p.name?.includes('dashboard') && p.allow?.listen?.length),
			)
			const port = typeof listenConfig !== 'string' && listenConfig?.allow?.listen?.[0]
			if (port) dashboardUrl = `http://localhost:${port}`
		}
	}

	const W = 51
	const pad = (s: string) => {
		const content = ` ${s} `
		const fill = W - content.length
		return `  │${content}${' '.repeat(Math.max(0, fill))}│`
	}

	const lines: string[] = [
		`OpenVole v${version}`,
		`Brain: ${brainName}`,
		`${pawCount} paws · ${toolCount} tools · ${skillCount}/${totalSkills} skills`,
	]
	if (dashboardUrl) lines.push(`Dashboard: ${dashboardUrl}`)
	lines.push('', 'Type a task or "exit" to quit.')

	console.log('')
	console.log(`  ╭${'─'.repeat(W)}╮`)
	for (const line of lines) console.log(pad(line))
	console.log(`  ╰${'─'.repeat(W)}╯`)
	console.log('')

	setNotifySuppressed(false)

	const dim = '\x1b[2m'
	const reset = '\x1b[0m'

	const readline = await import('node:readline')
	const promptStr = `${dim}  you ›${reset} `
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: promptStr,
	})
	const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
	const thinkingPhrases = [
		'thinking...',
		'pondering...',
		'reasoning...',
		'mulling it over...',
		'working on it...',
		'figuring it out...',
		'processing...',
		'brainstorming...',
		'contemplating...',
		'crunching...',
		'connecting the dots...',
		'cooking up a plan...',
		'digging in...',
		'on it...',
		'piecing it together...',
		'burrowing deeper...',
		'sniffing around...',
		'foraging for answers...',
		'nibbling on the problem...',
		'tunneling through...',
		'scurrying along...',
		'pawing at it...',
		'digging a new tunnel...',
		'nosing around...',
		'nesting on an idea...',
	]
	let spinnerInterval: ReturnType<typeof setInterval> | undefined

	const startSpinner = (): void => {
		let i = 0
		const phrase = thinkingPhrases[Math.floor(Math.random() * thinkingPhrases.length)]
		spinnerInterval = setInterval(() => {
			process.stdout.write(`\r${dim}  ${frames[i % frames.length]} ${phrase}${reset}`)
			i++
		}, 80)
	}

	const stopSpinner = (): void => {
		if (spinnerInterval) {
			clearInterval(spinnerInterval)
			spinnerInterval = undefined
			process.stdout.write('\r\x1b[K') // clear the spinner line
		}
	}

	let closing = false

	// Stop spinner and re-display prompt when Brain responds
	engine.bus.on('task:completed', () => {
		stopSpinner()
		if (!closing) rl.prompt()
	})
	engine.bus.on('task:failed', () => {
		stopSpinner()
		if (!closing) rl.prompt()
	})

	const promptUser = (): void => {
		rl.question(`${dim}  you ›${reset} `, (input) => {
			const trimmed = input.trim()
			if (trimmed === 'exit' || trimmed === 'quit') {
				closing = true
				rl.close()
				engine.shutdown().then(() => process.exit(0))
				return
			}
			if (trimmed) {
				startSpinner()
				engine.run(trimmed, 'user', 'cli:default')
			}
			promptUser()
		})
	}

	promptUser()

	// Graceful shutdown on SIGINT/SIGTERM
	const gracefulShutdown = (): void => {
		logger.info('\nShutting down...')
		rl.close()
		engine.shutdown().then(() => process.exit(0))
	}

	process.on('SIGINT', gracefulShutdown)
	process.on('SIGTERM', gracefulShutdown)
}

async function runSingle(
	projectRoot: string,
	input: string,
): Promise<void> {
	const engine = await createEngine(projectRoot, { headless: true })
	await engine.start()
	engine.run(input)

	// Wait for task completion
	return new Promise<void>((resolve) => {
		engine.bus.on('task:completed', () => {
			engine.shutdown().then(resolve)
		})
		engine.bus.on('task:failed', () => {
			engine.shutdown().then(() => {
				process.exit(1)
			})
		})
	})
}

async function initProject(projectRoot: string): Promise<void> {
	const fs = await import('node:fs/promises')

	const configPath = path.resolve(projectRoot, 'vole.config.json')
	try {
		await fs.access(configPath)
		logger.error('vole.config.json already exists')
		return
	} catch {
		// File doesn't exist, proceed
	}

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
	await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')

	// Create .openvole directory structure
	await fs.mkdir(path.join(projectRoot, '.openvole', 'skills'), { recursive: true })
	await fs.mkdir(path.join(projectRoot, '.openvole', 'skills', 'clawhub'), { recursive: true })
	await fs.mkdir(path.join(projectRoot, '.openvole', 'workspace'), { recursive: true })
	await fs.mkdir(path.join(projectRoot, '.openvole', 'paws', 'paw-memory'), { recursive: true })
	await fs.mkdir(path.join(projectRoot, '.openvole', 'paws', 'paw-session'), { recursive: true })
	await fs.mkdir(path.join(projectRoot, '.openvole', 'paws', 'paw-mcp'), { recursive: true })

	// Create default MEMORY.md
	await fs.writeFile(
		path.join(projectRoot, '.openvole', 'paws', 'paw-memory', 'MEMORY.md'),
		'# Memory\n\nLong-term memory for the agent. Store important facts, user preferences, and decisions here.\n',
		'utf-8',
	)

	// Create HEARTBEAT.md inside .openvole
	await fs.writeFile(
		path.join(projectRoot, '.openvole', 'HEARTBEAT.md'),
		'# Heartbeat\n\n## Jobs\n\n<!-- Add recurring jobs here -->\n',
		'utf-8',
	)

	// Create identity files
	// Note: BRAIN.md is managed by each Brain Paw in .openvole/paws/<brain-name>/BRAIN.md
	await fs.writeFile(
		path.join(projectRoot, '.openvole', 'SOUL.md'),
		'# Soul\n\nThe agent\'s personality, tone, and identity.\n\n## Identity\n- Name: OpenVole Agent\n- Personality: Helpful, concise, and proactive\n- Tone: Professional but friendly\n',
		'utf-8',
	)
	await fs.writeFile(
		path.join(projectRoot, '.openvole', 'USER.md'),
		'# User\n\nInformation about the user.\n\n## Profile\n- Name:\n- Timezone:\n- Language: English\n',
		'utf-8',
	)
	await fs.writeFile(
		path.join(projectRoot, '.openvole', 'AGENT.md'),
		'# Agent\n\nOperating rules and behavioral guidelines.\n\n## Rules\n- Always be helpful and direct\n- Ask for clarification when a request is ambiguous\n- Save important findings to memory for future reference\n- Store credentials in the vault, never in workspace or memory\n- When reading API docs or instructions, save them to workspace immediately\n',
		'utf-8',
	)

	// Create .env template
	await fs.writeFile(
		path.join(projectRoot, '.env'),
		'# OpenVole Environment\nVOLE_LOG_LEVEL=info\n',
		'utf-8',
	)

	// Create .gitignore
	try {
		await fs.access(path.join(projectRoot, '.gitignore'))
	} catch {
		await fs.writeFile(
			path.join(projectRoot, '.gitignore'),
			'node_modules/\n.env\n.openvole/\n.DS_Store\n',
			'utf-8',
		)
	}

	logger.info('Created vole.config.json')
	logger.info('Created .openvole/')
	logger.info('  skills/                — local and ClawHub skills')
	logger.info('  workspace/             — agent scratch space')
	logger.info('  paws/paw-memory/       — agent memory (MEMORY.md + daily logs)')
	logger.info('  paws/paw-session/      — session transcripts')
	logger.info('  paws/paw-mcp/          — MCP server config')
	logger.info('Created identity files (SOUL.md, USER.md, AGENT.md, HEARTBEAT.md)')
	logger.info('Created .env')
	logger.info('')
	logger.info('Next: install paws and start')
	logger.info('  npm install @openvole/paw-ollama @openvole/paw-memory')
	logger.info('  npx vole start')
}

async function handleUpgrade(projectRoot: string): Promise<void> {
	const fs = await import('node:fs/promises')
	const { execa: execaFn } = await import('execa')

	// Read package.json to find openvole packages
	const pkgPath = path.join(projectRoot, 'package.json')
	let pkgJson: Record<string, unknown>
	try {
		pkgJson = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
	} catch {
		logger.error('package.json not found — run "npm init" first')
		process.exit(1)
	}

	const deps = (pkgJson.dependencies ?? {}) as Record<string, string>
	const devDeps = (pkgJson.devDependencies ?? {}) as Record<string, string>
	const allDeps = { ...deps, ...devDeps }

	// Collect openvole and @openvole/* packages
	const packages = Object.keys(allDeps).filter(
		(name) => name === 'openvole' || name.startsWith('@openvole/'),
	)

	if (packages.length === 0) {
		logger.info('No openvole packages found in package.json')
		return
	}

	// Record versions before upgrade
	const beforeVersions: Record<string, string> = {}
	for (const pkg of packages) {
		beforeVersions[pkg] = allDeps[pkg]
	}

	logger.info(`Upgrading ${packages.length} package(s) to latest...`)

	// Install all packages @latest in a single command to resolve peer deps together
	const installArgs = packages.map((pkg) => `${pkg}@latest`)
	logger.info(`  npm install ${installArgs.join(' ')}`)
	await execaFn('npm', ['install', ...installArgs], {
		cwd: projectRoot,
		stdio: 'inherit',
	})

	// Ensure paw data directories exist and scaffold BRAIN.md for brain paws
	const pawPackages = packages.filter((p) => p.startsWith('@openvole/paw-'))
	for (const pkg of pawPackages) {
		const pawName = pkg.replace('@openvole/', '')
		const pawDataDir = path.join(projectRoot, '.openvole', 'paws', pawName)
		await fs.mkdir(pawDataDir, { recursive: true })

		// Scaffold BRAIN.md for brain paws
		const pkgBrainPath = path.join(projectRoot, 'node_modules', pkg, 'BRAIN.md')
		try {
			const brainContent = await fs.readFile(pkgBrainPath, 'utf-8')
			if (brainContent.trim()) {
				const localBrainPath = path.join(pawDataDir, 'BRAIN.md')
				try {
					await fs.access(localBrainPath)
					// Existing BRAIN.md — back it up and replace with new version
					await fs.rename(localBrainPath, path.join(pawDataDir, 'BRAIN.md.old'))
					logger.info(`  Backed up ${pawName}/BRAIN.md → BRAIN.md.old`)
				} catch {
					// No existing BRAIN.md
				}
				await fs.writeFile(localBrainPath, brainContent, 'utf-8')
				logger.info(`  Scaffolded ${pawName}/BRAIN.md`)
			}
		} catch {
			// No BRAIN.md in package — not a brain paw
		}
	}

	// Re-read package.json to detect version changes
	const updatedPkgJson = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
	const updatedDeps = {
		...(updatedPkgJson.dependencies ?? {}),
		...(updatedPkgJson.devDependencies ?? {}),
	} as Record<string, string>

	const upgraded: string[] = []
	const unchanged: string[] = []

	for (const pkg of packages) {
		const before = beforeVersions[pkg]
		const after = updatedDeps[pkg]
		if (before !== after) {
			upgraded.push(`  ${pkg}: ${before} → ${after}`)
		} else {
			unchanged.push(pkg)
		}
	}

	if (upgraded.length > 0) {
		logger.info(`\nUpgraded:`)
		for (const line of upgraded) {
			logger.info(line)
		}
	}
	if (unchanged.length > 0) {
		logger.info(`\nAlready latest: ${unchanged.join(', ')}`)
	}
	if (upgraded.length === 0) {
		logger.info('\nAll packages are already up to date.')
	}
}

async function handlePawCommand(
	args: string[],
	projectRoot: string,
): Promise<void> {
	const subcommand = args[0]

	switch (subcommand) {
		case 'create': {
			const name = args[1]
			if (!name) {
				logger.error('Usage: vole paw create <name>')
				process.exit(1)
			}
			await scaffoldPaw(projectRoot, name)
			break
		}

		case 'list': {
			// Lightweight — read manifests without spawning paws
			const config = await (await import('./config/index.js')).loadConfig(
				path.resolve(projectRoot, 'vole.config.json'),
			)
			const { normalizePawConfig } = await import('./config/index.js')
			const { readPawManifest, resolvePawPath } = await import('./paw/manifest.js')

			const paws: Array<{ name: string; tools: number; type: string }> = []
			for (const pawEntry of config.paws) {
				const pawConfig = normalizePawConfig(pawEntry)
				const pawPath = resolvePawPath(pawConfig.name, projectRoot)
				const manifest = await readPawManifest(pawPath)
				if (manifest) {
					paws.push({
						name: manifest.name,
						tools: manifest.tools.length,
						type: manifest.inProcess ? 'in-process' : 'subprocess',
					})
				}
			}

			if (paws.length === 0) {
				logger.info('No Paws configured')
			} else {
				logger.info('PAW                          TOOLS    TYPE')
				for (const paw of paws) {
					logger.info(
						`${paw.name.padEnd(29)}${String(paw.tools).padEnd(9)}${paw.type}`,
					)
				}
			}
			break
		}

		case 'add': {
			const name = args[1]
			if (!name) {
				logger.error('Usage: vole paw add <name>')
				process.exit(1)
			}
			logger.info(`Installing ${name}...`)
			const { execa: execaFn } = await import('execa')
			await execaFn('npm', ['install', name], { cwd: projectRoot, stdio: 'inherit' })

			// Read manifest and auto-register in lock file
			const pawPath = resolvePawPath(name, projectRoot)
			const manifest = await readPawManifest(pawPath)
			if (manifest) {
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
				// Create paw data directory
				const pawDataDir = path.join(projectRoot, '.openvole', 'paws', manifest.name.replace(/^@openvole\//, ''))
				const { mkdir } = await import('node:fs/promises')
				await mkdir(pawDataDir, { recursive: true })
				logger.info(`Added ${name}@${manifest.version} to vole.config.json`)
				if (manifest.permissions?.listen?.length) {
					logger.info(`  listen ports: ${manifest.permissions.listen.join(', ')}`)
				}
				if (manifest.tools.length > 0) {
					logger.info(`  provides ${manifest.tools.length} tools: ${manifest.tools.map((t) => t.name).join(', ')}`)
				}
			} else {
				logger.error(`Installed ${name} but could not read vole-paw.json — add it to vole.config.json manually`)
			}
			break
		}

		case 'remove': {
			const name = args[1]
			if (!name) {
				logger.error('Usage: vole paw remove <name>')
				process.exit(1)
			}
			const { execa: execaFn } = await import('execa')
			await execaFn('npm', ['uninstall', name], { cwd: projectRoot, stdio: 'inherit' })
			await removePawFromConfig(projectRoot, name)
			logger.info(`Removed ${name} from vole.config.json`)
			break
		}

		default:
			logger.error(`Unknown paw command: ${subcommand}`)
			logger.info('Available: list, add, remove')
			process.exit(1)
	}
}

async function handleSkillCommand(
	args: string[],
	projectRoot: string,
): Promise<void> {
	const subcommand = args[0]

	switch (subcommand) {
		case 'create': {
			const name = args[1]
			if (!name) {
				logger.error('Usage: vole skill create <name>')
				process.exit(1)
			}
			await scaffoldSkill(projectRoot, name)
			break
		}

		case 'list': {
			// Lightweight — load SKILL.md files without spawning paws
			const config = await (await import('./config/index.js')).loadConfig(
				path.resolve(projectRoot, 'vole.config.json'),
			)
			const { SkillRegistry } = await import('./skill/registry.js')
			const { createMessageBus } = await import('./core/bus.js')
			const { ToolRegistry } = await import('./tool/registry.js')

			const bus = createMessageBus()
			const toolRegistry = new ToolRegistry(bus)
			const skillRegistry = new SkillRegistry(bus, toolRegistry, projectRoot)

			for (const skillName of config.skills) {
				await skillRegistry.load(skillName)
			}

			const skills = skillRegistry.list()
			if (skills.length === 0) {
				logger.info('No Skills configured')
			} else {
				logger.info('SKILL                          STATUS     MISSING')
				for (const skill of skills) {
					const status = skill.active ? 'active' : 'inactive'
					const missing = skill.missingTools.length > 0
						? skill.missingTools.join(', ')
						: '—'
					logger.info(
						`${skill.name.padEnd(31)}${status.padEnd(11)}${missing}`,
					)
				}
			}
			break
		}

		case 'add': {
			const name = args[1]
			if (!name) {
				logger.error('Usage: vole skill add <path-to-skill>')
				process.exit(1)
			}

			const skillPath = path.resolve(projectRoot, name)
			const { loadSkillFromDirectory } = await import('./skill/loader.js')
			const definition = await loadSkillFromDirectory(skillPath)

			if (!definition) {
				logger.error(`No valid SKILL.md found at ${skillPath}`)
				process.exit(1)
			}

			await addSkillToConfig(projectRoot, name)
			logger.info(`Added "${definition.name}" to vole.config.json`)
			if (definition.requiredTools.length > 0) {
				logger.info(`  requires tools: ${definition.requiredTools.join(', ')}`)
			}
			if (definition.requires?.env.length) {
				logger.info(`  requires env: ${definition.requires.env.join(', ')}`)
			}
			break
		}

		case 'remove': {
			const name = args[1]
			if (!name) {
				logger.error('Usage: vole skill remove <name>')
				process.exit(1)
			}
			await removeSkillFromConfig(projectRoot, name)

			// Delete from .openvole/skills/
			const fsModule = await import('node:fs/promises')
			const skillPath = name.startsWith('.') || name.startsWith('/')
				? path.resolve(projectRoot, name)
				: path.resolve(projectRoot, '.openvole', 'skills', name)
			try {
				await fsModule.rm(skillPath, { recursive: true })
				logger.info(`Deleted ${skillPath}`)
			} catch {
				// Directory may not exist — that's fine
			}

			logger.info(`Removed "${name}" from vole.config.json`)
			break
		}

		case 'search': {
			const query = args.slice(1).join(' ')
			if (!query) {
				logger.error('Usage: vole skill search <query>')
				process.exit(1)
			}
			const { VoleHubClient } = await import('./skill/volehub.js')
			const hub = new VoleHubClient()
			try {
				const results = await hub.search(query)
				if (results.length === 0) {
					logger.info('No skills found.')
				} else {
					logger.info(`Found ${results.length} skill(s):`)
					for (const skill of results) {
						logger.info(`  ${skill.name}@${skill.version} — ${skill.description}`)
						if (skill.tags.length > 0) {
							logger.info(`    tags: ${skill.tags.join(', ')}`)
						}
						if (skill.requiredTools.length > 0) {
							logger.info(`    requires: ${skill.requiredTools.join(', ')}`)
						}
					}
				}
			} catch (err) {
				logger.error(`VoleHub search failed: ${err instanceof Error ? err.message : String(err)}`)
			}
			break
		}

		case 'install': {
			const skillName = args[1]
			if (!skillName) {
				logger.error('Usage: vole skill install <name>')
				process.exit(1)
			}
			const { VoleHubClient: HubClient } = await import('./skill/volehub.js')
			const hubClient = new HubClient()
			try {
				const result = await hubClient.install(skillName, projectRoot)
				logger.info(`Installed ${result.skill.name}@${result.skill.version} to ${result.path}`)
				// Add to config
				await addSkillToConfig(projectRoot, `volehub/${result.skill.name}`)
				logger.info(`Added "volehub/${result.skill.name}" to vole.config.json`)
			} catch (err) {
				logger.error(`VoleHub install failed: ${err instanceof Error ? err.message : String(err)}`)
			}
			break
		}

		case 'uninstall': {
			const uninstallName = args[1]
			if (!uninstallName) {
				logger.error('Usage: vole skill uninstall <name>')
				process.exit(1)
			}
			const { VoleHubClient: UninstallClient } = await import('./skill/volehub.js')
			const uninstallClient = new UninstallClient()
			const removed = await uninstallClient.uninstall(uninstallName, projectRoot)
			if (removed) {
				await removeSkillFromConfig(projectRoot, `volehub/${uninstallName}`)
				logger.info(`Uninstalled "${uninstallName}" and removed from config`)
			} else {
				logger.error(`Skill "${uninstallName}" not found in VoleHub installations`)
			}
			break
		}

		case 'publish': {
			const publishPath = args[1] ?? '.'
			const { VoleHubClient: PubClient } = await import('./skill/volehub.js')
			const pubClient = new PubClient()
			try {
				const skillPath = path.resolve(projectRoot, publishPath)
				const prepared = await pubClient.preparePublish(skillPath)
				logger.info(`Skill ready for publishing:`)
				logger.info(`  name: ${prepared.name}`)
				logger.info(`  version: ${prepared.version}`)
				logger.info(`  description: ${prepared.description}`)
				logger.info(`  hash: ${prepared.contentHash}`)
				logger.info(`  tools: ${prepared.requiredTools.join(', ') || 'none'}`)
				logger.info(`  tags: ${prepared.tags.join(', ') || 'none'}`)
				logger.info('')
				logger.info('To publish, create a PR against https://github.com/openvole/volehub')
				logger.info(`with your SKILL.md in skills/${prepared.name}/`)
			} catch (err) {
				logger.error(`Publish preparation failed: ${err instanceof Error ? err.message : String(err)}`)
			}
			break
		}

		case 'hub': {
			const { VoleHubClient: ListClient } = await import('./skill/volehub.js')
			const listClient = new ListClient()
			const installed = await listClient.listInstalled(projectRoot)
			if (installed.length === 0) {
				logger.info('No VoleHub skills installed.')
			} else {
				logger.info(`VoleHub skills (${installed.length}):`)
				for (const skill of installed) {
					logger.info(`  ${skill.name}@${skill.version} (installed: ${skill.installedAt})`)
				}
			}
			break
		}

		default:
			logger.error(`Unknown skill command: ${subcommand}`)
			logger.info('Available: list, create, add, remove, search, install, uninstall, publish, hub')
			process.exit(1)
	}
}

async function handleToolCommand(
	args: string[],
	projectRoot: string,
): Promise<void> {
	const subcommand = args[0]

	switch (subcommand) {
		case 'list': {
			const isLive = args.includes('--live')

			if (isLive) {
				// Live mode — boot full engine (headless) to discover all tools including MCP
				const { setLoggerSilent } = await import('./core/logger.js')
				setLoggerSilent(true)

				const engine = await createEngine(projectRoot, { headless: true })
				await engine.start()

				// Wait for late tool registration (MCP servers)
				await new Promise((resolve) => setTimeout(resolve, 3000))

				setLoggerSilent(false)

				const tools = engine.toolRegistry.list()
				if (tools.length === 0) {
					console.log('No tools registered')
				} else {
					console.log(`${tools.length} tools:\n`)
					console.log('TOOL                              PAW                              TYPE')
					for (const tool of tools) {
						console.log(
							`${tool.name.padEnd(34)}${tool.pawName.padEnd(33)}${tool.inProcess ? 'in-process' : 'subprocess'}`,
						)
					}
				}

				await engine.shutdown()
			} else {
				// Lightweight mode — no paw spawning, no heartbeat
				// Shows core tools + tools declared in paw manifests
				const config = await (await import('./config/index.js')).loadConfig(
					path.resolve(projectRoot, 'vole.config.json'),
				)

				const tools: Array<{ name: string; pawName: string; type: string }> = []

				// Core tools
				const { createMessageBus } = await import('./core/bus.js')
				const { ToolRegistry } = await import('./tool/registry.js')
				const { SchedulerStore } = await import('./core/scheduler.js')
				const { TaskQueue } = await import('./core/task.js')
				const { SkillRegistry } = await import('./skill/registry.js')
				const { createCoreTools } = await import('./tool/core-tools.js')
				const { Vault } = await import('./core/vault.js')

				const bus = createMessageBus()
				const toolRegistry = new ToolRegistry(bus)
				const skillRegistry = new SkillRegistry(bus, toolRegistry, projectRoot)
				const taskQueue = new TaskQueue(bus, 1)
				const scheduler = new SchedulerStore()
				const vault = new Vault(path.resolve(projectRoot, '.openvole', 'vault.json'), process.env.VOLE_VAULT_KEY)
				await vault.init()
				const coreTools = createCoreTools(scheduler, taskQueue, projectRoot, skillRegistry, vault)
				toolRegistry.register('__core__', coreTools, true)

				for (const entry of toolRegistry.list()) {
					tools.push({ name: entry.name, pawName: entry.pawName, type: 'in-process' })
				}

				// Read paw manifests (without spawning) to get declared tools
				const { normalizePawConfig } = await import('./config/index.js')
				const { readPawManifest, resolvePawPath } = await import('./paw/manifest.js')
				for (const pawEntry of config.paws) {
					const pawConfig = normalizePawConfig(pawEntry)
					const pawPath = resolvePawPath(pawConfig.name, projectRoot)
					const manifest = await readPawManifest(pawPath)
					if (manifest?.tools) {
						for (const t of manifest.tools) {
							tools.push({
								name: t.name,
								pawName: pawConfig.name,
								type: manifest.inProcess ? 'in-process' : 'subprocess',
							})
						}
					}
				}

				if (tools.length === 0) {
					console.log('No tools registered')
				} else {
					console.log(`${tools.length} tools:\n`)
					console.log('TOOL                              PAW                              TYPE')
					for (const tool of tools) {
						console.log(
							`${tool.name.padEnd(34)}${tool.pawName.padEnd(33)}${tool.type}`,
						)
					}
				}
			}
			break
		}

		case 'call': {
			const toolName = args[1]
			const paramsJson = args[2]

			if (!toolName) {
				logger.error('Usage: vole tool call <tool-name> [json-params]')
				process.exit(1)
			}

			let params: unknown = {}
			if (paramsJson) {
				try {
					params = JSON.parse(paramsJson)
				} catch {
					logger.error('Invalid JSON params')
					process.exit(1)
				}
			}

			// Lightweight boot — only register core tools (no paw spawning)
			const { createMessageBus } = await import('./core/bus.js')
			const { ToolRegistry } = await import('./tool/registry.js')
			const { SchedulerStore } = await import('./core/scheduler.js')
			const { TaskQueue } = await import('./core/task.js')
			const { SkillRegistry } = await import('./skill/registry.js')
			const { Vault } = await import('./core/vault.js')
			const { createCoreTools } = await import('./tool/core-tools.js')

			const bus = createMessageBus()
			const toolRegistry = new ToolRegistry(bus)
			const skillRegistry = new SkillRegistry(bus, toolRegistry, projectRoot)
			const taskQueue = new TaskQueue(bus, 1)
			const scheduler = new SchedulerStore()
			scheduler.setPersistence(path.resolve(projectRoot, '.openvole', 'schedules.json'))
			await scheduler.loadFromDisk()
			const vault = new Vault(
				path.resolve(projectRoot, '.openvole', 'vault.json'),
				process.env.VOLE_VAULT_KEY,
			)
			await vault.init()
			const coreTools = createCoreTools(scheduler, taskQueue, projectRoot, skillRegistry, vault)
			toolRegistry.register('__core__', coreTools, true)

			const tool = toolRegistry.get(toolName)
			if (!tool) {
				logger.error(`Tool "${toolName}" not found in core tools`)
				logger.info('Core tools only — paw tools require a running "vole start" instance')
				process.exit(1)
			}

			try {
				if (tool.parameters && typeof tool.parameters.parse === 'function') {
					tool.parameters.parse(params)
				}
				const result = await tool.execute(params)
				console.log(JSON.stringify(result, null, 2))
			} catch (err) {
				logger.error(`Tool execution failed: ${err instanceof Error ? err.message : err}`)
				process.exit(1)
			}

			break
		}

		default:
			logger.error(`Unknown tool command: ${subcommand}`)
			logger.info('Available: list, call')
			process.exit(1)
	}
}

async function handleTaskCommand(
	args: string[],
	_projectRoot: string,
): Promise<void> {
	const subcommand = args[0]

	switch (subcommand) {
		case 'list':
			logger.info('Task list requires a running vole instance.')
			break

		case 'cancel': {
			const id = args[1]
			if (!id) {
				logger.error('Usage: vole task cancel <id>')
				process.exit(1)
			}
			logger.info('Task cancellation requires a running vole instance.')
			break
		}

		default:
			logger.error(`Unknown task command: ${subcommand}`)
			logger.info('Available: list, cancel')
			process.exit(1)
	}
}

/** Interactive prompt helper */
async function ask(question: string): Promise<string> {
	const rl = (await import('node:readline')).createInterface({
		input: process.stdin,
		output: process.stdout,
	})
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close()
			resolve(answer.trim())
		})
	})
}

/** Ask yes/no */
async function confirm(question: string): Promise<boolean> {
	const answer = await ask(`${question} [y/N] `)
	return answer.toLowerCase() === 'y'
}

/** Ask for a comma-separated list */
async function askList(question: string): Promise<string[]> {
	const answer = await ask(question)
	if (!answer) return []
	return answer.split(',').map((s) => s.trim()).filter(Boolean)
}

interface ToolSpec {
	name: string
	description: string
}

async function scaffoldPaw(projectRoot: string, name: string): Promise<void> {
	const fs = await import('node:fs/promises')

	const pawName = name.startsWith('paw-') ? name : `paw-${name}`
	const pawDir = path.resolve(projectRoot, 'paws', pawName)

	try {
		await fs.access(pawDir)
		logger.error(`Directory paws/${pawName} already exists`)
		process.exit(1)
	} catch {
		// Doesn't exist — good
	}

	// Interactive setup
	logger.info(`\nCreating Paw: ${pawName}\n`)

	const description = await ask('Description: ')

	// Collect tools
	const tools: ToolSpec[] = []
	logger.info('\nTools are actions the agent can perform (e.g., send_email, search_docs).')
	if (await confirm('Add tools?')) {
		let addMore = true
		while (addMore) {
			const toolName = await ask('  Tool name (e.g., send_message): ')
			if (!toolName) break
			const toolDesc = await ask('  Tool description: ')
			tools.push({ name: toolName, description: toolDesc })
			addMore = await confirm('  Add another tool?')
		}
	}

	// Hooks
	logger.info('\nHooks let your Paw react to agent activity automatically.')
	const wantObserve = await confirm('Log every tool execution? (observe hook)')
	const wantPerceive = await confirm('Inject context before the agent thinks? (perceive hook)')

	// Permissions
	logger.info('\nPermissions control what this Paw can access.')
	const networkDomains = await askList('Network domains (comma-separated, e.g., api.telegram.org): ')
	const listenPorts = (await askList('Ports to listen on (comma-separated, e.g., 3000): ')).map(Number).filter((n) => !Number.isNaN(n))
	const envVars = await askList('Env variables needed (comma-separated, e.g., TELEGRAM_TOKEN): ')

	logger.info('')

	// Generate files
	await fs.mkdir(path.join(pawDir, 'src'), { recursive: true })

	// vole-paw.json
	await fs.writeFile(
		path.join(pawDir, 'vole-paw.json'),
		JSON.stringify(
			{
				name: pawName,
				version: '0.1.0',
				description,
				entry: './dist/index.js',
				brain: false,
				inProcess: false,
				transport: 'ipc',
				tools: tools.map((t) => ({ name: t.name, description: t.description })),
				permissions: {
					network: networkDomains,
					listen: listenPorts,
					filesystem: [],
					env: envVars,
				},
			},
			null,
			2,
		) + '\n',
	)

	// package.json
	await fs.writeFile(
		path.join(pawDir, 'package.json'),
		JSON.stringify(
			{
				name: pawName,
				version: '0.1.0',
				description,
				type: 'module',
				main: './dist/index.js',
				scripts: {
					build: 'tsup',
					typecheck: 'tsc --noEmit',
				},
				dependencies: {
					'@openvole/paw-sdk': 'workspace:*',
				},
				devDependencies: {
					'@types/node': '^22.0.0',
					tsup: '^8.3.0',
					typescript: '^5.6.0',
				},
			},
			null,
			2,
		) + '\n',
	)

	// tsconfig.json
	await fs.writeFile(
		path.join(pawDir, 'tsconfig.json'),
		JSON.stringify(
			{
				extends: '../../tsconfig.base.json',
				compilerOptions: { outDir: './dist', rootDir: './src' },
				include: ['src/**/*.ts'],
			},
			null,
			2,
		) + '\n',
	)

	// tsup.config.ts
	await fs.writeFile(
		path.join(pawDir, 'tsup.config.ts'),
		`import { defineConfig } from 'tsup'

export default defineConfig({
\tentry: ['src/index.ts'],
\tformat: ['esm'],
\tdts: true,
\tclean: true,
\tsourcemap: true,
\ttarget: 'node20',
\tsplitting: false,
})
`,
	)

	// src/index.ts
	await fs.writeFile(
		path.join(pawDir, 'src', 'index.ts'),
		`import { definePaw } from '@openvole/paw-sdk'
import { paw } from './paw.js'

export default definePaw(paw)
`,
	)

	// src/paw.ts — generate with real tools from the interactive session
	const toolsCode = tools.length > 0
		? tools.map((t) => `\t\t{
\t\t\tname: '${t.name}',
\t\t\tdescription: '${t.description.replace(/'/g, "\\'")}',
\t\t\tparameters: z.object({
\t\t\t\t// Define your parameters here
\t\t\t}),
\t\t\tasync execute(params) {
\t\t\t\t// TODO: implement ${t.name}
\t\t\t\tthrow new Error('Not implemented')
\t\t\t},
\t\t},`).join('\n')
		: ''

	// Generate hooks code
	let hooksCode = ''
	if (wantObserve || wantPerceive) {
		const hookParts: string[] = []
		if (wantObserve) {
			hookParts.push(`\t\tonObserve: async (result) => {
\t\t\tconst status = result.success ? 'OK' : 'FAIL'
\t\t\tconsole.log(\`[${pawName}] \${result.toolName} → \${status} (\${result.durationMs}ms)\`)
\t\t},`)
		}
		if (wantPerceive) {
			hookParts.push(`\t\tonPerceive: async (context) => {
\t\t\t// Add data to context.metadata before the agent thinks
\t\t\t// context.metadata.myData = { ... }
\t\t\treturn context
\t\t},`)
		}
		hooksCode = `\n\thooks: {\n${hookParts.join('\n')}\n\t},\n`
	}

	await fs.writeFile(
		path.join(pawDir, 'src', 'paw.ts'),
		`import { z, type PawDefinition } from '@openvole/paw-sdk'

export const paw: PawDefinition = {
\tname: '${pawName}',
\tversion: '0.1.0',
\tdescription: '${description.replace(/'/g, "\\'")}',

\ttools: [
${toolsCode}
\t],
${hooksCode}
\tasync onLoad() {
\t\tconsole.log('[${pawName}] loaded')
\t},

\tasync onUnload() {
\t\tconsole.log('[${pawName}] unloaded')
\t},
}
`,
	)

	const allow: Record<string, unknown> = {}
	if (networkDomains.length > 0) allow.network = networkDomains
	if (listenPorts.length > 0) allow.listen = listenPorts
	if (envVars.length > 0) allow.env = envVars

	logger.info(`Created paws/${pawName}/`)
	if (tools.length > 0) {
		logger.info(`Generated ${tools.length} tool${tools.length > 1 ? 's' : ''}: ${tools.map((t) => t.name).join(', ')}`)
	}
	logger.info('')
	logger.info('Next: implement your tool logic in src/paw.ts, then build:')
	logger.info('  pnpm install && pnpm build')
}

async function scaffoldSkill(projectRoot: string, name: string): Promise<void> {
	const fs = await import('node:fs/promises')

	const skillName = name.startsWith('skill-') ? name : `skill-${name}`
	const skillDir = path.resolve(projectRoot, '.openvole', 'skills', skillName)

	try {
		await fs.access(skillDir)
		logger.error(`Skill "${skillName}" already exists`)
		process.exit(1)
	} catch {
		// Doesn't exist — good
	}

	// Interactive setup
	logger.info(`\nCreating Skill: ${skillName}\n`)

	const description = await ask('Description: ')

	logger.info('\nSkills describe behavior — what the agent should do, using tools provided by Paws.')
	const requiredTools = await askList('Required tools (comma-separated, e.g., email_search, email_send): ')
	const optionalTools = await askList('Optional tools (comma-separated, or empty): ')
	const tags = await askList('Tags (comma-separated, e.g., email, productivity): ')

	logger.info('')
	const instructions = await ask('Instructions (what should the agent do?): ')

	logger.info('')

	// Create skill directory with optional subdirectories
	await fs.mkdir(skillDir, { recursive: true })

	// Build YAML frontmatter
	const frontmatterLines = [
		`name: ${skillName}`,
		`description: "${description.replace(/"/g, '\\"')}"`,
	]

	if (requiredTools.length > 0) {
		frontmatterLines.push('requiredTools:')
		for (const t of requiredTools) {
			frontmatterLines.push(`  - ${t}`)
		}
	}

	if (optionalTools.length > 0) {
		frontmatterLines.push('optionalTools:')
		for (const t of optionalTools) {
			frontmatterLines.push(`  - ${t}`)
		}
	}

	if (tags.length > 0) {
		frontmatterLines.push('tags:')
		for (const t of tags) {
			frontmatterLines.push(`  - ${t}`)
		}
	}

	// SKILL.md
	const skillMd = `---
${frontmatterLines.join('\n')}
---

# ${skillName}

${instructions}
`

	await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMd)

	// Auto-register in config and lock file (use bare name — resolver finds it in .openvole/skills/)
	await addSkillToConfig(projectRoot, skillName)

	logger.info(`Created .openvole/skills/${skillName}/`)
	logger.info(`  SKILL.md — edit to refine instructions`)
	logger.info(`Added to vole.config.json`)
	if (requiredTools.length > 0) {
		logger.info(`Requires tools: ${requiredTools.join(', ')}`)
	}
}

async function handleClawHubCommand(
	args: string[],
	projectRoot: string,
): Promise<void> {
	const subcommand = args[0]

	switch (subcommand) {
		case 'install': {
			const skillName = args[1]
			if (!skillName) {
				logger.error('Usage: vole clawhub install <skill-name>')
				process.exit(1)
			}

			const fsModule = await import('node:fs/promises')
			const clawHubDir = path.resolve(projectRoot, '.openvole', 'skills', 'clawhub')
			await fsModule.mkdir(clawHubDir, { recursive: true })

			// Install into .openvole/skills/clawhub/<name>
			logger.info(`Installing "${skillName}" from ClawHub...`)
			const { execa: execaFn } = await import('execa')
			try {
				await execaFn('npx', ['clawhub', 'install', skillName, '--dir', clawHubDir], {
					cwd: projectRoot,
					stdio: 'inherit',
				})
			} catch {
				logger.error(`Failed to install "${skillName}" from ClawHub`)
				process.exit(1)
			}

			// Find the installed skill directory
			const installed = await fsModule.readdir(clawHubDir).catch(() => [] as string[])
			const skillDir = installed.find((d) => d === skillName || d.includes(skillName))

			if (!skillDir) {
				logger.error(`Skill installed but directory not found in .openvole/skills/clawhub/`)
				process.exit(1)
			}

			const localPath = `clawhub/${skillDir}`
			const { loadSkillFromDirectory } = await import('./skill/loader.js')
			const definition = await loadSkillFromDirectory(path.resolve(projectRoot, '.openvole', 'skills', 'clawhub', skillDir))

			if (definition) {
				await addSkillToConfig(projectRoot, localPath)
				logger.info(`Added "${definition.name}" to vole.config.json`)
				if (definition.requiredTools.length > 0) {
					logger.info(`  requires tools: ${definition.requiredTools.join(', ')}`)
				}
				if (definition.requires?.env.length) {
					logger.info(`  requires env: ${definition.requires.env.join(', ')}`)
				}
			} else {
				// Check if it's an OpenClaw plugin instead of a skill
				const fsCheck = await import('node:fs/promises')
				const pluginJsonPath = path.resolve(projectRoot, '.openvole', 'skills', 'clawhub', skillDir ?? skillName, 'openclaw.plugin.json')
				try {
					await fsCheck.access(pluginJsonPath)
					logger.error(`"${skillName}" is an OpenClaw plugin, not a skill. OpenVole does not support OpenClaw plugins — use Paws instead.`)
				} catch {
					logger.warn(`Installed "${skillName}" but could not parse SKILL.md — add to vole.config.json manually`)
				}
			}
			break
		}

		case 'search': {
			const query = args.slice(1).join(' ')
			if (!query) {
				logger.error('Usage: vole clawhub search <query>')
				process.exit(1)
			}

			const { execa: execaFn } = await import('execa')
			try {
				await execaFn('npx', ['clawhub', 'search', query], {
					cwd: projectRoot,
					stdio: 'inherit',
				})
			} catch {
				logger.error('Search failed — make sure clawhub is available (npx clawhub)')
			}
			break
		}

		case 'remove': {
			const skillName = args[1]
			if (!skillName) {
				logger.error('Usage: vole clawhub remove <skill-name>')
				process.exit(1)
			}

			const fsModule = await import('node:fs/promises')
			const skillPath = path.resolve(projectRoot, '.openvole', 'skills', 'clawhub', skillName)

			try {
				await fsModule.rm(skillPath, { recursive: true })
				logger.info(`Deleted .openvole/skills/clawhub/${skillName}`)
			} catch {
				logger.error(`Skill directory not found: .openvole/skills/clawhub/${skillName}`)
				process.exit(1)
			}

			// Remove from config
			await removeSkillFromConfig(projectRoot, `clawhub/${skillName}`)

			logger.info(`Removed "${skillName}" from vole.config.json`)
			break
		}

		default:
			logger.error(`Unknown clawhub command: ${subcommand}`)
			logger.info('Available: install, remove, search')
			process.exit(1)
	}
}

async function handleNetCommand(
	args: string[],
	projectRoot: string,
): Promise<void> {
	const subcommand = args[0]
	const netDir = path.resolve(projectRoot, '.openvole', 'net')

	switch (subcommand) {
		case 'init': {
			const { generateKeyPair } = await import('./net/index.js')
			const name = args[1] ?? 'vole'
			const keyPair = await generateKeyPair(netDir, name)
			logger.info(`Keypair generated!`)
			logger.info(`Instance ID: ${keyPair.instanceId}`)
			logger.info(`Public key:  ${keyPair.publicKeyString}`)
			logger.info('')
			logger.info(`Share your public key with peers:`)
			logger.info(`  ${keyPair.publicKeyString}`)
			logger.info('')
			logger.info(`Files:`)
			logger.info(`  Private key: .openvole/net/vole_key`)
			logger.info(`  Public key:  .openvole/net/vole_key.pub`)
			logger.info(`  Trusted peers: .openvole/net/authorized_voles`)
			break
		}

		case 'show-key': {
			const { loadKeyPair } = await import('./net/index.js')
			const keyPair = await loadKeyPair(netDir)
			if (!keyPair) {
				logger.error('No keypair found. Run "vole net init" first.')
				process.exit(1)
			}
			logger.info(keyPair.publicKeyString)
			break
		}

		case 'trust': {
			const key = args.slice(1).join(' ')
			if (!key) {
				logger.error('Usage: vole net trust <public-key-string>')
				process.exit(1)
			}
			const { trustPeer } = await import('./net/index.js')
			const instanceId = await trustPeer(netDir, key)
			logger.info(`Trusted peer: ${instanceId.substring(0, 8)}`)
			break
		}

		case 'revoke': {
			const id = args[1]
			if (!id) {
				logger.error('Usage: vole net revoke <instance-id-or-key>')
				process.exit(1)
			}
			const { revokePeer } = await import('./net/index.js')
			const removed = await revokePeer(netDir, id)
			if (removed) {
				logger.info(`Revoked peer: ${id.substring(0, 8)}`)
			} else {
				logger.error('Peer not found in authorized_voles')
			}
			break
		}

		case 'peers': {
			const { loadAuthorizedVoles } = await import('./net/index.js')
			const peers = await loadAuthorizedVoles(netDir)
			if (peers.size === 0) {
				logger.info('No trusted peers. Use "vole net trust <key>" to add one.')
			} else {
				logger.info(`Trusted peers (${peers.size}):`)
				for (const [id, peer] of peers) {
					logger.info(`  ${peer.name} — ${id.substring(0, 8)}`)
				}
			}
			break
		}

		case 'status': {
			const { loadKeyPair, loadAuthorizedVoles } = await import('./net/index.js')
			const keyPair = await loadKeyPair(netDir)
			const peers = await loadAuthorizedVoles(netDir)

			if (!keyPair) {
				logger.info('VoleNet: not initialized (run "vole net init")')
			} else {
				logger.info(`VoleNet Status`)
				logger.info(`  Instance ID: ${keyPair.instanceId}`)
				logger.info(`  Public key:  ${keyPair.publicKeyString}`)
				logger.info(`  Trusted peers: ${peers.size}`)
				for (const [id, peer] of peers) {
					logger.info(`    ${peer.name} — ${id.substring(0, 8)}`)
				}
			}
			break
		}

		default:
			logger.error(`Unknown net command: ${subcommand}`)
			logger.info('Available: init, show-key, trust, revoke, peers, status')
			process.exit(1)
	}
}

main().catch((err) => {
	console.error('Fatal error:', err)
	process.exit(1)
})
