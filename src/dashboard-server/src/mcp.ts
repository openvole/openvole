import type * as http from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

/**
 * Bridges OpenVole's per-agent tools to an MCP client (e.g. Claude Code as a brain).
 * Uses the official MCP SDK server — no hand-rolled protocol, no paw-mcp (client-side) code.
 * Tool execution is delegated back to the engine via the same path the dashboard panels use.
 */
export interface McpDeps {
	/** Tools available in this agent (name + description + optional JSON-schema params). */
	listTools: () => Promise<Array<{ name: string; description?: string; parameters?: unknown }>>
	/** Execute a tool in this agent and return its raw result. */
	callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
}

const isJsonSchema = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && ('type' in v || 'properties' in v)

/** Handle one MCP HTTP request (stateless) for a single agent. */
export async function handleMcpRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	body: unknown,
	deps: McpDeps,
): Promise<void> {
	const server = new Server({ name: 'openvole', version: '1.0.0' }, { capabilities: { tools: {} } })

	server.setRequestHandler(ListToolsRequestSchema, async () => {
		const tools = await deps.listTools()
		return {
			tools: tools.map((t) => ({
				name: t.name,
				description: t.description || '',
				// Pass the tool's real JSON Schema when present; else a permissive object
				// (OpenVole validates arguments server-side regardless).
				inputSchema: isJsonSchema(t.parameters) ? t.parameters : { type: 'object' as const },
			})),
		}
	})

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const out = await deps.callTool(
			request.params.name,
			(request.params.arguments ?? {}) as Record<string, unknown>,
		)
		return {
			content: [
				{ type: 'text' as const, text: typeof out === 'string' ? out : JSON.stringify(out) },
			],
		}
	})

	// Stateless: a fresh transport+server per request (no session tracking needed for tools).
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
	res.on('close', () => {
		void transport.close()
		void server.close()
	})
	await server.connect(transport)
	await transport.handleRequest(req, res, body)
}
