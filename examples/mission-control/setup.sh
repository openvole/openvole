#!/usr/bin/env bash
#
# Vole Mission Control — a zero-cost, fully-scripted OpenVole demo.
#   - installs each agent's paws (npm)
#   - points each mock brain at its scenario file (absolute path in .env)
#   - generates agents.json (never committed — no machine paths in git)
#   - flags the queen as ORCHESTRATOR in the registry
#
# Usage:  bash setup.sh
#         PAWHUB_DIR=~/limnr/pawhub bash setup.sh   # use a local pawhub build
# Then:   vole serve      (run in this directory, open the printed URL)
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

AGENTS=(queen chef-vole bard-vole scout-vole)

# Preflight: this demo needs @openvole/paw-brain >= 2.4.0 (mock scenario mode). Until it's
# on npm, a local pawhub build is required — fail loudly instead of dying mid-install.
if [ -z "${PAWHUB_DIR:-}" ]; then
  if ! npm view "@openvole/paw-brain@^2.4.0" version >/dev/null 2>&1; then
    echo "✗ @openvole/paw-brain >= 2.4.0 is not on npm yet (scenario mode)."
    echo "  Until it ships, run with a local pawhub build:"
    echo "    PAWHUB_DIR=~/limnr/pawhub bash setup.sh"
    exit 1
  fi
fi

echo "==> Installing each agent's paws"
# PAWHUB_DIR: use a local pawhub build. Installed via `npm pack` tarball (NOT a path
# symlink) so files really live in node_modules — the paw sandbox only grants that path.
BRAIN_PKG="@openvole/paw-brain"
if [ -n "${PAWHUB_DIR:-}" ]; then
  echo "    packing local paw-brain from $PAWHUB_DIR"
  BRAIN_PKG="$(cd "$PAWHUB_DIR/paws/paw-brain" && npm pack --silent --pack-destination /tmp | tail -1)"
  BRAIN_PKG="/tmp/$(basename "$BRAIN_PKG")"
fi
for a in "${AGENTS[@]}"; do
  if [ -n "${PAWHUB_DIR:-}" ]; then
    ( cd "agents/$a" && npm install --silent --no-audit --no-fund "$BRAIN_PKG" "@openvole/paw-session" )
  else
    ( cd "agents/$a" && npm install --silent --no-audit --no-fund )
  fi
  echo "    $a — paws installed"
done

echo "==> Writing each agent's .env (generated — not tracked in git)"
for a in "${AGENTS[@]}"; do
  cat > "agents/$a/.env" <<ENV
VOLE_LOG_FILE=.openvole/logs/vole.log
VOLE_LOG_LEVEL=info
BRAIN_PROVIDER=mock
BRAIN_MOCK_SCENARIO=$ROOT/agents/$a/.openvole/paws/paw-brain/scenario.json
ENV
done

echo "==> Writing agents.json (queen = orchestrator)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
cat > agents.json <<EOF
{
  "activeId": "queen",
  "agents": [
    { "id": "queen", "name": "queen", "path": "$ROOT/agents/queen", "createdAt": "$NOW", "orchestrator": true },
    { "id": "chef-vole", "name": "chef-vole", "path": "$ROOT/agents/chef-vole", "createdAt": "$NOW" },
    { "id": "bard-vole", "name": "bard-vole", "path": "$ROOT/agents/bard-vole", "createdAt": "$NOW" },
    { "id": "scout-vole", "name": "scout-vole", "path": "$ROOT/agents/scout-vole", "createdAt": "$NOW" }
  ]
}
EOF

echo ""
echo "Mission Control is ready. Next:"
echo "  vole serve          # in this directory — open the printed URL"
echo "  Start all four agents in the dashboard, open the queen's Chat, and say: fleet"
