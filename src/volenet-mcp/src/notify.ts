/**
 * Telling the person, when nothing can tell the session.
 *
 * MCP has no way for a server to wake its client — Claude Code advertises no `sampling`, so a
 * message cannot prompt a reply on its own. What is left is telling the *human*, which is what a
 * chat client actually does: the notification is the point, and reading it is their move.
 *
 * Only the daemon does this. It is the one thing always running, and it is where arrivals land.
 *
 * Best effort throughout: a machine with no notifier, a headless box, a locked-down desktop — none
 * of that is worth failing a delivery over, so every path here swallows its errors.
 */
import { spawn } from 'node:child_process'

export type Notifier = (title: string, body: string) => void

/** Escape for AppleScript, which is the one path here that interpolates into a script. */
const applescript = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

function run(command: string, args: string[]): void {
	try {
		const child = spawn(command, args, { stdio: 'ignore', detached: true })
		child.on('error', () => undefined)
		child.unref()
	} catch {
		// no such binary, or spawning is not allowed here
	}
}

/**
 * A notifier for this platform, or one that does nothing.
 *
 * `VOLENET_MCP_NOTIFY=off` turns it off; anything else names a command to run instead, which is
 * given the title and body as its two arguments.
 */
export function notifier(platform = process.platform): Notifier {
	const setting = process.env.VOLENET_MCP_NOTIFY?.trim()
	if (setting === 'off') return () => undefined
	if (setting) return (title, body) => run(setting, [title, body])

	if (platform === 'darwin') {
		return (title, body) =>
			run('osascript', [
				'-e',
				`display notification "${applescript(body)}" with title "${applescript(title)}"`,
			])
	}
	if (platform === 'linux') return (title, body) => run('notify-send', [title, body])
	if (platform === 'win32') {
		return (title, body) =>
			run('powershell', [
				'-NoProfile',
				'-Command',
				`[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');` +
					`$n=New-Object System.Windows.Forms.NotifyIcon;$n.Icon=[System.Drawing.SystemIcons]::Information;` +
					`$n.Visible=$true;$n.ShowBalloonTip(5000,'${title.replace(/'/g, "''")}','${body.replace(/'/g, "''")}',0)`,
			])
	}
	return () => undefined
}

/** One line of a message, short enough for a notification and with newlines flattened. */
export function preview(text: string, limit = 140): string {
	const flat = text.replace(/\s+/g, ' ').trim()
	return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}
