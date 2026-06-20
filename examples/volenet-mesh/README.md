# VoleNet instant mesh

Spin up a **peer-to-peer network of agents** on one machine: a `coordinator` that
has the brain, and two **brainless** workers that each expose different tools.
Ask the coordinator to do something and watch it call tools that physically live
on other nodes — transparently, over [VoleNet](https://openvole.github.io/openvole/volenet).

```
            ┌─────────────────────────────┐
            │  coordinator  (has the LLM)  │   :9700
            │  Brain · Memory · routing    │
            └───────┬─────────────┬────────┘
        shell_*     │             │   fs_*
        ┌───────────┴───┐   ┌─────┴───────────┐
        │ worker-shell  │   │  worker-files   │
        │ paw-shell     │   │  paw-filesystem │
        │ (no brain)    │   │  (no brain)     │
        │ :9701         │   │  :9702          │
        └───────────────┘   └─────────────────┘

   Remote tools become local — the Brain doesn't know (or care) that
   shell_exec runs on :9701 and fs_write runs on :9702. The workers have
   no LLM of their own; they borrow the coordinator's. Ed25519-signed,
   no central server.
```

## Why it's interesting

- **Tools scattered across nodes, one brain.** Each worker contributes its tools to
  the coordinator's registry over the mesh. Add a GPU box, a database host, a Raspberry
  Pi — each just exposes its local tools.
- **Brainless workers = cheap.** Workers run no LLM; the coordinator does the thinking.
- **No central server.** Peers connect directly, authenticated with Ed25519 signatures.

## Prerequisites

- OpenVole installed (`npm i -g openvole`, or use `npx vole`).
- A model for the coordinator: a cloud key, or a local Ollama (then nothing leaves your machine).

## Run it

This directory **is** a `vole serve` root. `setup.sh` installs each space's paws,
keys the three spaces, cross-trusts them, and writes `spaces.json` so `vole serve`
(run here) sees all three.

```bash
cd examples/volenet-mesh

# 1. Key + cross-trust the spaces and generate the spaces.json registry
bash setup.sh

# 2. Give the coordinator a model
echo 'BRAIN_PROVIDER=gemini'   >  spaces/coordinator/.env
echo 'GEMINI_API_KEY=your-key' >> spaces/coordinator/.env

# 3. Start the control plane (in THIS directory), then start all three
#    spaces from the dashboard
vole serve
```

Then in the coordinator's chat: *"run `uname -a` and save the output to /tmp/host.txt"* — the
Brain plans the task, calls `shell_exec` on **worker-shell** and `fs_write` on **worker-files**,
and returns, never knowing the work happened on other nodes.

## What success looks like

```
vole net status
# coordinator: leader
# peers: worker-shell (connected), worker-files (connected)
# remote tools: shell_exec → worker-shell, fs_read/fs_write → worker-files
```

## Notes

- Ports `9700/9701/9702` are the VoleNet listen ports; change them in each
  `spaces/<node>/vole.config.json` (and the coordinator's `peers`) if they clash.
- This uses `localhost` peers for a single-machine demo. For real machines, swap
  the peer URLs for hostnames/IPs (or Docker service names) — the trust model is
  identical.
- If a node doesn't appear as a peer, check that its space is started in the dashboard
  and that `spaces/<node>/.openvole/net/authorized_voles` lists the others (re-run `setup.sh`).
