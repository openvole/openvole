import * as fs from 'node:fs'
import * as path from 'node:path'

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 } as const
type Level = keyof typeof LEVELS

let logStream: fs.WriteStream | undefined
let silentMode = true

/** Suppress console output — logs still go to file */
export function setLoggerSilent(silent: boolean): void {
	silentMode = silent
}

/** Initialize file logging from VOLE_LOG_FILE env var */
function getLogStream(): fs.WriteStream | undefined {
	if (logStream) return logStream
	const logFile = process.env.VOLE_LOG_FILE
	if (!logFile) return undefined
	const dir = path.dirname(logFile)
	fs.mkdirSync(dir, { recursive: true })
	logStream = fs.createWriteStream(logFile, { flags: 'a' })
	return logStream
}

/** Close the log file stream (called on shutdown) */
export function closeLogger(): void {
	logStream?.end()
	logStream = undefined
}

function currentLevel(): number {
	const level = (process.env.VOLE_LOG_LEVEL ?? 'info').toLowerCase() as Level
	return LEVELS[level] ?? LEVELS.info
}

function writeToFile(level: string, prefix: string, msg: string, args: unknown[]): void {
	const stream = getLogStream()
	if (!stream) return
	// Respect VOLE_LOG_LEVEL for file logging too
	const levelNum = LEVELS[level.toLowerCase() as Level] ?? LEVELS.info
	if (levelNum > currentLevel()) return
	const timestamp = new Date().toISOString()
	const argsStr = args.length > 0 ? ' ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') : ''
	stream.write(`${timestamp} [${level.toUpperCase()}] ${prefix} ${msg}${argsStr}\n`)
}

export function createLogger(tag: string) {
	const prefix = `[${tag}]`
	return {
		error: (msg: string, ...args: unknown[]) => {
			if (!silentMode && currentLevel() >= LEVELS.error) console.error(prefix, msg, ...args)
			writeToFile('error', prefix, msg, args)
		},
		warn: (msg: string, ...args: unknown[]) => {
			if (!silentMode && currentLevel() >= LEVELS.warn) console.warn(prefix, msg, ...args)
			writeToFile('warn', prefix, msg, args)
		},
		info: (msg: string, ...args: unknown[]) => {
			if (!silentMode && currentLevel() >= LEVELS.info) console.info(prefix, msg, ...args)
			writeToFile('info', prefix, msg, args)
		},
		debug: (msg: string, ...args: unknown[]) => {
			if (!silentMode && currentLevel() >= LEVELS.debug) console.debug(prefix, msg, ...args)
			writeToFile('debug', prefix, msg, args)
		},
		trace: (msg: string, ...args: unknown[]) => {
			if (!silentMode && currentLevel() >= LEVELS.trace) console.debug(prefix, msg, ...args)
			writeToFile('trace', prefix, msg, args)
		},
	}
}
