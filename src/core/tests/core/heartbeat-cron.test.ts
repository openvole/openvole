import { Cron } from 'croner'
import { describe, expect, it } from 'vitest'
import { heartbeatCronFor } from '../../src/index.js'

describe('heartbeatCronFor', () => {
	it('sub-hour intervals step the minutes field', () => {
		expect(heartbeatCronFor(1)).toBe('*/1 * * * *')
		expect(heartbeatCronFor(30)).toBe('*/30 * * * *')
		expect(heartbeatCronFor(59)).toBe('*/59 * * * *')
	})

	it('hourly and multi-hour intervals step the HOURS field (minutes max out at 59)', () => {
		expect(heartbeatCronFor(60)).toBe('0 */1 * * *')
		expect(heartbeatCronFor(180)).toBe('0 */3 * * *')
		expect(heartbeatCronFor(720)).toBe('0 */12 * * *')
	})

	it('a day or longer runs once daily (cron cannot express "every n days")', () => {
		expect(heartbeatCronFor(1440)).toBe('0 0 * * *')
		expect(heartbeatCronFor(10080)).toBe('0 0 * * *')
	})

	it('guards nonsense input', () => {
		expect(heartbeatCronFor(0)).toBe('*/1 * * * *')
		expect(heartbeatCronFor(-5)).toBe('*/1 * * * *')
	})

	it('every generated pattern actually parses — this is the bug that killed the engine', () => {
		for (const m of [1, 5, 30, 59, 60, 90, 120, 720, 1440, 2880, 10080]) {
			expect(() => new Cron(heartbeatCronFor(m))).not.toThrow()
		}
		// proof of the original defect:
		expect(() => new Cron('*/1440 * * * *')).toThrow()
	})
})
