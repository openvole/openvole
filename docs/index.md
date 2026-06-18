---
layout: home
hero:
  name: OpenVole
  text: The self-hosted agent OS
  tagline: Run a fleet of AI agents on your own hardware, against any model, from one dashboard. Peer-to-peer networked. Nothing phones home.
  image:
    src: /vole.png
    alt: OpenVole
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: Browse Paws
      link: /paws
    - theme: alt
      text: View on GitHub
      link: https://github.com/openvole/openvole
features:
  - title: 🏠 Self-hosted & private
    details: Your agents, your hardware, your data. Point a space at a local Ollama model and nothing ever touches the cloud.
  - title: 🔌 Model-agnostic
    details: One unified brain paw speaks Anthropic, OpenAI, Gemini, xAI, and Ollama. Switch providers per agent with a single env var.
  - title: 🖥️ A server, not a script
    details: vole serve is a control plane — create, start, stop, and chat with a whole fleet of agents from one browser dashboard. No processes to babysit.
  - title: 🕸️ VoleNet
    details: A peer-to-peer agent mesh. Remote tools become local, cheap workers share one brain, memory syncs — Ed25519-signed, no central server.
  - title: 🧩 Microkernel, zero lock-in
    details: A tiny, LLM-ignorant core. Every capability is a Paw you can swap, sandbox, or write yourself. Bring your own system prompt.
  - title: 🪟 An app platform
    details: A Paw can ship its own UI, rendered under the dashboard's Apps tab — the way apps live on a desktop. Extend the agent console into a full self-hosted app, no extra server, no LLM in the loop.
---

<div style="max-width: 960px; margin: 4rem auto 0; padding: 0 24px;">

![The OpenVole control plane managing a running space](/dashboard.png)

<p style="text-align: center; color: var(--vp-c-text-2); font-size: 0.9rem; margin-top: 0.5rem;">
One <code>vole serve</code> control plane managing a fleet of agents — each its own isolated space.
</p>

</div>

<div style="max-width: 960px; margin: 4.5rem auto 0; padding: 0 24px;">

<p style="text-align: center; font-weight: 600; font-size: 1.15rem; margin-bottom: 0.5rem;">A dashboard you extend into a full app</p>

<p style="text-align: center; color: var(--vp-c-text-2);">
A Paw can ship its own UI, rendered as a panel under the <strong>Apps</strong> tab — the way apps live on a desktop. The panel talks to its paw's own tools directly — no LLM, no extra port — so the dashboard grows from an agent console into a full self-hosted app.
</p>

![The Apps tab — an embedded paw panel](/apps.png)

</div>
