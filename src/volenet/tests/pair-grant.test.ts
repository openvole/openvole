import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VoleNetManager, generateKeyPair } from '../src/index.js'

/**
 * Asking for what you need, and being granted it in the same act.
 *
 * Trust and permission live in different places — the keystore says who may connect, `net.peers`
 * says what they may do — so accepting a pair request used to leave the peer trusted and useless
 * until somebody hand-edited a config file and restarted the agent. A requester can now say what
 * it is for, and the operator settles both at once.
 */

const A = 19975 // the asker, with no address of its own
const B = 19976 // the agent deciding

let asker: VoleNetManager
let agent: VoleNetManager
let askerId: string
let written: Array<Record<string, unknown>>

const until = async (cond: () => boolean, ms = 15000) => {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error('timed out')
		await new Promise((r) => setTimeout(r, 100))
	}
}

beforeAll(async () => {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-grant-'))
	const rootA = path.join(base, 'a')
	const rootB = path.join(base, 'b')
	await fs.mkdir(path.join(rootA, '.openvole/net'), { recursive: true })
	await fs.mkdir(path.join(rootB, '.openvole/net'), { recursive: true })
	askerId = (await generateKeyPair(path.join(rootA, '.openvole/net'), 'pocket')).instanceId
	await generateKeyPair(path.join(rootB, '.openvole/net'), 'agent-b')

	written = []
	asker = new VoleNetManager(
		{ enabled: true, instanceName: 'pocket', role: 'peer', port: A, hostname: '127.0.0.1' },
		rootA,
	)
	agent = new VoleNetManager(
		{
			enabled: true,
			instanceName: 'agent-b',
			role: 'peer',
			port: B,
			hostname: '127.0.0.1',
			// The host's job: this stands in for writing vole.config.json.
			persistPeerEntry: async (entry) => {
				written.push(entry as Record<string, unknown>)
			},
		},
		rootB,
	)
	await agent.start()
	await asker.start()
}, 40000)

afterAll(async () => {
	await Promise.all([asker?.stop(), agent?.stop()])
})

describe('a pair request that says what it is for', () => {
	it('carries the ask, and the operator sees it before deciding', async () => {
		const probe = await asker.probePair(`http://127.0.0.1:${B}`)
		expect(probe.ok).toBe(true)
		await asker.initiatePair(`http://127.0.0.1:${B}`, probe.publicKey as string, 'my phone', [
			'brain',
		])
		await until(() => agent.listPairRequests().length > 0)

		const req = agent.listPairRequests()[0]
		expect(req?.name).toBe('pocket')
		expect(req?.note).toBe('my phone')
		expect(req?.wants).toEqual(['brain'])
	}, 30000)

	it('grants what was asked, live and without a restart', async () => {
		expect(agent.getPeerTrust(askerId)).toBeNull() // nothing yet

		const acc = await agent.acceptPair('pocket', { trust: 'read', allowBrain: true })
		expect(acc.ok).toBe(true)
		expect(acc.granted).toEqual({ trust: 'read', allowBrain: true })

		// Applied immediately — the live config is what matchPeerConfig reads.
		await until(() => agent.getInstances().some((i) => i.id === askerId))
		expect(agent.getPeerTrust(askerId)).toMatchObject({ trust: 'read', allowBrain: true })
		expect(agent.isPeerAllowedBrain(askerId)).toBe(true)

		// And handed to the host to write down, named by identity since there is no address.
		expect(written).toEqual([{ id: askerId, name: 'pocket', trust: 'read', allowBrain: true }])
	}, 30000)

	it('refuses to store an ask it does not understand', async () => {
		const res = await agent.handlePairRequest(
			{
				publicKey: (await asker.probePair(`http://127.0.0.1:${A}`)).publicKey,
				name: 'x',
				wants: ['brain', 'root', 42],
			},
			'127.0.0.1',
		)
		expect(res.status).toBe(200)
		// Only the ask this node names is kept: an unknown one cannot ride along unseen.
		const req = agent.listPairRequests().find((r) => r.name === 'x')
		if (req) expect(req.wants).toEqual(['brain'])
	}, 30000)
})
