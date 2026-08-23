import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The overview's Tasks panel and the Live Events feed share one flex column. The panel used to be
 * sized `min-height: 190px; max-height: 400px`, so every task that arrived grew it and stole those
 * pixels from the feed below — the list crept downwards while you were reading it. It has to hold
 * one height and scroll inside itself instead.
 *
 * The row template also has to keep agreeing with the header on how many columns there are; the
 * empty-state `colspan` is the third thing that silently drifts when a column is added.
 */

const UI_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../dashboard-server/src/ui.ts',
)

async function readUi(): Promise<string> {
	return fs.readFile(UI_PATH, 'utf-8')
}

/** The body of `function NAME(...) { ... }` from the UI source. */
function extractFunction(source: string, name: string): string {
	const start = source.indexOf(`function ${name}(`)
	if (start === -1) throw new Error(`${name} not found in ui.ts`)
	const open = source.indexOf('{', start)
	let depth = 0
	for (let i = open; i < source.length; i++) {
		if (source[i] === '{') depth++
		else if (source[i] === '}' && --depth === 0) return source.substring(start, i + 1)
	}
	throw new Error(`${name} is unbalanced in ui.ts`)
}

describe('dashboard tasks panel', () => {
	it('pins the tasks list to a fixed height so it cannot squeeze Live Events', async () => {
		const ui = await readUi()
		const rule = ui.match(/\.tasks-panel \.panel-body \{([^}]*)\}/)
		expect(rule, '.tasks-panel .panel-body rule missing').toBeTruthy()
		const body = (rule as RegExpMatchArray)[1]
		expect(body).toMatch(/(^|[^-])height:\s*\d+px/)
		expect(body).not.toMatch(/min-height|max-height/)
	})

	it('renders the same column count in the header, the rows and the empty state', async () => {
		const ui = await readUi()
		const thead = ui.match(/<thead><tr>(.*?)<\/tr><\/thead>/)
		expect(thead, 'tasks table header missing').toBeTruthy()
		const columns = ((thead as RegExpMatchArray)[1].match(/<th>/g) || []).length
		expect(columns).toBeGreaterThan(0)

		const render = extractFunction(ui, 'renderTasks')
		expect((render.match(/\+ '<td/g) || []).length).toBe(columns)
		expect(render).toContain(`colspan="${columns}"`)
	})

	it('shows when each task ran, not only how long it took', async () => {
		const ui = await readUi()
		const render = extractFunction(ui, 'renderTasks')
		expect(render).toContain('formatWhen(t)')

		const formatWhen = extractFunction(ui, 'formatWhen')
		// A queued task has no startedAt yet, so the enqueue time has to stand in for it.
		expect(formatWhen).toContain('t.startedAt || t.createdAt')

		// The tooltip is the only place the full queued/started/finished trail is visible.
		const whenTitle = extractFunction(ui, 'whenTitle')
		for (const field of ['createdAt', 'startedAt', 'completedAt']) {
			expect(whenTitle).toContain(`t.${field}`)
		}
	})
})
