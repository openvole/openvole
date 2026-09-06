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
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { run as runCli } from './cli.js'
import { type Node, resolveSettings, startNode } from './node.js'
import { TOOLS } from './tools.js'

export { Inbox } from './inbox.js'
export { run as runCli } from './cli.js'
export { type Settings, defaultDir, defaultName, loadStored, saveStored } from './config.js'
export { type Node, type NodeOptions, resolveSettings, startNode } from './node.js'
export { TOOLS, type ToolDef } from './tools.js'

/**
 * What is waiting, appended to every tool's result.
 *
 * MCP has no way for a server to push, so an arrived message would otherwise sit unseen until
 * somebody thought to look. Saying so on every result means any use of any tool surfaces it —
 * ambient awareness in place of the notification the protocol cannot send. The tools that just
 * showed you the messages are excluded, since they leave nothing unread.
 */
export function unreadFooter(node: Node, toolName: string): string {
	if (toolName === 'volenet_inbox' || toolName === 'volenet_wait') return ''
	const unread = node.inbox.unread()
	if (unread.length === 0) return ''
	const who = [...new Set(unread.map((m) => m.peerName))].join(', ')
	return `\n\n— ${unread.length} unread message${unread.length === 1 ? '' : 's'} from ${who}. Read them with volenet_inbox.`
}

/** Wire the tools to an MCP server. Separated so a test can drive it without a transport. */
export function createServer(node: Node): Server {
	const server = new Server({ name: 'volenet', version: '0.1.0' }, { capabilities: { tools: {} } })

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
			return { content: [{ type: 'text' as const, text: text + unreadFooter(node, tool.name) }] }
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

async function main(): Promise<void> {
	const options = await resolveSettings()
	const node = await startNode(options)
	const server = createServer(node)
	await server.connect(new StdioServerTransport())
	process.stderr.write(
		`volenet-mcp: ${options.name} (${node.net.getKeyPair()?.instanceId.substring(0, 8)}) ready` +
			`${options.hub ? ` — hub ${options.hub}` : ' — no hub configured'}\n`,
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
