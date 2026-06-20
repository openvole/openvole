#!/usr/bin/env bash
#
# Set up the OpenVole public hub as a ready-to-run serve-root:
#   - installs the hub's paws
#   - generates the hub's Ed25519 identity
#   - writes spaces.json so `vole serve` (run here) finds the hub space
#
# Usage:   VOLE=vole bash setup.sh   (VOLE defaults to "vole" on PATH)
# Then:    vole serve                (run in this directory)
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
VOLE="${VOLE:-vole}"

echo "==> Installing the hub's paws (npm)"
( cd spaces/hub && npm install --silent --no-audit --no-fund )

echo "==> Generating the hub identity"
if [ -f spaces/hub/.openvole/net/vole_key.pub ]; then
  echo "    key exists, keeping it"
else
  ( cd spaces/hub && "$VOLE" net init hub >/dev/null )
  echo "    generated"
fi
echo "    hub public key: $(cat spaces/hub/.openvole/net/vole_key.pub)"

echo "==> Writing spaces.json registry"
node -e '
  const fs = require("fs"), path = require("path");
  const root = process.argv[1];
  fs.writeFileSync(
    path.join(root, "spaces.json"),
    JSON.stringify(
      { activeId: "hub", spaces: [{ id: "hub", name: "hub", path: path.join(root, "spaces", "hub"), createdAt: new Date().toISOString() }] },
      null, 2,
    ) + "\n",
  );
' "$ROOT"

cat <<'EOF'

==> Hub ready. To go live:

  1. Give the hub a model (a paid API you fund — the hub thinks; guests bring their own brains):
       echo 'BRAIN_PROVIDER=gemini'   >  spaces/hub/.env
       echo 'GEMINI_API_KEY=your-key' >> spaces/hub/.env

  2. Run it (in THIS directory) and start the hub space:
       vole serve

  3. Expose the VoleNet port 9700 to the internet (the dashboard on 3000 can stay local).
     The hub has "demo": true, so its config/identity are read-only in the dashboard.

  4. Share the join command with followers:
       vole net join http://YOUR_HOST:9700 --name their-name

  Guests join at 'tool' trust, cannot use your brain, and are rate-limited.
  Watch them arrive:  vole net peers
EOF
