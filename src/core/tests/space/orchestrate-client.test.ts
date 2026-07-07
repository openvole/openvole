import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type IpcChannel, createParentClient } from '../../src/space/orchestrate-client.js'

/** Fake IPC channel standing in for `process` (send + connected + message/disconnect). */
function fakeChannel(): IpcChannel & EventEmitter & { send: ReturnType<typeof vi.fn> } {
	const em = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> } & {
		connected: boolean
	}
	em.send = vi.fn()
	em.connected = true
	return em as never
}

describe('createParentClient', () => {
	let channel: ReturnType<typeof fakeChannel>

	beforeEach(() => {
		channel = fakeChannel()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('sends a creq envelope with incrementing ids', async () => {
		const client = createParentClient(channel)
		const p1 = client.call('list')
		const p2 = client.call('state', { target: 'worker' })
		expect(channel.send).toHaveBeenNthCalledWith(1, { creq: { id: 1, method: 'list', params: {} } })
		expect(channel.send).toHaveBeenNthCalledWith(2, {
			creq: { id: 2, method: 'state', params: { target: 'worker' } },
		})
		channel.emit('message', { cres: { id: 1, result: [] } })
		channel.emit('message', { cres: { id: 2, result: { ok: true } } })
		await expect(p1).resolves.toEqual([])
		await expect(p2).resolves.toEqual({ ok: true })
	})

	it('rejects with the parent-reported error message', async () => {
		const client = createParentClient(channel)
		const p = client.call('stop', { target: 'boss' })
		channel.emit('message', { cres: { id: 1, error: 'Refusing to stop the orchestrator itself' } })
		await expect(p).rejects.toThrow('Refusing to stop the orchestrator itself')
	})

	it('ignores non-cres messages and unknown ids', async () => {
		const client = createParentClient(channel)
		const p = client.call('list')
		channel.emit('message', { id: 7, method: 'state', params: {} }) // parent request — not ours
		channel.emit('message', { cres: { id: 999, result: 'stray' } })
		channel.emit('message', 'garbage')
		channel.emit('message', { cres: { id: 1, result: 'mine' } })
		await expect(p).resolves.toBe('mine')
	})

	it('times out with a method-labelled error', async () => {
		vi.useFakeTimers()
		const client = createParentClient(channel)
		const p = client.call('submit', { target: 'w', input: 'x' })
		const expectation = expect(p).rejects.toThrow('Control-plane request timed out: submit')
		vi.advanceTimersByTime(20_001)
		await expectation
	})

	it('rejects all pending calls when the parent disconnects', async () => {
		const client = createParentClient(channel)
		const p1 = client.call('list')
		const p2 = client.call('state', { target: 'worker' })
		channel.emit('disconnect')
		await expect(p1).rejects.toThrow('Control plane disconnected')
		await expect(p2).rejects.toThrow('Control plane disconnected')
	})

	it('fails fast when there is no IPC channel', async () => {
		channel.connected = false
		const client = createParentClient(channel)
		await expect(client.call('list')).rejects.toThrow('Not running under vole serve')
		expect(channel.send).not.toHaveBeenCalled()
	})
})
