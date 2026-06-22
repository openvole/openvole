<p align="center">
  <img src="https://raw.githubusercontent.com/openvole/openvole/main/assets/vole.png" alt="OpenVole" width="180">
</p>

<h1 align="center">OpenVole</h1>

<p align="center">
  <strong>The self-hosted agent OS — run a fleet of AI agents on your own hardware,<br>
  against any model, from one dashboard. Peer-to-peer networked. Nothing phones home.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/openvole"><img src="https://img.shields.io/npm/v/openvole" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://openvole.github.io/openvole"><img src="https://img.shields.io/badge/docs-openvole.github.io-3fb950" alt="Docs"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/openvole/openvole/main/assets/dashboard.png" alt="The OpenVole control plane" width="820">
</p>

## What is OpenVole?

OpenVole is a **self-hosted server for running and managing AI agents**. One command —
`vole serve` — gives you a dashboard where you create, configure, and chat with a whole
fleet of agents, each isolated with its own tools, memory, and identity.

- **Model-agnostic** — Gemini, OpenAI, Claude, xAI, or local Ollama. Your choice, swappable per agent.
- **Self-hosted & private** — runs entirely on your hardware, against whatever model you point it at, with nothing phoning home.
- **Networked** — connect instances over **VoleNet**, a peer-to-peer agent mesh, and share tools, memory, and even a brain across machines.

Under the hood it's a **microkernel**: the core is just the agent loop and a plugin contract.
Every capability — reasoning, memory, tools, channels — is a swappable plugin (a **Paw**), so
you're never locked into someone else's worldview. A fresh install ships with zero baked-in
opinions: you assemble exactly the agent you want.

## Quick start

```bash
npm install -g openvole          # package is "openvole"; gives you the `vole` command
mkdir my-agents && cd my-agents
vole serve
```

`vole serve` prints a **tokenized dashboard URL** (the dashboard is gated by a session token) —
open it, click **New space**, and onboarding installs the essential paws (brain, session, memory,
compact, shell). Point a space at your model:

```
BRAIN_PROVIDER=gemini
GEMINI_API_KEY=your-api-key
```

…then start it and chat in the **Chat** tab. Prefer one command? Use a preset:

```bash
curl -fsSL https://raw.githubusercontent.com/openvole/openvole/main/presets/basic.sh | bash
```

> The npm package is **`openvole`** (it provides the `vole` command). To run without installing: `npx openvole <command>` — **not** `npx vole`, which is an unrelated package.

Full walkthrough → [Getting Started](https://openvole.github.io/openvole/getting-started).

## Why OpenVole?

| | |
|---|---|
| 🏠 **Self-hosted & private** | Your agents, your hardware, your data. Nothing phones home — point it at a local Ollama model and it never touches the cloud. |
| 🔌 **Model-agnostic** | One unified brain paw speaks Anthropic, OpenAI, Gemini, xAI, and Ollama. Switch providers per agent with a single env var. |
| 🖥️ **A server, not a script** | `vole serve` is a control plane: create, start, stop, and chat with a fleet of agents — "spaces" — from one browser dashboard. No babysitting processes on ports. |
| 🧩 **Microkernel, zero lock-in** | A tiny, LLM-ignorant core. Every capability is a Paw you can swap, sandbox, or write yourself — and you can bring your own system prompt via `BRAIN.md`. |
| 🕸️ **VoleNet** | A peer-to-peer AI agent network: remote tools become local, cheap workers share one brain, memory syncs across the mesh — signed with hybrid post-quantum signatures (Ed25519 + ML-DSA-65), with leader election and no central server. |
| 🪟 **An app platform** | A Paw can ship its own UI, rendered as a panel under the dashboard's **Apps** tab — the way apps live on a desktop. The control plane becomes a self-hosted app you extend, one panel per paw. |

## Apps — paws that bring their own UI

A Paw can ship its own interface: it drops a static HTML file in its package, declares it in the
manifest, and the control plane renders it as a sandboxed panel under the **Apps** tab — one entry
per paw that has a UI.

<p align="center">
  <img src="https://raw.githubusercontent.com/openvole/openvole/main/assets/apps.png" alt="The Apps tab — an embedded paw panel" width="820">
</p>

It's the app-platform model — self-contained apps embedded inside a host shell, the way apps live on
a desktop or extensions add panels to an editor: the panel calls its paw's own tools directly (proxied over IPC — **no LLM in
the loop, no tokens, no extra port**), so a paw author gets a real interactive app — dashboards,
forms, live data views — running deterministically inside the dashboard. The reference example,
`paw-markets`, embeds a live watchlist with sparklines and alerts.

