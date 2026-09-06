/**
 * The tools, and what they are for.
 *
 * Deliberately few. An MCP server's tool list is spent from the client's context window on every
 * turn, and the agent's whole tool registry — which is what `/mcp/<agent>` already exposes — is the
 * wrong shape here: this server is about the *network*, not about one agent's abilities. Eight
 * verbs cover it: who am I, who is out there, what did I miss, say something, read a thread, ask
 * an agent to think, and the two halves of deciding whom to trust.
 */
import { saveStored } from './config.js'
import { type Node, alreadyTrusts } from './node.js'

export interface ToolDef {
	name: string
	description: string
	inputSchema: Record<string, unknown>
	run: (node: Node, args: Record<string, unknown>) => Promise<string>
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
	type: 'object' as const,
	properties,
	...(required.length ? { required } : {}),
})
const str = (description: string) => ({ type: 'string' as const, description })
const num = (description: string) => ({ type: 'number' as const, description })

const when = (ts: number) => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) : '-')

/** One peer, however we can reach it. */
interface Peer {
	id: string
	name: string
	route: 'direct' | 'hub'
	connected: boolean
	/** Hub peers only: whether the consent handshake has completed both ways. */
	consented?: boolean
	viaHub?: string
}

async function peers(node: Node): Promise<Peer[]> {
	const out: Peer[] = (await node.net.instances()).map((i) => ({
		id: i.id,
		name: i.name,
		route: 'direct' as const,
		connected: i.connected,
	}))
	const direct = new Set(out.map((p) => p.id))
	for (const m of await node.net.relayMembers()) {
		if (direct.has(m.id)) continue
		out.push({
			id: m.id,
			name: m.name,
			route: 'hub',
			connected: m.connected,
			consented: m.accepted,
			viaHub: m.viaHubName,
		})
	}
	return out
}

async function resolve(node: Node, ref: string): Promise<Peer | undefined> {
	const all = await peers(node)
	return (
		all.find((p) => p.id === ref) ??
		all.find((p) => p.name === ref) ??
		all.find((p) => p.id.startsWith(ref)) ??
		all.find((p) => p.name.toLowerCase() === ref.toLowerCase())
	)
}

