# OpenVole public hub

Run a **public VoleNet hub** — a coordinator anyone can join with one command, forming an
internet-wide mesh of agents. Followers point their own OpenVole agent at your hub and they're
on the network. See [VoleNet](https://openvole.github.io/openvole/volenet).

This hub is configured for safe public hosting:
- **Public self-join** — strangers self-register at a restricted **guest** trust level (never `full`).
- **No brain for guests** (`allowBrain: false`) — visitors can't run up your LLM bill.
- **Rate-limited & capped** joins (`ratePerMinute`, `maxPeers`).
- **`"demo": true`** — the hub's config/identity are read-only in the dashboard (tamper-proof).

## Host the hub

```bash
cd examples/public-hub

# 1. Install paws, generate the hub identity, write spaces.json
bash setup.sh

# 2. Give the hub a model (a paid API you fund — guests bring their own brains)
echo 'BRAIN_PROVIDER=gemini'   >  spaces/hub/.env
echo 'GEMINI_API_KEY=your-key' >> spaces/hub/.env

# 3. Run it, then start the hub space from the dashboard
vole serve
```

Expose the **VoleNet port `9700`** to the internet (the dashboard on `3000` can stay local).
Watch peers arrive with `vole net peers`.

## Join the hub (followers)

From a space that has **its own brain** (your own LLM key):

```bash
vole net join http://YOUR_HUB_HOST:9700 --name your-name
```

This registers your public key with the hub, trusts the hub back, and adds it as a peer in your
`vole.config.json`. Restart your space — `vole net status` should show the hub connected.

## Knobs — `spaces/hub/vole.config.json` → `net.publicJoin`

| Field | Default | What |
|---|---|---|
| `trustLevel` | `tool` | Guest trust: `read` (memory only) or `tool`. Never `full`. |
| `allowBrain` | `false` | Let guests use the hub's brain (you pay). Keep off for a public hub. |
| `maxPeers` | `200` | Cap on trusted peers. |
| `ratePerMinute` | `5` | Per-IP join rate limit. |
| `requireApproval` | `false` | Queue joins to `pending_joins.jsonl` for manual `vole net trust` instead of auto-trusting. |

## Notes

- Generated files (`spaces.json`, keys under `.openvole/`, `node_modules`, `.env`) are gitignored —
  you generate fresh keys when you run `setup.sh`.
- For a single-machine, multi-node mesh demo (no public exposure), see [`../volenet-mesh`](../volenet-mesh).
