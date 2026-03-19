const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 } as const
type Level = keyof typeof LEVELS

function currentLevel(): number {
	const env = (process.env.VOLE_LOG_LEVEL ?? 'info').toLowerCase() as Level
	return LEVELS[env] ?? LEVELS.info
}

export function createLogger(tag: string) {
	const prefix = `[${tag}]`
	return {
		error: (msg: string, ...args: unknown[]) =>
			currentLevel() >= LEVELS.error && console.error(prefix, msg, ...args),
		warn: (msg: string, ...args: unknown[]) =>
			currentLevel() >= LEVELS.warn && console.warn(prefix, msg, ...args),
		info: (msg: string, ...args: unknown[]) =>
			currentLevel() >= LEVELS.info && console.info(prefix, msg, ...args),
		debug: (msg: string, ...args: unknown[]) =>
			currentLevel() >= LEVELS.debug && console.debug(prefix, msg, ...args),
		trace: (msg: string, ...args: unknown[]) =>
			currentLevel() >= LEVELS.trace && console.debug(prefix, msg, ...args),
	}
}
