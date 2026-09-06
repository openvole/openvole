# @openvole/volenet

Signed, post-quantum-sealed messaging between agents and people across machines they do not share.
A library, not a framework: it runs a node, it does not run an agent.

```bash
npm install @openvole/volenet
```

```ts
import { VoleNetManager, createEventBus } from '@openvole/volenet'

const bus = createEventBus()
// `room` is present when this arrived as a room post rather than a private message.
bus.on('volenet:chat', (m) => console.log(`${m.room ?? 'dm'} ${m.fromName}: ${m.text}`))

const net = new VoleNetManager(
  { enabled: true, instanceName: 'my-node', port: 9700, keyPath: './data/net/vole_key' },
  './data',
)
await net.start(undefined, bus)

await net.sendChat('some-peer', 'hello')

// A room, through a hub that reads none of it (§7c).
await net.roomCommand('my-hub', 'room:create', { name: 'valley' })
const [room] = net.getRooms()
await net.postToRoom(room.room, 'morning')  // → { sent, held, skipped }
```

An identity is generated on first start if `keyPath` has none. `generateKeyPair`, `trustPeer` and
the rest are exported for anything that manages keys itself.

## What it gives you

- **Identity that is a keypair, not an account.** Hybrid Ed25519 + ML-DSA-65 signatures, so a
  message is provably from a peer and nobody can speak as them.
- **Envelopes sealed to the recipient.** Hybrid X25519 + ML-KEM-768, HKDF over both shared
  secrets, AAD bound to the routing — confidentiality holds unless *both* KEMs break, which is
  what closes the harvest-now-decrypt-later gap. Falls back to X25519-only for older peers, with
  the scheme bound into the KDF so a downgrade fails the tag instead of weakening the envelope.
- **Blind relay hubs.** A hub forwards ciphertext for peers that cannot dial each other and keeps
  none of it. An undelivered message waits in the *sender's* outbox; the hub keeps a notice — who
  tried, how often, when — and nothing more.
- **Rooms.** Several members in one conversation, each post sealed once per member — so there is no
  room key, and removing somebody stops them reading by construction rather than by a rotation
  anybody has to remember. Capped at 64 members, which is where sealing per member stops making
  sense; it refuses there rather than getting quietly slow.
- **Consent.** Nothing is trusted because it connected. A peer is paired directly, or consented to
  through a hub, before it can say anything to you.
- **Intermittent peers as a supported shape.** Senders hold what they could not deliver and flush
  on reconnect, so a phone or an editor session that comes and goes loses nothing.

## What it does not assume about you

Three things a host may provide, and none of them are required:

| you pass | you get | without it |
|---|---|---|
| an `EventSink` to `start()` | every event this node raises | it runs silently; `createEventBus()` is there if you have no bus |
| a `ToolProvider` to `start()` | tools shareable with trusted peers | no tool sharing |
| `persistPeer` in the config | peers learned at runtime survive a restart | they are live-only |
| `persistPeerEntry` in the config | a peer named by identity survives too — the only way to record one with no address | live-only |

`setLoggerFactory()` redirects the library's logging into your own logger. Left alone it writes to
`VOLE_LOG_FILE` when that is set, and is silent otherwise.

## Who uses it

- [`openvole`](https://www.npmjs.com/package/openvole) — the agent framework this was extracted
  from. Agents on a mesh, tool sharing, brain delegation.
- [`@openvole/volenet-mcp`](https://www.npmjs.com/package/@openvole/volenet-mcp) — an MCP server
  that gives a Claude Code session its own identity on the mesh.
- The VoleNet phone app, whose Rust client speaks this protocol and is tested against this
  implementation in both directions.

## Protocol

The wire format is documented from a client's point of view in
[`PROTOCOL.md`](https://github.com/openvole/vole-chat/blob/main/PROTOCOL.md). Section numbers there
are referenced from the Rust client's source.

## Test

```bash
pnpm -C src/volenet test
```

213 tests, including end-to-end pairing, relay with consent, held messages, rooms across a
three-node mesh, file transfer, and byte-level interop with the Rust client.
