import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TASK_TRANSITIONS } from '../../src/project/types.js'

/**
 * The dashboard's projects UI lives in a single template literal in `ui.ts` with no build-time
 * link to core's types, so it carries its own copy of the task state machine. A copy that drifts
 * would offer the operator buttons for moves the store rejects — a dead button is worse than a
 * missing one, because it looks like the system is broken rather than the UI being out of date.
 *
 * These tests read the shipped `ui.ts` and check the copy against the real thing. They also pin
 * the escaping that the outer template literal keeps eating: `\\'` inside it collapses to `'`
 * before the browser sees it, which silently breaks every generated onclick handler.
 */

const UI_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../dashboard-server/src/ui.ts',
)

/** Every command the projects surface sends; both ends must know about each one. */
const DASHBOARD_COMMANDS = [
	'project_list',
	'project_open',
	'project_scan',
	'project_create',
	'project_update',
	'project_archive',
	'task_add',
	'task_update',
	'list_directories',
	'grant_path',
	'project_files',
]

async function readUi(): Promise<string> {
	return fs.readFile(UI_PATH, 'utf-8')
}

/** Pull `var NAME = { ... };` out of the UI source and parse it as JSON-ish. */
function extractObject(source: string, name: string): Record<string, string[]> {
	const start = source.indexOf(`var ${name} = {`)
	if (start === -1) throw new Error(`${name} not found in ui.ts`)
	const open = source.indexOf('{', start)
	let depth = 0
	let end = open
	for (let i = open; i < source.length; i++) {
		if (source[i] === '{') depth++
		else if (source[i] === '}') {
			depth--
			if (depth === 0) {
				end = i
				break
			}
		}
	}
	const body = source.substring(open, end + 1)
	// Keys are bare identifiers and values are single-quoted — normalize both for JSON.parse.
	const json = body.replace(/([a-z_]+):/gi, '"$1":').replace(/'/g, '"')
	return JSON.parse(json)
}

describe('dashboard projects UI', () => {
	it('its task state machine matches core exactly', async () => {
		const moves = extractObject(await readUi(), 'TASK_MOVES')

		// Same states, no more and no fewer.
		expect(Object.keys(moves).sort()).toEqual(Object.keys(TASK_TRANSITIONS).sort())

		for (const [state, allowed] of Object.entries(TASK_TRANSITIONS)) {
			const uiMoves = moves[state] ?? []
			// The UI may omit a move it has no button for, but must never offer one the store
			// rejects — that is the failure the operator would see as a broken dashboard.
			for (const move of uiMoves) {
				expect(allowed, `ui.ts offers ${state} → ${move}, which core rejects`).toContain(
					move as never,
				)
			}
		}
	})

	it('gives every non-terminal state a way forward', async () => {
		const moves = extractObject(await readUi(), 'TASK_MOVES')
		for (const [state, allowed] of Object.entries(TASK_TRANSITIONS)) {
			if (allowed.length === 0) {
				expect(moves[state], `${state} is terminal but the UI offers moves`).toEqual([])
			} else {
				expect(moves[state]?.length, `${state} has no button in the UI`).toBeGreaterThan(0)
			}
		}
	})

	it('colours every state, so none renders without a dot', async () => {
		const colors = extractObject(await readUi(), 'TASK_STATE_COLOR')
		expect(Object.keys(colors).sort()).toEqual(Object.keys(TASK_TRANSITIONS).sort())
	})

	it('shows every state on the board', async () => {
		const source = await readUi()
		const match = source.match(/var BOARD_ORDER = \[(.*?)\]/s)
		expect(match).toBeTruthy()
		const order = (match?.[1] ?? '').split(',').map((s) => s.trim().replace(/'/g, ''))
		expect(order.sort()).toEqual(Object.keys(TASK_TRANSITIONS).sort())
	})

	it('escapes quotes for the outer template literal', async () => {
		const source = await readUi()
		const start = source.indexOf('/* === Projects & tasks')
		const end = source.indexOf('function initVolenetTab() {', start)
		expect(start).toBeGreaterThan(-1)
		const block = source.substring(start, end)

		// ui.ts is itself a template literal: a lone \' collapses to ' before the browser parses
		// the script, breaking every onclick it appears in. They must be doubled in source.
		const lone = block.match(/(?<!\\)\\(?!\\)/g) ?? []
		expect(
			lone,
			`found ${lone.length} single backslashes that the template literal will eat`,
		).toEqual([])
	})

	it('wires the tab, its loader, and the commands it depends on', async () => {
		const source = await readUi()
		expect(source).toContain(`switchTab('projects')`)
		expect(source).toContain(`id="tab-projects"`)
		expect(source).toContain(`if (tabName === 'projects') loadProjects();`)
		for (const command of DASHBOARD_COMMANDS) {
			expect(source, `ui.ts never sends ${command}`).toContain(`sendCommand('${command}'`)
		}
	})

	it('addresses picker entries by index, never by interpolating a path', async () => {
		const source = await readUi()
		const start = source.indexOf('function browseDir(')
		const block = source.substring(start, source.indexOf('function useDirPicked(', start))
		// Paths carry spaces, quotes and backslashes, and this file is a template literal that
		// eats escapes — interpolating one into an onclick is how that breaks silently.
		expect(block).toContain('browseDirAt(')
		expect(block).not.toMatch(/onclick="browseDir\('/)
	})

	it('keeps drafting traffic out of the chat transcript and unread badge', async () => {
		const source = await readUi()
		// Drafts run as real agent tasks, so without this they would toast "the agent replied",
		// bump the unread count, and appear as a session you could open.
		expect(source).toContain('sessionId === DRAFT_SESSION')
		expect((source.match(/=== DRAFT_SESSION\) continue/g) ?? []).length).toBe(2)
	})

	it('never writes a draft to disk on the human’s behalf', async () => {
		const source = await readUi()
		const start = source.indexOf('function draftOnTaskEvent(')
		const block = source.substring(start, source.indexOf('function stripDraftFence(', start))
		// A draft fills the editor and stops there — identity you have not read is not identity.
		expect(block).not.toContain('write_identity')
		expect(block).not.toContain('project_update')
	})

	it('keeps project conversations off the central chat tab', async () => {
		const source = await readUi()
		// The complaint this answers: a flat list of unlabelled sessions. Project talk belongs to
		// the project page, so it must not appear as an openable session or bump that badge.
		expect(source).toContain("data.sessionId.indexOf('project:') === 0")
		expect((source.match(/sessionId\.indexOf\('project:'\) === 0\) continue/g) ?? []).length).toBe(
			2,
		)
	})

	it('names the project chat session so the run carries its scope', async () => {
		const source = await readUi()
		expect(source).toContain("return 'project:' + projectId")
		// The adapter derives projectId from this prefix, which is what loads CONTEXT.md into
		// the prompt — if the two ever disagree the chat silently runs unscoped.
		const adapter = await fs.readFile(
			path.resolve(path.dirname(UI_PATH), '../../core/src/agent/control-adapter.ts'),
			'utf-8',
		)
		expect(adapter).toMatch(/\^project:/)
	})

	it('guards renders against a mid-flight agent switch', async () => {
		const source = await readUi()
		const start = source.indexOf('function loadProjects()')
		const end = source.indexOf('function initVolenetTab() {', start)
		const block = source.substring(start, end)
		// Every async render in this dashboard takes a viewEpoch and drops if the view moved on;
		// without it, switching agents mid-request paints the previous agent's projects.
		expect(block).toContain('var epoch = viewEpoch')
		expect(block).toContain('viewChanged(epoch)')
	})

	it('handles every command it sends in the server', async () => {
		const server = await fs.readFile(path.resolve(path.dirname(UI_PATH), 'server.ts'), 'utf-8')
		for (const command of DASHBOARD_COMMANDS) {
			expect(server, `server.ts has no case for ${command}`).toContain(`case '${command}'`)
		}
	})

	it('keeps the CONTEXT.md preview collapsed until asked', async () => {
		const source = await readUi()
		// It is written once and read by the agent, not by you — open by default it cost half the
		// screen above the board, which is what the page is actually for.
		expect(source).toContain('var projContextOpen = false;')
		expect(source).toContain("projContextOpen ? '' : 'none'")
		expect(source).toContain('function toggleProjContext()')
	})

	describe('the project conversation', () => {
		it('offers clear and compact, and both ask first', async () => {
			const source = await readUi()
			expect(source).toContain('function pchatClear()')
			expect(source).toContain('function pchatCompact()')
			for (const fn of ['pchatClear', 'pchatCompact']) {
				const block = source.substring(source.indexOf(`function ${fn}(`))
				expect(block.substring(0, block.indexOf('\n}')), `${fn} acts without asking`).toContain(
					'pfAsk(',
				)
			}
		})

		it('gives compaction a deadline long enough for the brain to answer', async () => {
			const source = await readUi()
			const block = source.substring(source.indexOf('function pchatCompact('))
			// The default websocket deadline is for lookups. Compaction runs a full think, which on
			// a CLI-backed brain takes minutes — at the default every compaction fails.
			const call = block.split('\n').find((l) => l.includes("sendCommand('chat_compact'")) ?? ''
			expect(call, 'chat_compact is sent without an explicit deadline').toMatch(/\b\d{6,}\b/)
		})

		it('paints a window of the transcript, not all of it', async () => {
			const source = await readUi()
			// The transcript on disk stays whole; this is only what gets rendered. Painting a
			// thousand-message conversation to show the last three reads as a broken page.
			expect(source).toContain('var PCHAT_WINDOW =')
			expect(source).toContain('function renderProjectChat(')
			const block = source.substring(source.indexOf('function renderProjectChat('))
			expect(block.substring(0, block.indexOf('\n}'))).toContain('earlier')
		})

		it('handles chat_compact on both sides of the wire', async () => {
			const server = await fs.readFile(path.resolve(path.dirname(UI_PATH), 'server.ts'), 'utf-8')
			expect(server).toContain(`case 'chat_compact'`)
			const adapter = await fs.readFile(
				path.resolve(path.dirname(UI_PATH), '../../core/src/agent/control-adapter.ts'),
				'utf-8',
			)
			expect(adapter).toContain(`case 'chat_compact'`)
			// Nothing is destroyed until a summary exists: a failed think must leave the chat alone.
			const block = adapter.substring(adapter.indexOf(`case 'chat_compact'`))
			const body = block.substring(0, block.indexOf(`case 'chat_clear'`))
			expect(body.indexOf('pawRegistry.think')).toBeLessThan(body.indexOf('clear.execute'))
		})
	})

	describe('the project file manager', () => {
		it('wires the Files sub-tab to its loader', async () => {
			const source = await readUi()
			expect(source).toContain(`projSubtab === 'files'`)
			expect(source).toContain('>Files</button>')
			expect(source).toContain(`id="proj-files-view"`)
			// Both entry points: switching sub-tabs, and landing on a project with Files already
			// selected. Wiring only the first leaves an empty pane after any board refresh.
			expect(source).toContain(`if (name === 'files' && currentProjectId) loadProjectFiles`)
			expect(source).toContain(`if (projSubtab === 'files') loadProjectFiles(p.id)`)
		})

		it('addresses entries by index, never by interpolating a filename', async () => {
			const source = await readUi()
			const start = source.indexOf('function pfRenderList(')
			const block = source.substring(start, source.indexOf('function pfUp(', start))
			// A filename may contain a quote or a backslash, and this file is a template literal
			// that eats escapes — an integer index cannot break the handler it lands in. The tell
			// for the wrong version is a quoted argument: onclick="pfEnter(\'" + name + "\')".
			expect(block).toContain(`onclick="pfEnter(' + i + ')"`)
			expect(block).not.toMatch(/onclick="pf[A-Za-z]+\(\\'/)
		})

		it('puts file content in the textarea through .value, not innerHTML', async () => {
			const source = await readUi()
			const start = source.indexOf('function pfRenderEditor(')
			const block = source.substring(start, source.indexOf('function pfMarkDirty(', start))
			// The file being edited is arbitrary text: built by concatenation, one closing
			// </textarea> inside a file would end the element and inject the rest as markup.
			expect(block).toContain(`document.getElementById('pf-content').value = file.content`)
			expect(block).not.toMatch(/<\/textarea>'\s*\+/)
		})

		it('guards its renders against a mid-flight agent switch', async () => {
			const source = await readUi()
			const start = source.indexOf('function pfBrowse(')
			const block = source.substring(start, source.indexOf('function pfRenderRoots(', start))
			expect(block).toContain('var epoch = viewEpoch')
			expect(block).toContain('viewChanged(epoch)')
		})

		it('sends only operations the control plane implements', async () => {
			const source = await readUi()
			const start = source.indexOf('function loadProjectFiles(')
			const block = source.substring(start, source.indexOf('function moveTask(', start))

			const ops = [...block.matchAll(/op: '([a-z]+)'/g)].map((m) => m[1])
			expect(ops.length, 'the file manager sends no operations at all').toBeGreaterThan(0)

			const plane = await fs.readFile(
				path.resolve(path.dirname(UI_PATH), '../../core/src/agent/control-plane.ts'),
				'utf-8',
			)
			const dispatch = plane.substring(plane.indexOf('async projectFiles('))
			for (const op of new Set(ops)) {
				expect(dispatch, `the control plane has no case for op "${op}"`).toContain(`case '${op}'`)
			}
		})

		it('asks before discarding an unsaved edit', async () => {
			const source = await readUi()
			const start = source.indexOf('function loadProjectFiles(')
			const block = source.substring(start, source.indexOf('function moveTask(', start))
			// Every navigation away from the editor goes through the same guard — clicking a folder
			// and silently losing what you typed is the worst thing a file manager can do.
			expect(block).toContain('function pfGuard(')
			for (const navigator of ['pfUp', 'pfCrumbTo', 'pfSwitchRoot', 'pfEnter', 'pfOpenFile']) {
				const fn = block.substring(block.indexOf(`function ${navigator}(`))
				expect(
					fn.substring(0, fn.indexOf('\n}')),
					`${navigator} discards edits silently`,
				).toContain('pfGuard(')
			}
		})

		it('uses the dashboard modal, never the browser dialogs', async () => {
			const source = await readUi()
			const start = source.indexOf('function loadProjectFiles(')
			const block = source.substring(start, source.indexOf('function moveTask(', start))
			// prompt() and confirm() block the page, cannot be styled, and browsers increasingly
			// suppress them — a delete that silently never asks is worse than one that asks badly.
			// Comments stripped first: this file explains why it does not call them.
			const code = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
			expect(code).not.toMatch(/(?<![.\w])prompt\(/)
			expect(code).not.toMatch(/(?<![.\w])confirm\(/)
			expect(block).toContain('openModal(')
			// A destructive dialog has to look destructive.
			const del = block.substring(block.indexOf('function pfDelete('))
			expect(del.substring(0, del.indexOf('\n}'))).toContain('danger: true')
		})

		it('streams uploads to the project route both ends agree on', async () => {
			const source = await readUi()
			const server = await fs.readFile(path.resolve(path.dirname(UI_PATH), 'server.ts'), 'utf-8')
			expect(source).toContain("'/project-upload/' + encodeURIComponent(agentId)")
			expect(server).toContain("req.url?.startsWith('/project-upload/')")
			// The destination is resolved server-side inside the project's roots — the browser never
			// gets to name a path on disk, which is why there is no path parameter to find here.
			expect(server).toContain('callbacks.resolveProjectUpload')
			expect(source).not.toMatch(/project-upload[^']*&path=/)
		})

		it('pins the upload destination instead of reading it back when each one lands', async () => {
			const source = await readUi()
			const fn = source.substring(source.indexOf('function pfUploadFiles('))
			const block = fn.substring(0, fn.indexOf('\n}'))
			// Uploads are async and the operator can browse while they run — a file landing in
			// whichever folder happened to be open when it finished is the bug this prevents.
			expect(block).toContain('var dir = pfPath;')
			expect(block).toContain('&dir=')
			expect(block).toContain('encodeURIComponent(dir)')
		})
	})
})
