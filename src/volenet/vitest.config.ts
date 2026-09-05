import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		testTimeout: 40000,
		hookTimeout: 60000,
	},
})