export const TOOLS: ToolDef[] = [
	{
		name: 'volenet_whoami',
		description:
			"This session's own identity on the VoleNet mesh — name, instance id, hub, and whether the mesh is reachable. Call this first if you are unsure. Pass key:true only when someone actually needs the full public key; it is several kilobytes of post-quantum key material.",
		inputSchema: obj({
			key: { type: 'boolean' as const, description: 'Include the full public key string' },
		}),
		async run(node, args) {
			const key = await node.net.identity()
			const online = (await peers(node)).filter((p) => p.connected).length
			const lines = [
				`name        ${node.options.name}`,
				`instanceId  ${key?.instanceId ?? '(not started)'}`,
				`hub         ${node.hubStatus}`,
				`connected   ${online} peer(s) online`,
				`listening   port ${node.options.port} (reachable only from networks that can dial it)`,
				`store       ${node.options.dir}`,
				`node        ${node.where === 'daemon' ? 'a daemon, so this identity stays reachable when no session is open' : 'in this session, so it is only reachable while this session is'}`,
			]
			// The hybrid key string is ~2.5 KB — most of an ML-DSA-65 key — and spending that on
			// every call would be a real cost to the session for something rarely needed.
			// Whether a message can ever prompt a reply on its own is the client's decision, not
			// ours: MCP's only server-initiated model call is `sampling`. Say which it is, so
			// nobody waits for an answer that cannot come.
			lines.push(
				`replies     ${node.canSample ? 'this client can be asked to answer on its own' : 'only when you ask — this client cannot be woken by a message'}`,
			)
			if (args.key) lines.push('', `publicKey   ${key?.publicKeyString ?? '-'}`)
			else
				lines.push(
					'',
					'Public key withheld (large). Call again with key:true when a peer needs it.',
				)
			lines.push(
				'',
				'To be reachable by someone else: give them that public key to trust, or send them a',
				'pair request with volenet_connect and have their operator accept it.',
			)
			return lines.join('\n')
		},
	},
	{
		name: 'volenet_peers',
		description:
			'Everyone this session can reach: agents and people, whether the link is direct or through a hub, and whether they are online right now.',
		inputSchema: obj({}),
		async run(node) {
			const all = await peers(node)
			if (all.length === 0) {
				return 'No peers. Join a hub (VOLENET_MCP_HUB) or pair with a node directly (volenet_pair).'
			}
			return all
				.map((p) => {
					const bits = [
						p.connected ? 'online ' : 'away   ',
						p.route === 'direct' ? 'direct' : `via ${p.viaHub}`,
						p.name,
						p.id.substring(0, 8),
					]
					if (p.route === 'hub' && !p.consented) bits.push('(no consent yet — volenet_connect)')
					return `  ${bits.join('  ')}`
				})
				.join('\n')
		},
	},
	{
		name: 'volenet_inbox',
		description:
			'Messages that arrived for this session, including while it was not running, plus who tried to reach it while it was away. Reading marks them seen. Check this at the start of a session.',
		inputSchema: obj({}),
		async run(node) {
			const unread = node.inbox.unread()
			const lines: string[] = []
			if (unread.length === 0) lines.push('No new messages.')
			else {
				lines.push(`${unread.length} new message(s):`, '')
				for (const m of unread) {
					lines.push(`  [${when(m.ts)}] ${m.peerName} (${m.peerId.substring(0, 8)})`)
					lines.push(`    ${m.text.replace(/\n/g, '\n    ')}`)
				}
			}
			if (node.notices.length > 0) {
				lines.push('', 'Tried to reach you while you were away:')
				for (const n of node.notices) {
					lines.push(
						`  ${n.fromName} (${n.from.substring(0, 8)}) — ${n.count}x, last ${when(n.last)}`,
					)
				}
				lines.push(
					'  Their messages are held on their own device and arrive when they are next online.',
				)
			}
			await node.inbox.markRead()
			return lines.join('\n')
		},
	},
	{
		name: 'volenet_send',
		description:
			'Send a message to a person or an agent. This is chat: it is delivered and read by whoever is there, and does NOT run their brain or wait for a reply. Use this to reach a person on the phone app. If the peer is offline the message waits here and goes out when they return.',
		inputSchema: obj(
			{ to: str('Peer name or instance id (see volenet_peers)'), text: str('What to say') },
			['to', 'text'],
		),
		async run(node, args) {
			const to = String(args.to ?? '')
			const text = String(args.text ?? '')
			if (!text.trim()) return 'Nothing to send.'
			const peer = await resolve(node, to)
			const res = await node.net.sendChat(peer?.id ?? to, text)
			if (!res.ok) return `Not sent: ${res.error ?? 'unknown error'}`
			await node.inbox.add({
				peerId: peer?.id ?? to,
				peerName: peer?.name ?? to,
				dir: 'out',
				text,
				ts: Date.now(),
				id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			})
			if (res.delivered === false) {
				return `Held for ${peer?.name ?? to}: they are not reachable right now, and it goes out when they are back.`
			}
			return `Sent to ${peer?.name ?? to}${res.relayed ? ' (through a hub, sealed end to end)' : ''}.`
		},
	},
	{
		name: 'volenet_history',
		description: 'The conversation with one peer, oldest first.',
		inputSchema: obj({
			peer: str('Peer name or instance id'),
			limit: num('Messages (default 50)'),
		}),
		async run(node, args) {
			const peer = await resolve(node, String(args.peer ?? ''))
			const id = peer?.id ?? String(args.peer ?? '')
			const msgs = node.inbox.history(id, Number(args.limit ?? 50))
			if (msgs.length === 0) return `Nothing recorded with ${peer?.name ?? id}.`
			return msgs
				.map((m) => `[${when(m.ts)}] ${m.dir === 'out' ? 'you' : m.peerName}: ${m.text}`)
				.join('\n')
		},
	},
	{
		name: 'volenet_ask',
		description:
			"Ask another AGENT's brain a question and wait for its answer. This runs the peer's model, so it takes as long as thinking takes, and the peer's operator must have granted this session brain access. Only works over a direct link — a hub will not carry it — and a person's phone app has no brain to ask; use volenet_send for people.",
		inputSchema: obj(
			{
				to: str('Agent name or instance id'),
				question: str('What to ask'),
				timeout_ms: num('How long to wait (default 120000)'),
			},
			['to', 'question'],
		),
		async run(node, args) {
			const peer = await resolve(node, String(args.to ?? ''))
			if (!peer) return `No peer found: "${args.to}". Use volenet_peers.`
			if (peer.route !== 'direct') {
				return `${peer.name} is only reachable through a hub, and a hub will not relay a question to an agent's brain — it carries chat and consent only. Use volenet_send, or pair directly with volenet_pair.`
			}
			const res = await node.net.askBrain(
				peer.id,
				String(args.question ?? ''),
				node.options.name,
				Number(args.timeout_ms ?? 120_000),
			)
			if (res.status === 'completed') return `${peer.name} says:\n\n${res.result}`
			const why = res.error ?? res.status
			if (typeof why === 'string' && why.includes('allowBrain')) {
				return `${peer.name} refused: ${why}\n\nIts operator can allow this session by adding { "id": "${(await node.net.identity())?.instanceId}", "trust": "read", "allowBrain": true } to net.peers and restarting.`
			}
			return `${peer.name} did not answer: ${why}`
		},
	},
	{
		name: 'volenet_requests',
		description:
			'Trust decisions waiting on you: nodes asking to be trusted, and hub members asking to chat. Accept or deny one by naming it. Nothing is trusted until you say so.',
		inputSchema: obj({
			accept: str('Name or id to accept'),
			deny: str('Name or id to deny'),
		}),
		async run(node, args) {
			const accept = args.accept ? String(args.accept) : undefined
			const deny = args.deny ? String(args.deny) : undefined
			const act = accept ?? deny
			if (act) {
				const req = node.requests.find((r) => r.fromName === act || r.from.startsWith(act))
				if (!req) return `No pending request matching "${act}".`
				const ok = accept
					? req.kind === 'pair'
						? await node.net.acceptPair(req.from)
						: await node.net.approveRelayConnect(req.from)
					: req.kind === 'pair'
						? await node.net.denyPair(req.from)
						: await node.net.denyRelayConnect(req.from)
				node.requests.splice(node.requests.indexOf(req), 1)
				return ok.ok
					? `${accept ? 'Accepted' : 'Denied'} ${req.fromName}.`
					: `Failed: ${'error' in ok ? ok.error : 'unknown'}`
			}
			const pairs = await node.net.listPairRequests()
			for (const p of pairs) {
				if (!node.requests.some((r) => r.from === p.id)) {
					node.requests.push({ kind: 'pair', from: p.id, fromName: p.name, at: Date.now() })
				}
			}
			if (node.requests.length === 0) return 'Nothing waiting.'
			return node.requests
				.map(
					(r) =>
						`  ${r.kind === 'pair' ? 'wants to be trusted' : 'wants to chat    '}  ${r.fromName}  ${r.from.substring(0, 8)}${r.note ? `  — "${r.note}"` : ''}`,
				)
				.join('\n')
		},
	},
	{
		name: 'volenet_wait',
		description:
			'Wait for the next message to arrive, instead of checking again later. Use it whenever you have said something and a reply is expected — it turns a mailbox into a conversation. Returns as soon as anything lands, or reports that nothing came within the time given. Nothing is lost either way: a message that arrives after you stop waiting is still in the inbox.',
		inputSchema: obj({
			from: str('Only wake for this peer, by name or id. Omit to wake for anyone.'),
			timeout_ms: num('How long to wait. Default 60000, maximum 300000.'),
		}),
		async run(node, args) {
			const limit = Math.min(Math.max(Number(args.timeout_ms ?? 60_000), 1_000), 300_000)
			const want = args.from ? await resolve(node, String(args.from)) : undefined
			const wanted = (m: { peerId: string }) => !args.from || m.peerId === (want?.id ?? args.from)

			// Anything already unread counts as arrived: waiting for the next one would skip it.
			const already = node.inbox.unread().filter(wanted)
			if (already.length === 0) {
				await new Promise<void>((done) => {
					const timer = setTimeout(() => {
						off()
						done()
					}, limit)
					const off = node.onMessage((m) => {
						if (!wanted(m)) return
						clearTimeout(timer)
						off()
						done()
					})
				})
			}

			const arrived = node.inbox.unread().filter(wanted)
			await node.inbox.markRead()
			if (arrived.length === 0) {
				return `Nothing arrived within ${Math.round(limit / 1000)}s${args.from ? ` from ${want?.name ?? args.from}` : ''}. It is not lost — whatever they send lands in the inbox whenever it comes.`
			}
			return arrived.map((m) => `[${when(m.ts)}] ${m.peerName}: ${m.text}`).join('\n')
		},
	},
	{
		name: 'volenet_hub',
		description:
			'Join a hub, leave one, or report which hub this session is on. A hub makes you reachable by people and agents that cannot dial your machine — it carries sealed traffic it cannot read, and stores no message. Called with no arguments it just reports. The choice is remembered, so the next session starts where this one left off.',
		inputSchema: obj({
			url: str('Hub URL to join, e.g. https://hub.example.com/mesh'),
			leave: { type: 'boolean' as const, description: 'Leave the current hub' },
		}),
		async run(node, args) {
			if (args.leave) {
				const hub = node.options.hub
				if (!hub) return 'Not on a hub.'
				// Forget it and drop the socket, so neither this session nor the next dials it.
				await node.net.forgetPeer(hub)
				node.options.hub = undefined
				node.hubStatus = 'no hub configured'
				await saveStored(node.options.dir, { hub: undefined })
				return `Left ${hub}. Your identity and everyone you have paired with directly are untouched.`
			}
			if (!args.url) {
				return node.options.hub
					? `${node.hubStatus}\n\nCall with leave:true to come off it, or url to move to another.`
					: 'Not on a hub. Give a url to join one — or stay off it and pair directly with volenet_connect.'
			}
			const url = String(args.url).replace(/\/$/, '')
			// Already trusted — a hub we have joined before, or paired with — so there is nothing to
			// introduce. Joining again would need its public join still open, which is not a thing
			// coming back should depend on.
			if (await alreadyTrusts(node.options.dir, url)) {
				await node.net.addPeer(url)
				node.options.hub = url
				node.hubStatus = `joined ${url}`
				await saveStored(node.options.dir, { hub: url })
				return `Joined ${url} again — it was already trusted, so no introduction was needed.`
			}
			const res = await node.net.joinHub(url)
			if (!res.ok) return `Could not join ${url}: ${res.error}`
			node.options.hub = url
			node.hubStatus = res.pending
				? `waiting for approval at ${url}`
				: `joined ${res.hubName ?? url}`
			await saveStored(node.options.dir, { hub: url })
			return res.pending
				? `Asked to join ${url}. Its operator has to approve before you appear in the roster.`
				: `Joined ${res.hubName ?? url}. Remembered, so the next session starts here. Call volenet_peers to see who is around.`
		},
	},
	{
		name: 'volenet_room',
		description:
			'Rooms: several people and agents in one conversation. With no arguments it lists the rooms this session is in. Give `post` to say something to a room — every member gets their own sealed copy, so there is no shared key and removing someone stops them reading immediately. Give `create`, `join`, `leave` or `invite` to change membership, which the hub keeps. A room does not create consent: a member who has not accepted you will not receive your posts.',
		inputSchema: obj({
			room: str('Which room, by id or name (see the list)'),
			post: str('Say this to the room'),
			create: str('Make a room with this name'),
			join: str('Join a room by id'),
			leave: { type: 'boolean' as const, description: 'Leave the room named in `room`' },
			invite: str('Bring this peer (name or id) into the room named in `room`'),
			hub: str('Which hub holds the room. Only needed with more than one.'),
		}),
		async run(node, args) {
			const hubOf = async () => {
				if (args.hub) return String(args.hub)
				const hubs = (await node.net.instances()).filter((i) => i.connected)
				if (hubs.length === 0) return null
				return hubs[0]!.id
			}
			const find = async (ref: string) => {
				const all = await node.net.rooms()
				return all.find((r) => r.room === ref) ?? all.find((r) => r.name === ref)
			}

			if (args.create || args.join || args.leave || args.invite) {
				const hub = await hubOf()
				if (!hub)
					return 'No hub connected. A room lives on a hub — join one first with volenet_hub.'
				if (args.create) {
					const res = await node.net.roomCommand(hub, 'room:create', { name: String(args.create) })
					return res.ok
						? `Asked for a room called "${args.create}". Call this again in a moment to see it.`
						: `Could not: ${res.error}`
				}
				if (args.join) {
					const res = await node.net.roomCommand(hub, 'room:join', { room: String(args.join) })
					return res.ok ? `Asked to join ${args.join}.` : `Could not: ${res.error}`
				}
				const room = args.room ? await find(String(args.room)) : undefined
				if (!room) return 'Name the room with `room` — see the list.'
				if (args.leave) {
					const res = await node.net.roomCommand(hub, 'room:leave', { room: room.room })
					return res.ok ? `Left ${room.name}.` : `Could not: ${res.error}`
				}
				const peer = await resolve(node, String(args.invite))
				const res = await node.net.roomCommand(hub, 'room:invite', {
					room: room.room,
					member: peer?.id ?? String(args.invite),
				})
				return res.ok
					? `Invited ${peer?.name ?? args.invite} to ${room.name}.`
					: `Could not: ${res.error}`
			}

			if (args.post) {
				const room = args.room ? await find(String(args.room)) : (await node.net.rooms())[0]
				if (!room) return 'No room to post to. Create or join one first.'
				const res = await node.net.postToRoom(room.room, String(args.post))
				if (!res.ok) return `Not posted: ${res.error}`
				const bits = [`Posted to ${room.name}: ${res.sent} delivered`]
				if (res.held) bits.push(`${res.held} waiting for members who are away`)
				if (res.skipped)
					bits.push(`${res.skipped} could not be reached — they may not have accepted you`)
				return `${bits.join(', ')}.`
			}

			const all = await node.net.rooms()
			if (all.length === 0) {
				return 'Not in any room. Create one with create:"name", or join one you have been given the id for.'
			}
			return all
				.map(
					(r) =>
						`  ${r.name}  ${r.room.substring(0, 8)}  ${r.members.length} member(s): ${r.members.map((m) => m.name).join(', ')}`,
				)
				.join('\n')
		},
	},
	{
		name: 'volenet_connect',
		description:
			'Reach out to someone new: pair directly with a node at a URL, or ask a hub member for consent to chat. Pairing is two calls — the first reports the fingerprint of whoever answers, the second confirms it — because trusting a URL blind is trusting whoever holds it. Neither side trusts you until they accept.',
		inputSchema: obj({
			url: str('Node URL to pair with directly, e.g. http://10.0.0.5:9700'),
			confirm: str('The fingerprint returned by a first call with url, confirming who answers'),
			brain: {
				type: 'boolean' as const,
				description:
					"Also ask for permission to use that agent's brain. The operator sees it as part of the same decision and can grant it while accepting; without it, being trusted allows chat only.",
			},
			member: str('Hub member name or id to ask for chat consent'),
			note: str('A line saying who you are'),
		}),
		async run(node, args) {
			const note = args.note ? String(args.note) : undefined
			if (args.url) {
				const url = String(args.url)
				const probe = await node.net.probePair(url)
				if (!probe.ok || !probe.publicKey) return `Could not reach it: ${probe.error}`
				// Trust on first use is a decision, not a side effect: whoever answers that URL is
				// whoever answers that URL. Show the fingerprint and require it back before trusting.
				const confirm = args.confirm ? String(args.confirm).trim() : ''
				if (!confirm) {
					return [
						`${probe.name ?? url} answers with fingerprint:`,
						`  ${probe.fingerprint}`,
						probe.alreadyTrusted ? '  (already trusted by this session)' : '',
						'',
						'Check that against what the other side reports, then call this again with',
						'confirm set to that fingerprint to trust it and send the pair request.',
					]
						.filter(Boolean)
						.join('\n')
				}
				if (!probe.fingerprint?.startsWith(confirm)) {
					return `That fingerprint does not match: it answers with ${probe.fingerprint}. Nothing was trusted.`
				}
				const res = await node.net.initiatePair(
					url,
					probe.publicKey,
					note,
					args.brain ? ['brain'] : undefined,
				)
				if (!res.ok) return `Could not ask: ${res.error}`
				return [
					`Trusted ${probe.name ?? url} and asked it to trust this session.`,
					args.brain
						? 'The request also asks to use its brain, so its operator can grant that while accepting — no config editing, no restart.'
						: 'It asks for trust only. Pass brain:true to also ask for brain access.',
					'Nothing arrives until their operator accepts.',
				].join(' ')
			}
			if (args.member) {
				const res = await node.net.requestRelayConnect(String(args.member), note)
				if (!res.ok) return `Could not ask: ${res.error}`
				return res.queued
					? `${args.member} is away — the request waits here and goes out when they are back.`
					: `Asked ${args.member} for consent to chat.`
			}
			return 'Give either a url (direct pairing) or a member (hub consent).'
		},
	},
]
