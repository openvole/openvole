import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '../../src/tool/registry.js'
import { createMessageBus } from '../../src/core/bus.js'
import type { MessageBus } from '../../src/core/bus.js'
import type { ToolDefinition } from '../../src/tool/types.js'

function makeTool(name: string, description = `Tool ${name}`): ToolDefinition {
	return {
		name,
		description,
		parameters: z.object({}),
		execute: vi.fn(async () => ({ ok: true })),
	}
}

describe('ToolRegistry', () => {
	let bus: MessageBus
	let registry: ToolRegistry

	beforeEach(() => {
		bus = createMessageBus()
		registry = new ToolRegistry(bus)
	})

	describe('register', () => {
		it('adds tools', () => {
			registry.register('paw-a', [makeTool('tool-1'), makeTool('tool-2')], true)
			expect(registry.list()).toHaveLength(2)
		})

		it('emits tool:registered events', () => {
			const handler = vi.fn()
			bus.on('tool:registered', handler)
			registry.register('paw-a', [makeTool('tool-1')], true)
			expect(handler).toHaveBeenCalledWith({ toolName: 'tool-1', pawName: 'paw-a' })
		})

		it('auto-prefixes conflicts (same name from different paw)', () => {
			registry.register('paw-a', [makeTool('shared-tool')], true)
			registry.register('paw-b', [makeTool('shared-tool')], true)

			expect(registry.list()).toHaveLength(2)
			expect(registry.get('shared-tool')!.pawName).toBe('paw-a')
			expect(registry.get('paw_b_shared-tool')!.pawName).toBe('paw-b')
		})
	})

	describe('get', () => {
		it('returns a tool by name', () => {
			registry.register('paw-a', [makeTool('my-tool', 'My tool desc')], true)
			const tool = registry.get('my-tool')
			expect(tool).toBeDefined()
			expect(tool!.name).toBe('my-tool')
			expect(tool!.description).toBe('My tool desc')
			expect(tool!.pawName).toBe('paw-a')
		})

		it('returns undefined for unknown tool', () => {
			expect(registry.get('nonexistent')).toBeUndefined()
		})
	})

	describe('has', () => {
		it('returns true for existing tool', () => {
			registry.register('paw-a', [makeTool('exists')], true)
			expect(registry.has('exists')).toBe(true)
		})

		it('returns false for missing tool', () => {
			expect(registry.has('missing')).toBe(false)
		})
	})

	describe('list', () => {
		it('returns all tools', () => {
			registry.register('paw-a', [makeTool('t1'), makeTool('t2')], true)
			registry.register('paw-b', [makeTool('t3')], false)
			const list = registry.list()
			expect(list).toHaveLength(3)
		})
	})

	describe('summaries', () => {
		it('returns name, description, pawName, and parameters', () => {
			registry.register('paw-a', [makeTool('tool-1', 'Desc 1')], true)
			const summaries = registry.summaries()
			expect(summaries).toHaveLength(1)
			expect(summaries[0].name).toBe('tool-1')
			expect(summaries[0].description).toBe('Desc 1')
			expect(summaries[0].pawName).toBe('paw-a')
			expect(summaries[0]).toHaveProperty('parameters')
		})
	})

	describe('unregister', () => {
		it('removes all tools from a paw', () => {
			registry.register('paw-a', [makeTool('t1'), makeTool('t2')], true)
			registry.register('paw-b', [makeTool('t3')], true)

			registry.unregister('paw-a')
			expect(registry.list()).toHaveLength(1)
			expect(registry.has('t1')).toBe(false)
			expect(registry.has('t2')).toBe(false)
			expect(registry.has('t3')).toBe(true)
		})

		it('emits tool:unregistered events', () => {
			const handler = vi.fn()
			bus.on('tool:unregistered', handler)
			registry.register('paw-a', [makeTool('t1')], true)
			registry.unregister('paw-a')
			expect(handler).toHaveBeenCalledWith({ toolName: 't1', pawName: 'paw-a' })
		})
	})

	describe('toolsForPaw', () => {
		it('returns tool names for a paw', () => {
			registry.register('paw-a', [makeTool('t1'), makeTool('t2')], true)
			registry.register('paw-b', [makeTool('t3')], true)

			expect(registry.toolsForPaw('paw-a')).toEqual(['t1', 't2'])
			expect(registry.toolsForPaw('paw-b')).toEqual(['t3'])
		})

		it('returns empty array for unknown paw', () => {
			expect(registry.toolsForPaw('unknown')).toEqual([])
		})
	})

	describe('clear', () => {
		it('removes everything', () => {
			registry.register('paw-a', [makeTool('t1'), makeTool('t2')], true)
			registry.clear()
			expect(registry.list()).toHaveLength(0)
		})
	})
})
