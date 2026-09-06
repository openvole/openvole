/**
 * Guided flows, shipped with the server.
 *
 * A tool list tells a session what it *can* do, not what to do first, in what order, or what the
 * words mean. In a fresh session "pair with my agent at <url>" only works if the model happens to
 * match the sentence to `volenet_connect` — which it usually will, and shouldn't have to. Prompts
 * surface in the client as commands, so the flow is chosen rather than guessed.
 *
 * They ship in this package rather than as files written into someone's editor config, so
 * installing is all it takes and they cannot drift from the tools they describe.
 */

export interface PromptArgument {
	name: string
	description: string
	required?: boolean
}

export interface PromptDef {
	name: string
	description: string
	arguments?: PromptArgument[]
	/** The instruction handed to the session, with any arguments already filled in. */
	render: (args: Record<string, string>) => string
}

export const PROMPTS: PromptDef[] = [
	{
		name: 'setup',
		description: 'Get this session onto the VoleNet mesh — join a hub, or pair with an agent.',
		render: () => `Get this session onto the VoleNet mesh.

1. Call \`volenet_whoami\` first. It reports the identity, whether a hub is set, and how many peers
   are reachable. An identity is generated on first run; there is nothing to create.
2. If nothing is connected, explain the two routes and ask which is wanted — do not pick silently:
   - **A hub** (\`volenet_hub\`) makes this session reachable from anywhere, including from a phone,
     and works when neither side can dial the other. A hub carries sealed traffic it cannot read and
     stores no message. It will **not** relay a question to an agent's brain.
   - **A direct pair** (\`volenet_connect\`) with an agent whose address is reachable from here. This
     is the only route that can ask an agent's brain.
   Both can be used at once, and either can be added later.
3. Carry out whichever they choose. For a hub, the URL is enough. For a pair, follow the two-step
   fingerprint check — the \`pair\` command covers it.
4. Finish by calling \`volenet_peers\` and saying plainly who is now reachable, and by which route.

Reaching someone also needs consent, which is separate from being connected: on a hub, either side
asks and the other accepts. Say so, rather than letting an empty roster look like a failure.`,
	},
	{
		name: 'catch-up',
		description: 'Read what arrived while this session was away, and say what needs answering.',
		render: () => `Catch up on VoleNet.

1. Call \`volenet_inbox\`. It returns messages that arrived — including while no session was running,
   since senders hold what they could not deliver and flush on reconnect — and who tried to reach
   this session while it was away. Reading marks them seen.
2. Call \`volenet_peers\` if anything needs context about who a sender is.
3. Summarise for the person: who wrote, what they want, and what is worth answering. Do not reply on
   their behalf without asking.
4. If a reply is wanted, \`volenet_send\` says it and \`volenet_wait\` waits for what comes back, so
   an exchange happens in one turn rather than by checking again later.

If nothing arrived, say so in one line. This is worth running at the start of a session.`,
	},
	{
		name: 'pair',
		description: 'Pair with an agent at a URL, checking the fingerprint before trusting it.',
		arguments: [
			{
				name: 'url',
				description: 'The agent to pair with, e.g. http://10.0.0.5:9700',
				required: true,
			},
		],
		render: (a) => `Pair this session with the VoleNet node at ${a.url ?? '<url>'}.

Pairing is deliberately two calls, because trusting a URL blind is trusting whoever holds it.

1. Call \`volenet_connect\` with \`url: "${a.url ?? '<url>'}"\`. It reaches the node and reports the
   fingerprint of whoever answered. It trusts nothing yet.
2. Show that fingerprint to the person and ask them to check it against what the other side reports
   — \`vole net show-key\` on an OpenVole agent. **Wait for them.** Do not confirm on their behalf:
   this step exists precisely so a human compares two values.
3. Ask whether this session should also be able to use that agent's **brain** — running its model
   to answer questions — or only chat with whoever runs it.
4. Once they confirm the fingerprint, call \`volenet_connect\` again with the same \`url\`,
   \`confirm:\` set to that fingerprint, and \`brain: true\` if they said yes. This trusts the node
   and sends a pair request carrying the ask.
5. Tell them the request now waits for the operator of that node to accept it, and that nothing
   arrives until they do.

Being trusted is not the same as being allowed to do anything: the keystore says who may connect,
\`net.peers\` says what they may then do. Sending the ask with the request is what lets the operator
settle both while accepting, instead of editing a config file afterwards.`,
	},
	{
		name: 'reach',
		description: 'Message a peer and wait for the reply, rather than checking back later.',
		arguments: [
			{ name: 'peer', description: 'Who to reach — a name or instance id', required: true },
			{ name: 'message', description: 'What to say', required: false },
		],
		render: (
			a,
		) => `Reach ${a.peer ?? 'a peer'} over VoleNet${a.message ? ` and say: ${a.message}` : ''}.

1. \`volenet_peers\` first if unsure the name resolves, or by which route they are reachable.
2. \`volenet_send\` to say it. This is chat: it reaches whoever is there and does **not** run their
   brain. To ask an agent's model instead, use \`volenet_ask\` — direct links only, and its operator
   must have granted brain access.
3. \`volenet_wait\` for the answer, so the exchange completes in this turn. If nothing comes back in
   time, say so plainly: the message is not lost, and a reply lands in the inbox whenever it comes.

If the peer is offline the message waits here and goes out when they return — report that rather
than treating it as a failure.`,
	},
]
