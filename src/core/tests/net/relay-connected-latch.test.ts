import { describe, expect, it, vi } from 'vitest'
import type { VoleNetMessage } from '../../src/net/protocol.js'
import { VoleNetTransport } from '../../src/net/transport.js'

/**
 * Regression: a NAT'd relay member advertises a LAN/private endpoint the hub can't reach, but
 * holds a live inbound WebSocket. The hub's roster/relay pushes go over that socket. The bug:
 * `sendToPeer`'s HTTP fallback latched `connected = false` whenever a push momentarily missed the
 * open socket and fell through to a POST at the (unreachable) advertised endpoint — and nothing
 * ever set it true again, so the member was stuck offline in the roster and the relay could no
 * longer forward to it, even though its WebSocket was working the whole time.
 *
 * Fix: `connected` is owned by the WS bind/close lifecycle. A successful WS push heals it true;
 * a failed one-shot HTTP fallback never latches it false.
 */

const msg = {
	type: 'ping',
	id: '1',
	from: 'hub',
	to: 'B',
	ts: 0,
	payload: {},
} as unknown as VoleNetMessage

// An OPEN mock socket (readyState 1 === WebSocket.OPEN) that accepts sends.
function openSocket() {
	return { readyState: 1, send: vi.fn() }
}

function injectPeer(
	t: VoleNetTransport,
	ws: { readyState: number; send: unknown },
	connected: boolean,
) {
	// The hub only knows the member's unreachable advertised endpoint (a LAN IP); its real path
	// is the inbound WS. Port 1 on loopback refuses instantly so the HTTP fallback fails fast.
	// biome-ignore lint/suspicious/noExplicitAny: reaching into the private peer map for a unit test
	;(t as any).peers.set('B', {
		peerId: 'B',
		endpoint: 'http://127.0.0.1:1',
		connected,
		lastSeen: 0,
		ws,
		reconnectTimer: null,
		reconnectAttempts: 0,
		connecting: false,
	})
}

describe('relay member connected-latch (sendToPeer)', () => {
	it('heals connected=true after a successful WebSocket push (undoes a stuck-false latch)', async () => {
		const t = new VoleNetTransport({ port: 0 })
		const ws = openSocket()
		injectPeer(t, ws, false) // stuck false from a prior fallback failure

		const ok = await t.sendToPeer('B', msg)

		expect(ok).toBe(true)
		expect(ws.send).toHaveBeenCalledOnce()
		// biome-ignore lint/suspicious/noExplicitAny: reading back private state
		expect((t as any).peers.get('B').connected).toBe(true)
	})

	it('does NOT latch connected=false when the HTTP fallback fails (WS is the real path)', async () => {
		const t = new VoleNetTransport({ port: 0 })
		const ws = { readyState: 3, send: vi.fn() } // CLOSED → skip WS, force HTTP fallback
		injectPeer(t, ws, true) // currently connected via a (momentarily) live inbound WS

		const ok = await t.sendToPeer('B', msg)

		expect(ok).toBe(false) // the one-shot POST to the unreachable endpoint fails
		expect(ws.send).not.toHaveBeenCalled()
		// The crux: a failed fallback must not mark a peer with a live socket offline.
		// biome-ignore lint/suspicious/noExplicitAny: reading back private state
		expect((t as any).peers.get('B').connected).toBe(true)
	})
})
