/**
 * VoleNet as an MCP server.
 *
 * Claude Code is very good inside one machine and one session. It has no way to reach a person on
 * their phone, no way to talk to an agent someone else owns, and no identity that outlives the
 * session. VoleNet has all three and none of it is coding-assistant work — signed identity, hybrid
 * post-quantum sealing, a hub that carries ciphertext it cannot read, consent, and hold-and-forward
 * for a peer that is not there right now.
 *
 * So this is not another agent. It is the network, handed to an agent that already exists.
 *
 * stdio transport, which means **stdout belongs to the protocol**: anything printed there that is
 * not a JSON-RPC frame breaks the client. The core logger is silent by default and writes to a file
 * when VOLE_LOG_FILE is set; diagnostics here go to stderr.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
	CallToolRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { run as runCli } from './cli.js'
import { type Node, resolveSettings, startNode } from './node.js'
import { PROMPTS } from './prompts.js'
import { TOOLS } from './tools.js'

export { Inbox } from './inbox.js'
export { run as runCli } from './cli.js'
export { type Settings, defaultDir, defaultName, loadStored, saveStored } from './config.js'
export { type Node, type NodeOptions, resolveSettings, startNode } from './node.js'
export { PROMPTS, type PromptDef } from './prompts.js'
export { TOOLS, type ToolDef } from './tools.js'

/**
 * What is waiting, appended to every tool's result.
 *
 * MCP has no way for a server to push, so an arrived message would otherwise sit unseen until
 * somebody thought to look. Saying so on every result means any use of any tool surfaces it —
 * ambient awareness in place of the notification the protocol cannot send. The tools that just
 * showed you the messages are excluded, since they leave nothing unread.
 */
export async function unreadFooter(node: Node, toolName: string): Promise<string> {
	if (toolName === 'volenet_inbox' || toolName === 'volenet_wait') return ''
	// Read from disk, not memory: the daemon appends and a hook advances the cursor, both as
	// separate processes. A footer built from what this process last loaded would report messages
	// as unread that the person has already been shown.
	await node.inbox.refresh().catch(() => undefined)
	const unread = node.inbox.unread()
	if (unread.length === 0) return ''
	const who = [...new Set(unread.map((m) => m.peerName))].join(', ')
	return `\n\n— ${unread.length} unread message${unread.length === 1 ? '' : 's'} from ${who}. Read them with volenet_inbox.`
}

/** Wire the tools to an MCP server. Separated so a test can drive it without a transport. */
export function createServer(node: Node): Server {
	const server = new Server(
		{ name: 'volenet', version: '0.1.0' },
		{ capabilities: { tools: {}, prompts: {} } },
	)

	// Flows, so a fresh session does not have to infer the order of things from a tool list.
	server.setRequestHandler(ListPromptsRequestSchema, async () => ({
		prompts: PROMPTS.map((p) => ({
			name: p.name,
			description: p.description,
			...(p.arguments ? { arguments: p.arguments } : {}),
		})),
	}))

	server.setRequestHandler(GetPromptRequestSchema, async (request) => {
		const prompt = PROMPTS.find((p) => p.name === request.params.name)
		if (!prompt) throw new Error(`No such prompt: ${request.params.name}`)
		return {
			description: prompt.description,
			messages: [
				{
					role: 'user' as const,
					content: {
						type: 'text' as const,
						text: prompt.render((request.params.arguments ?? {}) as Record<string, string>),
					},
				},
			],
		}
	})

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: TOOLS.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema as { type: 'object' },
		})),
	}))

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const tool = TOOLS.find((t) => t.name === request.params.name)
		if (!tool) {
			return {
				content: [{ type: 'text' as const, text: `No such tool: ${request.params.name}` }],
				isError: true,
			}
		}
		try {
			const text = await tool.run(node, (request.params.arguments ?? {}) as Record<string, unknown>)
			return {
				content: [{ type: 'text' as const, text: text + (await unreadFooter(node, tool.name)) }],
			}
		} catch (err) {
			// A failed tool is a result, not a crash: the session should see why and carry on.
			return {
				content: [
					{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) },
				],
				isError: true,
			}
		}
	})

	return server
}

/** Remember what the client can do, so a later session can say so without asking again. */
export async function recordClientCapabilities(dir: string, caps: unknown): Promise<void> {
	try {
		const fs = await import('node:fs/promises')
		const path = await import('node:path')
		await fs.mkdir(dir, { recursive: true })
		await fs.writeFile(
			path.join(dir, 'client.json'),
			`${JSON.stringify(caps ?? {}, null, 2)}\n`,
			'utf-8',
		)
	} catch {
		// Diagnostics only; never worth failing a startup over.
	}
}

async function main(): Promise<void> {
	const options = await resolveSettings()
	const node = await startNode(options)
	const server = createServer(node)
	await server.connect(new StdioServerTransport())
	// What the client offers back decides what is possible here. `sampling` is the only route to
	// an unprompted reply — it lets a server ask the client to run a model — so record it rather
	// than guess, and let whoami report it honestly.
	const caps = server.getClientCapabilities()
	node.canSample = Boolean(caps && typeof caps === 'object' && 'sampling' in caps)
	await recordClientCapabilities(options.dir, caps)
	const me = await node.net.identity().catch(() => null)
	process.stderr.write(
		`volenet-mcp: ${options.name} (${me?.instanceId.substring(0, 8) ?? '?'}) ready — node ${node.where}` +
			`${options.hub ? `, hub ${options.hub}` : ', no hub configured'}\n`,
	)

	let stopping = false
	const shutdown = async () => {
		if (stopping) return
		stopping = true
		await node.stop().catch(() => undefined)
		process.exit(0)
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
	// The client closing its end is the ordinary way this ends.
	process.stdin.on('close', shutdown)
}

// Only when run as the binary, so importing this module in a test starts nothing.
if (process.argv[1]?.includes('volenet-mcp') || process.env.VOLENET_MCP_RUN === '1') {
	// A bare invocation is the MCP server over stdio, which is how a client starts it — but a
	// person who runs it in a terminal means the opposite, and would otherwise get a process that
	// looks hung, or a port conflict from a server they did not know they had started. A client
	// attaches a pipe, never a TTY, so that is the honest way to tell them apart.
	if (process.argv[2] || process.stdin.isTTY) {
		runCli(process.argv.slice(2))
			.then((code) => process.exit(code))
			.catch((err) => {
				process.stderr.write(`volenet-mcp: ${err instanceof Error ? err.message : String(err)}\n`)
				process.exit(1)
			})
	} else {
		main().catch((err) => {
			process.stderr.write(`volenet-mcp: ${err instanceof Error ? err.message : String(err)}\n`)
			process.exit(1)
		})
	}
}
