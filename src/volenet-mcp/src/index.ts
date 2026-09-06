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
import { install } from './install.js'
import { type Node, resolveSettings, startNode } from './node.js'
import { TOOLS } from './tools.js'

export { Inbox } from './inbox.js'
export { type Settings, defaultDir, defaultName, loadStored, saveStored } from './config.js'
export { type Node, type NodeOptions, resolveSettings, startNode } from './node.js'
export { TOOLS, type ToolDef } from './tools.js'

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
			return { content: [{ type: 'text' as const, text }] }
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
	if (process.argv[2] === 'install') {
		process.exit(install(process.argv.slice(3)))
	}
	main().catch((err) => {
		process.stderr.write(`volenet-mcp: ${err instanceof Error ? err.message : String(err)}\n`)
		process.exit(1)
	})
}
