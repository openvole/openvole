/**
 * Channels — how an agent reaches its human.
 *
 * A channel is not a core abstraction with its own tool: it is a Paw that declares
 * `"category": "channel"` in its manifest and exposes its own send tool (`chat_send`,
 * `telegram_send`, `slack_send`, …). Core's only job is to *know which Paws are channels* so it
 * can tell the agent they exist (system prompt), keep them reachable under tool horizon, and
 * skip them when there is no human attached (headless).
 *
 * This is deliberately thin. There is no `message_user` wrapper, no channel config, no routing
 * layer: the agent calls the channel's own tool, exactly as it would any other tool. The naming
 * convention is what makes a channel legible — `<id>_send`, where the id is the Paw name minus
 * the `@openvole/paw-` prefix.
 */

import type { PawInstance } from '../paw/types.js'
import type { ToolRegistry } from '../tool/registry.js'

/** A channel available to the agent — a channel Paw, or one core provides itself. */
export interface ChannelInfo {
	/** Channel id — the Paw name minus `@openvole/paw-` (`chat`, `telegram`, `slack`). */
	id: string
	pawName: string
	/** The tool that sends a message out on this channel, when one is discoverable. */
	sendTool?: string
	/** Every tool this channel registered. */
	tools: string[]
	description: string
}

/**
 * Channels core provides itself, keyed by the tool that sends on them.
 *
 * The dashboard chat is core's own surface — no credentials, no external service, nothing a
 * subprocess sandbox would protect — so its send path is a core tool rather than a Paw, and
 * every agent has it without installing anything. It is still *a channel*: same registry, same
 * prompt section, same idiom as `telegram_send`.
 */
const BUILTIN_CHANNELS: Array<Omit<ChannelInfo, 'tools'> & { sendTool: string }> = [
	{
		id: 'chat',
		pawName: '__core__',
		sendTool: 'chat_send',
		description: 'The dashboard chat — your human reads it in the Chat tab',
	},
]

/** Strip the package scope and `paw-` prefix: `@openvole/paw-telegram` → `telegram`. */
export function channelIdFor(pawName: string): string {
	return pawName
		.replace(/^@[^/]+\//, '')
		.replace(/^paw-/, '')
		.toLowerCase()
}

/**
 * Pick the send tool for a channel.
 *
 * Prefers the convention (`<id>_send`) so a Paw with several tools — `telegram_send`,
 * `telegram_reply`, `telegram_get_chat` — advertises the right one. Falls back to any `*_send`,
 * then to a lone single tool. Returns undefined rather than guessing wrong: the prompt then
 * lists the Paw's tools and lets the agent choose.
 */
export function pickSendTool(id: string, tools: string[]): string | undefined {
	const exact = tools.find((t) => t === `${id}_send`)
	if (exact) return exact
	const suffixed = tools.find((t) => t.endsWith('_send'))
	if (suffixed) return suffixed
	return tools.length === 1 ? tools[0] : undefined
}

/**
 * List every channel this agent can reach a human through: core's built-ins plus loaded,
 * healthy channel Paws.
 *
 * Unhealthy Paws are left out on purpose: a crashed channel is worse than no channel, because
 * the agent would report a message as delivered when nothing was sent.
 */
export function listChannels(paws: PawInstance[], toolRegistry: ToolRegistry): ChannelInfo[] {
	const channels: ChannelInfo[] = []
	for (const builtin of BUILTIN_CHANNELS) {
		// Registered only when its tool is — core skips chat_send when it has no bus to emit on.
		if (toolRegistry.get(builtin.sendTool)) {
			channels.push({ ...builtin, tools: [builtin.sendTool] })
		}
	}
	for (const paw of paws) {
		if (paw.manifest?.category !== 'channel') continue
		if (!paw.healthy) continue
		const id = channelIdFor(paw.name)
		const tools = toolRegistry.toolsForPaw(paw.name)
		channels.push({
			id,
			pawName: paw.name,
			sendTool: pickSendTool(id, tools),
			tools,
			description: paw.manifest?.description ?? '',
		})
	}
	return channels.sort((a, b) => a.id.localeCompare(b.id))
}