The further this goes, the less OpenVole is "an agent runner" and the more it's a **dashboard you
extend into a full app** — every capability, agentic or not, a panel you can attach.

## Core concepts

**The agent loop** — the only thing the core does natively:

```
Bootstrap → Perceive → Compact → Think → Act → Observe → loop
```

**Paws** — subprocess-isolated plugins that connect OpenVole to the world (APIs, databases,
browsers, messaging). Each runs behind a capability-based permission sandbox.

**Skills** — behavioral recipes: a folder with a `SKILL.md` and no code. Compatible with
[ClawHub](https://clawhub.ai) (13,000+ skills).

**Brain** — the LLM lives in a Paw, not the core. `@openvole/paw-brain` is one unified paw for
all providers and auto-detects from your API keys.

Deep dive → [Architecture](https://openvole.github.io/openvole/architecture).

## Official Paws

A growing catalog, all installed from [PawHub](https://github.com/openvole/pawhub) via npm and
sandboxed by default:

- **Brain** · unified multi-provider (`paw-brain`)
- **Channels** · Telegram, Slack, Discord, WhatsApp, MS Teams, Voice (Twilio)
- **Tools** · Browser, Shell, Filesystem, MCP bridge, Email/Resend, GitHub, Calendar, TTS/STT, Computer use, Database, Scraper, PDF, Image, Social (X/LinkedIn)
- **Infrastructure** · Memory (hybrid semantic + keyword), Session, Compact

```bash
vole paw add @openvole/paw-telegram
```

Full list & docs → [Paws](https://openvole.github.io/openvole/paws).

## VoleNet — distributed agents

Connect OpenVole instances across machines into a mesh. Remote tools appear in your local
registry (the Brain can't tell the difference), brainless workers delegate thinking to a
coordinator, and memory/sessions sync — all authenticated with hybrid post-quantum signatures
(Ed25519 + ML-DSA-65), with leader election and load balancing. Eight topologies, one protocol,
no central server.

Agents talk to each other, too: one Brain can message a peer agent (`net_message`), or you can
chat with a connected peer directly from the dashboard's VoleNet tab. Every remote action — tool
calls, brain delegation, chat — requires a signed message from an authorized peer; tools and brain
are never exposed to peers unless you explicitly grant them.

```bash
vole net init my-instance        # generate an Ed25519 identity
vole net show-key                # share your public key
vole net trust "vole-ed25519 ..." # trust a peer
```

Architecture patterns & setup → [VoleNet docs](https://openvole.github.io/openvole/volenet).

## Security

Sandboxed by default. Every Paw runs as a subprocess under Node's permission model — network,
filesystem, and child-process access are denied unless you grant them, and effective permissions
are the *intersection* of what a Paw requests and what you approve. Optional Docker isolation, and
an AES-256 encrypted vault for secrets.

Details → [Security](https://openvole.github.io/openvole/security).

## OpenVole vs OpenClaw

Both are open-source agent frameworks with a shared skill format (`SKILL.md`), heartbeat pattern,
and MCP ecosystem — skills written for one work on the other. The difference is philosophy:

| | OpenVole | OpenClaw |
|---|---|---|
| **Core** | Microkernel — empty, ~60KB, everything is a plugin | Batteries-included — 25 built-in tools, ~8MB |
| **Brain / LLM** | External Paw; core is LLM-ignorant | Configurable provider in core |
| **Memory** | Source-isolated (user / paw / heartbeat scoped) | Shared |
| **Isolation** | Node permission sandbox on by default + capabilities | Optional Docker sandbox |
| **Networking** | VoleNet P2P mesh across machines | Single machine |
| **Server** | `vole serve` control plane for a fleet of agents | Gateway web UI |

If you like the microkernel approach — every piece a Paw you can swap, extend, or build yourself —
come try it, build a Paw, write a Skill, and help this little vole grow.

## Documentation

Full reference at **[openvole.github.io/openvole](https://openvole.github.io/openvole)**:
[Getting Started](https://openvole.github.io/openvole/getting-started) ·
[Configuration](https://openvole.github.io/openvole/configuration) ·
[CLI](https://openvole.github.io/openvole/cli) ·
[Dashboard](https://openvole.github.io/openvole/dashboard) ·
[Paws](https://openvole.github.io/openvole/paws) ·
[VoleNet](https://openvole.github.io/openvole/volenet)

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md), and the
[PawHub guide](https://github.com/openvole/pawhub/blob/main/CONTRIBUTING.md) for building Paws.

> **If it connects to something, it's a Paw.**
> **If it describes behavior, it's a Skill.**
> **If the agent calls it, it's a Tool.**

## License

[MIT](LICENSE)
