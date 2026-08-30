import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The Chat tab after agent-to-agent conversations existed.
 *
 * Two agents talking produce sessions like any other, and nothing was filtering them — so an
 * orchestrator delegating on its heartbeat would have steadily raised unread counts on threads the
 * human never opened, in the list meant for the human's own conversations. That is the complaint
 * project chats were pulled out of this tab to fix, and it had to be answered again here.
 *
 * The answer is not to hide them: watching two agents negotiate is worth seeing. It is to keep
 * them out of your inbox and out of your way — a separate view, read-only, both speakers named.
 */

const UI = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../dashboard-server/src/ui.ts',
)

const read = () => fs.readFile(UI, 'utf-8')

function fn(source: string, name: string): string {
	const start = source.indexOf(`function ${name}(`)
	if (start === -1) throw new Error(`${name} not found in ui.ts`)
	const open = source.indexOf('{', start)
	let depth = 0
	for (let i = open; i < source.length; i++) {
		if (source[i] === '{') depth++
		else if (source[i] === '}' && --depth === 0) return source.substring(start, i + 1)
	}
	throw new Error(`${name} is unbalanced`)
}

describe('chat sidebar', () => {
	it('replaced the dropdown with a list', async () => {
		const ui = await read()
		// A dropdown hides what it holds until opened; the list is the navigation.
		expect(ui).toContain('id="chat-side-list"')
		expect(ui).not.toContain('id="chat-session"')
		expect(ui).not.toContain('onChatSessionChange')
	})

	it('orders threads by recency', async () => {
		// The one you want is nearly always the one that just moved.
		expect(fn(await read(), 'loadChatSessions')).toContain('return b.at - a.at')
	})

	it('shows your conversations or the agents’ — never mixed', async () => {
		const body = fn(await read(), 'loadChatSessions')
		expect(body).toContain('var shown = chatShowAgents ? theirs : mine')
		// Default is yours: the toggle starts false.
		expect(await read()).toContain('var chatShowAgents = false')
	})

	it('will not let you post into someone else’s conversation', async () => {
		const body = fn(await read(), 'chatApplyMode')
		// Read-only is the point — you are not a participant, so offering a composer would
		// invite posting as one of them.
		expect(body).toContain("composer.style.display = agent ? 'none' : ''")
		expect(body).toContain("readonly.style.display = agent ? '' : 'none'")
		// Nor delete their transcript.
		expect(body).toContain("clear.style.display = agent ? 'none' : ''")
	})

	it('names both speakers when neither of them is you', async () => {
		const ui = await read()
		const history = fn(ui, 'loadChatHistory')
		expect(history).toContain('var themName = agentThread ? agentPeerOf(chatSessionId)')
		expect(history).toContain('var usName = agentThread ? agentName(currentAgentId)')
		// Both roles carry a name into the bubble.
		expect(history).toMatch(/addChatBubble\('user',[^)]*themName\)/)
		expect(history).toMatch(/addChatBubble\('brain',[^)]*usName\)/)
	})

	it('stamps every message', async () => {
		const body = fn(await read(), 'addChatBubble')
		// "When was this said" was unanswerable anywhere in chat before, which made a transcript
		// impossible to line up against the event log or against what an agent claimed.
		expect(body).toContain('function addChatBubble(kind, text, extraClass, ts, who)')
		expect(body).toContain('fmtStamp(tsMs(ts))')
		expect(body).toContain("meta.className = 'chat-meta'")
	})

	it('leaves the agent view when you start a conversation of your own', async () => {
		// Otherwise the session you just created is filtered out the moment it exists.
		expect(fn(await read(), 'newChatSession')).toContain('chatShowAgents = false')
	})
})
