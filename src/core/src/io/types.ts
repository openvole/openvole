/** Pluggable I/O interface for user-facing communication */
export interface VoleIO {
	/** Ask the user for a yes/no confirmation */
	confirm(message: string): Promise<boolean>
	/** Ask the user for free-form input */
	prompt(message: string): Promise<string>
	/** Send a notification to the user (fire-and-forget) */
	notify(message: string): void
}
