import { createLogger } from './logger.js'

const logger = createLogger('rate-limiter')

/**
 * Sliding window counter rate limiter.
 * Tracks timestamps per bucket and checks against limits.
 */
export class RateLimiter {
	private buckets = new Map<string, number[]>()

	/**
	 * Try to consume one token from the bucket.
	 * Returns true if the request is under the limit, false if rate-limited.
	 */
	tryConsume(bucket: string, limit: number, windowMs: number): boolean {
		const now = Date.now()
		this.cleanup(bucket, now, windowMs)

		const timestamps = this.buckets.get(bucket) ?? []
		if (timestamps.length >= limit) {
			logger.debug(`Bucket "${bucket}" rate-limited: ${timestamps.length}/${limit} in ${windowMs}ms window`)
			return false
		}

		timestamps.push(now)
		this.buckets.set(bucket, timestamps)
		return true
	}

	/**
	 * Returns the number of remaining tokens in the bucket for the current window.
	 */
	remaining(bucket: string, limit: number, windowMs: number): number {
		const now = Date.now()
		this.cleanup(bucket, now, windowMs)

		const timestamps = this.buckets.get(bucket) ?? []
		return Math.max(0, limit - timestamps.length)
	}

	/**
	 * Remove expired timestamps from a bucket.
	 */
	private cleanup(bucket: string, now: number, windowMs: number): void {
		const timestamps = this.buckets.get(bucket)
		if (!timestamps) return

		const cutoff = now - windowMs
		const filtered = timestamps.filter((t) => t > cutoff)

		if (filtered.length === 0) {
			this.buckets.delete(bucket)
		} else {
			this.buckets.set(bucket, filtered)
		}
	}
}
