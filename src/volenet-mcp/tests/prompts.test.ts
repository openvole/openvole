import { describe, expect, it } from 'vitest'
import { PROMPTS } from '../src/prompts.js'
import { TOOLS } from '../src/tools.js'

/**
 * Prompts exist so a fresh session does not have to infer the order of things from a tool list.
 * That only holds if they name tools that exist and keep saying the things that are easy to get
 * wrong — which is what these check.
 */
describe('prompts', () => {
	it('offers a flow for each thing a new session has to do', () => {
		expect(PROMPTS.map((p) => p.name).sort()).toEqual(['catch-up', 'pair', 'reach', 'setup'])
		for (const p of PROMPTS) expect(p.description.length).toBeGreaterThan(20)
	})

	it('only ever names tools this server actually has', () => {
		const names = new Set(TOOLS.map((t) => t.name))
		for (const p of PROMPTS) {
			const rendered = p.render({ url: 'http://example', peer: 'x', message: 'y' })
			for (const [, tool] of rendered.matchAll(/`(volenet_[a-z_]+)`/g)) {
				expect(names, `${p.name} names ${tool}`).toContain(tool)
			}
		}
	})

	it('fills its arguments in, and stays readable without them', () => {
		const pair = PROMPTS.find((p) => p.name === 'pair')!
		expect(pair.arguments?.[0]).toMatchObject({ name: 'url', required: true })
		expect(pair.render({ url: 'http://10.0.0.5:9700' })).toContain('http://10.0.0.5:9700')
		expect(pair.render({})).toContain('<url>')
	})

	it('keeps the two things a session most often gets wrong', () => {
		const pair = PROMPTS.find((p) => p.name === 'pair')!.render({ url: 'u' })
		// The fingerprint step exists so a human compares two values; confirming for them voids it.
		expect(pair).toContain('Wait for them')
		expect(pair).toMatch(/do not confirm on their behalf/i)
		// Being trusted is not being allowed — the distinction that confuses people twice over,
		// and the ask has to travel with the request or the operator cannot settle both at once.
		expect(pair).toMatch(/trusted is not the same as being allowed/i)
		expect(pair).toContain('brain: true')

		const setup = PROMPTS.find((p) => p.name === 'setup')!.render({})
		expect(setup).toMatch(/not.*relay a question to an agent's brain/i)
	})
})
