import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager } from '../src/index.js'
import { generateKeyPair } from '../src/keys.js'
import { MAX_RESULTS_PER_PEER, ResultOutbox } from '../src/result-outbox.js'

/**
 * An answer to a peer who has gone.
 *
 * Thinking takes as long as a model takes, and whoever asked from a phone may well have closed
 * it by then. Nobody else holds a copy — the asker has the question, the agent has the only
 * answer — so writing it to a dead socket lost it outright. It waits instead, and goes out the
 * next time that peer says anything.
 */

const A = 19995
const B = 19996

let a: VoleNetManager
let b: VoleNetManager
let rootA: string
let rootB: string
let idA: string

async function until(cond: () => boolean, ms = 20000): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error(`until(): not met within ${ms}ms`)
		await new Promise((r) => setTimeout(r, 150))
	}
}

const configA = () => ({
	enabled: true,
	instanceName: 'pocket',
	role: 'peer' as const,
	port: A,
	hostname: '127.0.0.1',
	peers: [{ url: `http://127.0.0.1:${B}`, trust: 'full' as const }],
})

// biome-ignore lint/suspicious/noExplicitAny: the tests drive the manager's own delivery path
const inner = (m: VoleNetManager) => m as any

describe('ResultOutbox', () => {
	it('keeps one answer per task, bounded per peer, and survives a restart', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-results-'))
		const file = path.join(dir, 'result_outbox.json')
		const box = new ResultOutbox(file)
		await box.load()

		await box.add({
			peerId: 'p1',
			taskId: 't1',
			status: 'completed',
			result: 'first',
			at: Date.now(),
		})
		await box.add({
			peerId: 'p1',
			taskId: 't1',
			status: 'completed',
			result: 'second',
			at: Date.now(),
		})
		expect(box.forPeer('p1')).toHaveLength(1)
		expect(box.forPeer('p1')[0]?.result).toBe('second')

		// Re-read from disk: an answer outlives the process that produced it.
		const reopened = new ResultOutbox(file)
		await reopened.load()
		expect(reopened.forPeer('p1')[0]?.result).toBe('second')
		expect(reopened.has('p1')).toBe(true)
		expect(reopened.has('nobody')).toBe(false)

		// A peer that never comes back cannot grow the file without limit.
		for (let i = 0; i < MAX_RESULTS_PER_PEER + 10; i++) {
			await reopened.add({ peerId: 'p2', taskId: `t${i}`, status: 'completed', at: Date.now() })
		}
		expect(reopened.forPeer('p2')).toHaveLength(MAX_RESULTS_PER_PEER)
		expect(reopened.forPeer('p2').at(-1)?.taskId).toBe(`t${MAX_RESULTS_PER_PEER + 9}`)
	})

	it('drops answers older than the TTL', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-results-ttl-'))
		const box = new ResultOutbox(path.join(dir, 'r.json'), 1000)
		await box.load()
		await box.add({ peerId: 'p', taskId: 'old', status: 'completed', at: Date.now() - 5000 })
		await box.add({ peerId: 'p', taskId: 'new', status: 'completed', at: Date.now() })
		const expired = await box.sweep()
		expect(expired.map((e) => e.taskId)).toEqual(['old'])
		expect(box.forPeer('p').map((e) => e.taskId)).toEqual(['new'])
	})
})

describe('an answer whose asker has gone', () => {
	beforeAll(async () => {
		const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-answer-'))
		rootA = path.join(base, 'a')
		rootB = path.join(base, 'b')
		await fs.mkdir(path.join(rootA, '.openvole/net'), { recursive: true })
		await fs.mkdir(path.join(rootB, '.openvole/net'), { recursive: true })
		const keyA = await generateKeyPair(path.join(rootA, '.openvole/net'), 'pocket')
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

		b = new VoleNetManager(
			{ enabled: true, instanceName: 'agent-b', role: 'peer', port: B, hostname: '127.0.0.1' },
			rootB,
		)
		await b.start()
		a = new VoleNetManager(configA(), rootA)
		await a.start()
		await until(() => b.getInstances().some((i) => i.id === idA))
	}, 40000)

	afterAll(async () => {
		await Promise.all([a?.stop(), b?.stop()])
	})

	it('waits on the agent, then goes out when the asker comes back', async () => {
		// The asker closes the app. Its socket goes with it.
		await a.stop()
		await new Promise((r) => setTimeout(r, 300))

		// The brain finishes after that. There is nowhere to send it.
		const sent = await inner(b).deliverTaskResult(idA, {
			taskId: 'task-1',
			status: 'completed',
			result: 'the weather is fine',
		})
		expect(sent).toBe(false)
		expect(inner(b).resultOutbox.forPeer(idA)).toHaveLength(1)
		expect(inner(b).resultOutbox.forPeer(idA)[0].result).toBe('the weather is fine')

		// It reopens, announces itself, and the answer follows without being asked for.
		a = new VoleNetManager(configA(), rootA)
		await a.start()
		await until(() => inner(b).resultOutbox.forPeer(idA).length === 0, 25000)
	}, 60000)

	it('holds nothing once a peer is there to receive it', async () => {
		await until(() => b.getInstances().some((i) => i.id === idA))
		const sent = await inner(b).deliverTaskResult(idA, {
			taskId: 'task-2',
			status: 'completed',
			result: 'ok',
		})
		expect(sent).toBe(true)
		expect(inner(b).resultOutbox.forPeer(idA)).toHaveLength(0)
	}, 30000)
})
