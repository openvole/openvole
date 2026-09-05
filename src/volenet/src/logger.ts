/**
 * Logging, without a dependency on whoever is hosting this.
 *
 * The protocol used to borrow the agent framework's logger, which is one of the three threads
 * that tied it to the framework. It keeps the same behaviour on its own — silent on the console,
 * written to VOLE_LOG_FILE when that is set — so an agent's logs look exactly as before, and a
 * host that already has a logger can inject it and get a single stream rather than two.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface Logger {
	error: (msg: string, ...args: unknown[]) => void
	warn: (msg: string, ...args: unknown[]) => void
	info: (msg: string, ...args: unknown[]) => void
	debug: (msg: string, ...args: unknown[]) => void
	trace: (msg: string, ...args: unknown[]) => void
}

export type LoggerFactory = (tag: string) => Logger

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 } as const
type Level = keyof typeof LEVELS

let stream: fs.WriteStream | undefined
let factory: LoggerFactory | undefined
/** Loggers already handed out, so injecting a factory late still redirects them. */
const issued = new Map<string, { tag: string; current: Logger }>()

function currentLevel(): number {
	const level = (process.env.VOLE_LOG_LEVEL ?? 'info').toLowerCase() as Level
	return LEVELS[level] ?? LEVELS.info
}

function fileStream(): fs.WriteStream | undefined {
	if (stream) return stream
	const file = process.env.VOLE_LOG_FILE
	if (!file) return undefined
	fs.mkdirSync(path.dirname(file), { recursive: true })
	stream = fs.createWriteStream(file, { flags: 'a' })
	return stream
}

function write(level: Level, prefix: string, msg: string, args: unknown[]): void {
	const out = fileStream()
	if (!out || LEVELS[level] > currentLevel()) return
	const extra = args.length
		? ` ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`
		: ''
	out.write(`${new Date().toISOString()} [${level.toUpperCase()}] ${prefix} ${msg}${extra}\n`)
}

function fileLogger(tag: string): Logger {
	const prefix = `[${tag}]`
	const at =
		(level: Level) =>
		(msg: string, ...args: unknown[]) =>
			write(level, prefix, msg, args)
	return {
		error: at('error'),
		warn: at('warn'),
		info: at('info'),
		debug: at('debug'),
		trace: at('trace'),
	}
}

/**
 * Hand this library the host's logger. Loggers created before this call are redirected too, so a
 * host can inject at startup without caring which modules have already been imported.
 */
export function setLoggerFactory(make: LoggerFactory): void {
	factory = make
	for (const entry of issued.values()) entry.current = make(entry.tag)
}

export function createLogger(tag: string): Logger {
	const entry = { tag, current: factory ? factory(tag) : fileLogger(tag) }
	issued.set(tag, entry)
	// Indirect on every call so a factory injected later takes effect for this logger as well.
	const at =
		(level: keyof Logger) =>
		(msg: string, ...args: unknown[]) =>
			entry.current[level](msg, ...args)
	return {
		error: at('error'),
		warn: at('warn'),
		info: at('info'),
		debug: at('debug'),
		trace: at('trace'),
	}
}

/** Close the log file this library opened. A host that injected its own logger owns its stream. */
export function closeLogger(): void {
	stream?.end()
	stream = undefined
}
