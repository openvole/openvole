import * as readline from 'node:readline'
import type { VoleIO } from './types.js'

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
			process.stdout.write(`${message}\n`)
		},
	}
}
