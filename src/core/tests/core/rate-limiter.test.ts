import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter } from '../../src/core/rate-limiter.js'

describe('RateLimiter', () => {
	let limiter: RateLimiter

	beforeEach(() => {
		limiter = new RateLimiter()
	})

	describe('tryConsume', () => {
		it('returns true when under limit', () => {
			expect(limiter.tryConsume('api', 5, 60_000)).toBe(true)
		})

		it('returns true up to the limit', () => {
			for (let i = 0; i < 3; i++) {
				expect(limiter.tryConsume('api', 3, 60_000)).toBe(true)
			}
		})

		it('returns false when limit is reached', () => {
			for (let i = 0; i < 5; i++) {
				limiter.tryConsume('api', 5, 60_000)
			}
			expect(limiter.tryConsume('api', 5, 60_000)).toBe(false)
		})

		it('cleans up expired timestamps (sliding window)', () => {
			const now = Date.now()
			vi.spyOn(Date, 'now').mockReturnValue(now)

			// Fill the bucket
			for (let i = 0; i < 3; i++) {
				limiter.tryConsume('api', 3, 1000)
			}
			expect(limiter.tryConsume('api', 3, 1000)).toBe(false)

			// Advance time past the window
			vi.spyOn(Date, 'now').mockReturnValue(now + 1500)

			// Should be allowed again — old timestamps expired
			expect(limiter.tryConsume('api', 3, 1000)).toBe(true)

			vi.restoreAllMocks()
		})
	})

	describe('remaining', () => {
		it('returns the full limit when bucket is empty', () => {
			expect(limiter.remaining('api', 10, 60_000)).toBe(10)
		})

		it('returns correct count after consuming', () => {
			limiter.tryConsume('api', 10, 60_000)
			limiter.tryConsume('api', 10, 60_000)
			expect(limiter.remaining('api', 10, 60_000)).toBe(8)
		})

		it('returns 0 when limit is reached', () => {
			for (let i = 0; i < 5; i++) {
				limiter.tryConsume('api', 5, 60_000)
			}
			expect(limiter.remaining('api', 5, 60_000)).toBe(0)
		})
	})

	describe('multiple buckets', () => {
		it('buckets are independent', () => {
			// Fill bucket A
			for (let i = 0; i < 2; i++) {
				limiter.tryConsume('a', 2, 60_000)
			}
			expect(limiter.tryConsume('a', 2, 60_000)).toBe(false)

			// Bucket B should still be available
			expect(limiter.tryConsume('b', 2, 60_000)).toBe(true)
			expect(limiter.remaining('b', 2, 60_000)).toBe(1)
		})
	})
})
