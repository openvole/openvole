import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { VoleNetManager, createMessage, generateKeyPair } from '@openvole/volenet'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { replyAddressFor } from '../../src/core/reply-address.js'

/**
 * Where a peer's brain question is answered, and who the answer is addressed to.
 *
 * A `task:delegate` carrying a `fromName` is chat: the peer is talking to the agent. It used to
 * be enqueued with no `sessionId`, so `replyAddressFor` fell through every rule to `dashboard` —
 * the agent was told its report went to its human, wrote a status update *about* the peer, and
 * that text was what the peer received ("The reply to tlepsh timed out…"). It also meant no
 * history: each question was answered cold, and nothing was transcribed.
 *
 * A conversation gets a session. A one-shot task does not.
 */

const A = 19987
const B = 19988

let a: VoleNetManager
let b: VoleNetManager
let idA: string
let keyA: Awaited<ReturnType<typeof generateKeyPair>>

interface FakeTask {
	id: string
	input: string
	source: string
	sessionId?: string
	metadata?: Record<string, unknown>
	status: string
	result?: string
}

const enqueued: FakeTask[] = []

async function until(cond: () => boolean, ms = 20000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error(`until(): not met within ${ms}ms`)
		await new Promise((r) => setTimeout(r, 100))
	}
}

// biome-ignore lint/suspicious/noExplicitAny: the delegate handler reads its queue off globalThis
const g = globalThis as any

async function ask(payload: Record<string, unknown>): Promise<void> {
	const msg = createMessage(
		'task:delegate',
		idA,
		// biome-ignore lint/suspicious/noExplicitAny: test reaches the manager's own identity
		(b as any).keyPair.instanceId,
		payload,
		keyA.privateKey,
		keyA.pqPrivateKey,
	)
	// biome-ignore lint/suspicious/noExplicitAny: sending as the peer would, over its own socket
	await (a as any).transport.sendToPeer((b as any).keyPair.instanceId, msg)
}

beforeAll(async () => {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-delegate-'))
	const rootA = path.join(base, 'a')
	const rootB = path.join(base, 'b')
	await fs.mkdir(path.join(rootA, '.openvole/net'), { recursive: true })
	await fs.mkdir(path.join(rootB, '.openvole/net'), { recursive: true })
	keyA = await generateKeyPair(path.join(rootA, '.openvole/net'), 'pocket')
	const keyB = await generateKeyPair(path.join(rootB, '.openvole/net'), 'agent-b')
	idA = keyA.instanceId
	await fs.writeFile(
		path.join(rootA, '.openvole/net/authorized_voles'),
		`${keyB.publicKeyString}\n`,
	)
	await fs.writeFile(
		path.join(rootB, '.openvole/net/authorized_voles'),
		`${keyA.publicKeyString}\n`,
	)

	g.__volenet_taskqueue__ = {
		enqueue(input: string, source: string, options?: Record<string, unknown>) {
			const task: FakeTask = {
				id: `local-${enqueued.length}`,
				input,
				source,
				sessionId: options?.sessionId as string | undefined,
				metadata: options?.metadata as Record<string, unknown> | undefined,
				status: 'completed',
				result: 'answered',
			}
			enqueued.push(task)
			return task
		},
		get: (id: string) => enqueued.find((t) => t.id === id),
	}

	b = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'agent-b',
			role: 'peer',
			port: B,
			hostname: '127.0.0.1',
			// Named by identity, since a phone has no address to match on.
			peers: [{ id: idA, trust: 'read', allowBrain: true }],
		},
		rootB,
	)
	await b.start()
	a = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'pocket',
			role: 'peer',
			port: A,
			hostname: '127.0.0.1',
			peers: [{ url: `http://127.0.0.1:${B}`, trust: 'full' }],
		},
		rootA,
	)
	await a.start()
	await until(() => b.getInstances().some((i) => i.id === idA))
}, 40000)

afterAll(async () => {
	g.__volenet_taskqueue__ = undefined
	await Promise.all([a?.stop(), b?.stop()])
})

describe('a peer message delegated to the brain', () => {
	it('is a turn in that peer’s conversation, and answers the peer', async () => {
		await ask({ taskId: 'q-1', input: 'hey there', fromName: 'tlepsh' })
		await until(() => enqueued.length > 0)
		const task = enqueued[0]

		expect(task?.source).toBe(`net:${idA.substring(0, 8)}`)
		expect(task?.sessionId).toBe(`net:${idA.substring(0, 8)}`)
		expect(task?.input).toContain('[Message from peer agent "tlepsh"]')
		expect(task?.metadata?.remoteTaskId).toBe('q-1')

		// The whole point: the report goes to the peer's thread, never to the dashboard chat.
		expect(replyAddressFor(task)).toBe(`net:${idA.substring(0, 8)}`)
		expect(replyAddressFor(task)).not.toBe('dashboard')
	}, 30000)

	it('leaves a one-shot task without a conversation', async () => {
		const before = enqueued.length
		await ask({ taskId: 'q-2', input: 'run this once' })
		await until(() => enqueued.length > before)
		const task = enqueued[before]

		expect(task?.source).toBe('agent')
		expect(task?.sessionId).toBeUndefined()
		expect(replyAddressFor(task)).toBe('dashboard')
	}, 30000)
})
