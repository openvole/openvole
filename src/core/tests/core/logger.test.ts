import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger } from '../../src/core/logger.js'

describe('createLogger', () => {
	const originalEnv = process.env.VOLE_LOG_LEVEL

	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		vi.spyOn(console, 'info').mockImplementation(() => {})
		vi.spyOn(console, 'debug').mockImplementation(() => {})
	})

	afterEach(() => {
		process.env.VOLE_LOG_LEVEL = originalEnv
		vi.restoreAllMocks()
	})

	it('returns logger with all methods', () => {
		const logger = createLogger('test')
		expect(logger.error).toBeTypeOf('function')
		expect(logger.warn).toBeTypeOf('function')
		expect(logger.info).toBeTypeOf('function')
		expect(logger.debug).toBeTypeOf('function')
		expect(logger.trace).toBeTypeOf('function')
	})

	it('logs at the default info level', () => {
		delete process.env.VOLE_LOG_LEVEL
		const logger = createLogger('test')

		logger.error('err')
		logger.warn('wrn')
		logger.info('inf')

		expect(console.error).toHaveBeenCalledWith('[test]', 'err')
		expect(console.warn).toHaveBeenCalledWith('[test]', 'wrn')
		expect(console.info).toHaveBeenCalledWith('[test]', 'inf')
	})

	it('does not log debug at info level', () => {
		process.env.VOLE_LOG_LEVEL = 'info'
		const logger = createLogger('test')

		logger.debug('should not appear')
		expect(console.debug).not.toHaveBeenCalled()
	})

	it('logs debug at debug level', () => {
		process.env.VOLE_LOG_LEVEL = 'debug'
		const logger = createLogger('test')

		logger.debug('visible')
		expect(console.debug).toHaveBeenCalledWith('[test]', 'visible')
	})

	it('only logs error at error level', () => {
		process.env.VOLE_LOG_LEVEL = 'error'
		const logger = createLogger('test')

		logger.error('visible')
		logger.warn('hidden')
		logger.info('hidden')
		logger.debug('hidden')

		expect(console.error).toHaveBeenCalledOnce()
		expect(console.warn).not.toHaveBeenCalled()
		expect(console.info).not.toHaveBeenCalled()
		expect(console.debug).not.toHaveBeenCalled()
	})
})
