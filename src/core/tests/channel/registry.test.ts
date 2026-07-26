import { describe, expect, it } from 'vitest'
import { channelIdFor, listChannels, pickSendTool } from '../../src/channel/registry.js'
import { createMessageBus } from '../../src/core/bus.js'
import type { PawInstance } from '../../src/paw/types.js'
import { ToolRegistry } from '../../src/tool/registry.js'

/**
 * Channels are derived, not configured: a Paw declaring `category: "channel"` in its manifest
 * IS a channel, and its `<id>_send` tool is how the agent reaches its human. These tests pin
 * that derivation, because everything downstream (the prompt section, tool-horizon visibility,
 * the headless skip) reads from it.
 */

function paw(name: string, category: string, healthy = true, description = ''): PawInstance {
	return {
		name,
		healthy,
		manifest: { name, category, description },
	} as unknown as PawInstance
}

function registryWith(tools: Array<[string, string]>): ToolRegistry {
	const reg = new ToolRegistry(createMessageBus())
	const byPaw = new Map<string, string[]>()
	for (const [pawName, toolName] of tools) {
		byPaw.set(pawName, [...(byPaw.get(pawName) ?? []), toolName])
	}
	for (const [pawName, names] of byPaw) {
		reg.register(
			pawName,
			names.map((n) => ({
				name: n,
				description: `${n} description`,
				parameters: undefined as never,
				execute: async () => ({}),
			})),
			false,
		)
	}
	return reg
}

describe('channel id derivation', () => {
	it('strips the scope and the paw- prefix', () => {
		expect(channelIdFor('@openvole/paw-telegram')).toBe('telegram')
		expect(channelIdFor('@openvole/paw-chat')).toBe('chat')
		expect(channelIdFor('paw-slack')).toBe('slack')
		expect(channelIdFor('@acme/paw-My-Channel')).toBe('my-channel')
	})
})

describe('send tool selection', () => {
	it('prefers the <id>_send convention over other tools of the same paw', () => {
		expect(pickSendTool('telegram', ['telegram_get_chat', 'telegram_reply', 'telegram_send'])).toBe(
			'telegram_send',
		)
	})

	it('falls back to any *_send tool', () => {
		expect(pickSendTool('voice-call', ['initiate_call', 'message_send'])).toBe('message_send')
	})

	it('uses a lone tool as the send tool', () => {
		expect(pickSendTool('chat', ['chat_post'])).toBe('chat_post')
	})

	it('returns undefined rather than guessing between several non-send tools', () => {
		expect(pickSendTool('voice-call', ['initiate_call', 'end_call', 'list_calls'])).toBeUndefined()
	})
})

describe('listChannels', () => {
	it('lists channel-category paws with their send tool, sorted by id', () => {
		const tools = registryWith([
			['@openvole/paw-telegram', 'telegram_send'],
			['@openvole/paw-telegram', 'telegram_reply'],
			['@openvole/paw-slack', 'slack_send'],
			['@openvole/paw-shell', 'shell_exec'],
		])
		const channels = listChannels(
			[
				paw('@openvole/paw-telegram', 'channel', true, 'Telegram messaging'),
				paw('@openvole/paw-slack', 'channel', true, 'Slack messaging'),
				paw('@openvole/paw-shell', 'tool'),
				paw('@openvole/paw-brain', 'brain'),
				paw('@openvole/paw-memory', 'infrastructure'),
			],
			tools,
		)
		expect(channels.map((c) => c.id)).toEqual(['slack', 'telegram'])
		expect(channels[1]).toMatchObject({
			id: 'telegram',
			pawName: '@openvole/paw-telegram',
			sendTool: 'telegram_send',
			description: 'Telegram messaging',
		})
		expect(channels[1].tools.sort()).toEqual(['telegram_reply', 'telegram_send'])
	})

	it('includes the built-in dashboard chat when core registered chat_send', () => {
		// The chat is core's own surface, so it is a channel without a Paw behind it — but it
		// appears in the same list, with the same shape, as a paw-provided channel.
		const tools = registryWith([
			['__core__', 'chat_send'],
			['@openvole/paw-telegram', 'telegram_send'],
		])
		const channels = listChannels([paw('@openvole/paw-telegram', 'channel')], tools)
		expect(channels.map((c) => c.id)).toEqual(['chat', 'telegram'])
		expect(channels[0]).toMatchObject({
			id: 'chat',
			pawName: '__core__',
			sendTool: 'chat_send',
			tools: ['chat_send'],
		})
	})

	it('omits the built-in chat when chat_send is not registered', () => {
		// createCoreTools skips chat_send without a bus to emit on — advertising a channel whose
		// tool does not exist would have the agent call something that isn't there.
		const tools = registryWith([['@openvole/paw-telegram', 'telegram_send']])
		const channels = listChannels([paw('@openvole/paw-telegram', 'channel')], tools)
		expect(channels.map((c) => c.id)).toEqual(['telegram'])
	})

	it('omits a crashed channel — reporting a message as sent through a dead paw is worse than having no channel', () => {
		const tools = registryWith([['@openvole/paw-telegram', 'telegram_send']])
		const channels = listChannels([paw('@openvole/paw-telegram', 'channel', false)], tools)
		expect(channels).toEqual([])
	})

	it('returns nothing when there is no channel at all', () => {
		const tools = registryWith([['@openvole/paw-shell', 'shell_exec']])
		expect(listChannels([paw('@openvole/paw-shell', 'tool')], tools)).toEqual([])
	})
})
