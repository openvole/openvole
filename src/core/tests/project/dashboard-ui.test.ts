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
				expect(
					allowed,
					`ui.ts offers ${state} → ${move}, which core rejects`,
				).toContain(move as never)
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
		expect(lone, `found ${lone.length} single backslashes that the template literal will eat`).toEqual([])
	})

	it('wires the tab, its loader, and the commands it depends on', async () => {
		const source = await readUi()
		expect(source).toContain(`switchTab('projects')`)
		expect(source).toContain(`id="tab-projects"`)
		expect(source).toContain(`if (tabName === 'projects') loadProjects();`)
		for (const command of [
			'project_list',
			'project_open',
			'project_scan',
			'project_create',
			'project_update',
			'project_archive',
			'task_add',
			'task_update',
		]) {
			expect(source, `ui.ts never sends ${command}`).toContain(`sendCommand('${command}'`)
		}
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
		const server = await fs.readFile(
			path.resolve(path.dirname(UI_PATH), 'server.ts'),
			'utf-8',
		)
		for (const command of [
			'project_list',
			'project_open',
			'project_scan',
			'project_create',
			'project_update',
			'project_archive',
			'task_add',
			'task_update',
		]) {
			expect(server, `server.ts has no case for ${command}`).toContain(`case '${command}'`)
		}
	})
})
