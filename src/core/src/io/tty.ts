import * as readline from 'node:readline'
import type { VoleIO } from './types.js'

let notifySuppressed = false

/** Suppress notify output (during startup) */
export function setNotifySuppressed(suppressed: boolean): void {
	notifySuppressed = suppressed
}

/** Default TTY I/O implementation using stdin/stdout */
export function createTtyIO(): VoleIO {
	return {
		async confirm(message: string): Promise<boolean> {
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			})
			try {
				return await new Promise<boolean>((resolve) => {
					rl.question(`${message} [y/N] `, (answer) => {
						resolve(answer.trim().toLowerCase() === 'y')
					})
				})
			} finally {
				rl.close()
			}
		},

		async prompt(message: string): Promise<string> {
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			})
			try {
				return await new Promise<string>((resolve) => {
					rl.question(`${message} `, (answer) => {
						resolve(answer.trim())
					})
				})
			} finally {
				rl.close()
			}
		},

		notify(message: string): void {
			if (!notifySuppressed) {
				// Chat-style response formatting
				const dim = '\x1b[2m'
				const cyan = '\x1b[36m'
				const reset = '\x1b[0m'
				process.stdout.write(`\n${dim}${cyan}  agent ›${reset} ${message}\n\n`)
			}
		},
	}
}
