/**
 * One way to notice a message arrived, for the three things that need to.
 *
 * The daemon owns the connections and appends to the log; nothing else here talks to the network.
 * Noticing is therefore always the same job — watch one file, re-read the cursor another process
 * may have moved, hand over whatever is unread — and it was written three times before this.
 *
 * A watcher plus a poll, not either alone: `fs.watch` is immediate but misses events on some
 * filesystems and network mounts, and a one-second poll is a floor rather than the mechanism.
 */
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import type { Inbox, Message } from './inbox.js'

/** How often to look anyway, in case the filesystem never told us. */
const POLL_MS = 1000

export interface WatchOptions {
	/** Mark what was handed over as read. Off for a caller that only wants to peek. */
	markRead?: boolean
	/**
	 * Called once a delivery is finished *and* the cursor has moved.
	 *
	 * The difference from `onArrive` matters to anyone about to exit: marking read is a file write,
	 * and a process that leaves as soon as it has the message loses the cursor and is handed the
	 * same message again next time.
	 */
	onDelivered?: (messages: Message[]) => void
}

/**
 * Call `onArrive` whenever unread messages appear. Returns a function that stops watching.
 *
 * Deliveries never overlap: while `onArrive` is running, a further arrival is remembered and
 * re-checked the moment it finishes, rather than being handed to a second concurrent call or
 * dropped until the next poll. Marking as read happens *after* the handler resolves, so a handler
 * that throws leaves the message unread for whoever looks next.
 */
export function watchInbox(
	inbox: Inbox,
	dir: string,
	onArrive: (messages: Message[]) => void | Promise<void>,
	options: WatchOptions = {},
): () => void {
	const log = 'messages.jsonl'
	let busy = false
	let again = false
	let stopped = false

	const check = async () => {
		if (stopped) return
		// A trigger during a delivery is not dropped — the file changed, so there may well be
		// something new — it is remembered and drains below.
		if (busy) {
			again = true
			return
		}
		busy = true
		try {
			do {
				again = false
				await inbox.refresh().catch(() => undefined)
				const unread = inbox.unread()
				if (unread.length === 0) break
				await onArrive(unread)
				if (options.markRead !== false) await inbox.markRead()
				options.onDelivered?.(unread)
			} while (again && !stopped)
		} catch {
			// A failed delivery leaves the cursor where it was, so the next tick tries again.
		} finally {
			busy = false
		}
	}

	let watcher: fsSync.FSWatcher | undefined
	try {
		watcher = fsSync.watch(path.dirname(path.join(dir, log)), (_event, name) => {
			if (name === log) void check()
		})
	} catch {
		// No watcher available here; the poll below still gets there.
	}
	const timer = setInterval(() => void check(), POLL_MS)
	void check()

	return () => {
		stopped = true
		clearInterval(timer)
		watcher?.close()
	}
}

/**
 * Resolve with the first messages to arrive, or an empty array once `timeoutMs` has passed.
 *
 * This is `watchInbox` for a caller that wants one delivery and then to be done — the shape a
 * process that exits on arrival needs. It resolves after the cursor has moved, not before, so
 * exiting immediately cannot lose the read state.
 */
export function waitForMessages(
	inbox: Inbox,
	dir: string,
	timeoutMs: number,
	options: WatchOptions = {},
): Promise<Message[]> {
	return new Promise<Message[]>((resolve) => {
		let done = false
		// Safe to close over both below: neither the watcher nor the timer can call `finish`
		// synchronously — the watcher awaits a file read first, and a timer is a timer.
		const finish = (value: Message[]) => {
			if (done) return
			done = true
			clearTimeout(cap)
			stop()
			resolve(value)
		}
		const stop = watchInbox(inbox, dir, () => {}, {
			...options,
			onDelivered: finish,
		})
		const cap = setTimeout(() => finish([]), timeoutMs)
	})
}
