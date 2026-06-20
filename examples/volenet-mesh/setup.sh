#!/usr/bin/env bash
#
# Turn this directory into a ready-to-run VoleNet mesh serve-root:
#   - installs each space's paws (the onboarding step)
#   - generates each space's Ed25519 identity and cross-trusts the peers
#     (so the mesh comes up trusting itself — no manual key exchange)
#   - writes spaces.json so `vole serve` (run here) sees all three spaces
#
# Usage:   VOLE=vole bash setup.sh      (VOLE defaults to "vole" on PATH)
# Then:    vole serve                   (run in this directory)
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
VOLE="${VOLE:-vole}"

NODES=(coordinator worker-shell worker-files)

echo "==> Installing each space's paws (npm)"
for n in "${NODES[@]}"; do
  ( cd "spaces/$n" && npm install --silent --no-audit --no-fund )
  echo "    $n — paws installed"
done

echo "==> Generating an Ed25519 identity in each space"
for n in "${NODES[@]}"; do
  if [ -f "spaces/$n/.openvole/net/vole_key.pub" ]; then
    echo "    $n — key exists, keeping it"
  else
    ( cd "spaces/$n" && "$VOLE" net init "$n" >/dev/null )
    echo "    $n — generated"
  fi
done

echo "==> Cross-trusting peers (every node trusts every other node)"
for n in "${NODES[@]}"; do
  : > "spaces/$n/.openvole/net/authorized_voles"   # reset so re-runs stay clean
  for peer in "${NODES[@]}"; do
    [ "$n" = "$peer" ] && continue
    key=$(cat "spaces/$peer/.openvole/net/vole_key.pub")
    ( cd "spaces/$n" && "$VOLE" net trust "$key" >/dev/null )
  done
  echo "    $n trusts: $(awk '{print $3}' "spaces/$n/.openvole/net/authorized_voles" | paste -sd' ' -)"
done

echo "==> Writing spaces.json registry (absolute paths, so vole serve finds them)"
node -e '
  const fs = require("fs"), path = require("path");
  const root = process.argv[1], nodes = process.argv.slice(2);
  const now = new Date().toISOString();
  const reg = {
    activeId: nodes[0],
    spaces: nodes.map((n) => ({ id: n, name: n, path: path.join(root, "spaces", n), createdAt: now })),
  };
  fs.writeFileSync(path.join(root, "spaces.json"), JSON.stringify(reg, null, 2) + "\n");
' "$ROOT" "${NODES[@]}"
echo "    spaces.json -> $(node -e 'console.log(require("./spaces.json").spaces.map(s=>s.id).join(", "))')"

cat <<EOF

==> Mesh ready. Next:

  1. Give the coordinator a model:
       echo 'BRAIN_PROVIDER=gemini'   >  spaces/coordinator/.env
       echo 'GEMINI_API_KEY=your-key' >> spaces/coordinator/.env
     (or BRAIN_PROVIDER=ollama for a local model — nothing leaves your box)

  2. From THIS directory ($ROOT):
       vole serve
     Open the dashboard and **start all three spaces** (coordinator, worker-shell, worker-files).

  3. In the coordinator's chat:
       "run \`uname -a\` and write the result to /tmp/host.txt"
     It calls shell_exec on worker-shell and fs_write on worker-files — over VoleNet.

  Verify:  in the coordinator, \`vole net status\` shows both workers connected,
  and their tools (shell_exec, fs_*) appear in the coordinator's tool registry.
EOF
